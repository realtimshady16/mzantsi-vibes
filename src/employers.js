/**
 * The employer pass: look for a company's own bursary, graduate-programme and internship pages.
 *
 * It feeds the same digest and PR as the zabursaries pass (opportunities.js, opportunity-pr.js), so
 * leads are reviewed like any contribution. Three rules shape it:
 *
 *   - Own domain only. Each search is limited to the company's website, and a result from any other
 *     host is dropped. (An aggregator is never a fallback.)
 *   - Dated only. A page with no closing date in what the search returned gives no lead: an entry
 *     with no date could never expire.
 *   - Our words. The issue and the entry carry the company, the kind of opportunity, the date and
 *     the link; the page's own text is never kept.
 *
 * The company list is a lead list, not content. It is not committed: it is read from a CSV on the
 * runner's machine (scripts/run-employers.mjs) and, for the cron, loaded from storage. Only the
 * company name and website are used.
 */

import { extractDeadline, hostOf, isNoise, isStale, oneLine, safeUrl, EMPLOYER_LABEL as LABEL } from './opportunities.js';

export const EMPLOYER_PASS = 'employers';
const MAX_RESULTS = 5;

/* ------------------------------------------------------------------ *
 * The company list
 * ------------------------------------------------------------------ */

/** Minimal CSV reader (quoted fields, doubled quotes, CRLF). No dependency, by design. */
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/**
 * Companies from the lead-list CSV: `Company` and `Company website` columns only. Any other column
 * (what a company advertised, where it was seen) is deliberately never read.
 */
export function parseCompaniesCsv(text) {
  const [header = [], ...rows] = csvRows(text);
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const name = col('company');
  const site = col('company website');
  if (name === -1 || site === -1) throw new Error('The CSV needs "Company" and "Company website" columns.');
  const out = [];
  for (const r of rows) {
    const company = (r[name] || '').trim();
    const domain = domainOf(r[site]);
    if (company && domain) out.push({ name: company, domain });
  }
  return out;
}

/** The host to restrict a search to: no scheme, path or `www.`. null when it is not a usable web address. */
export function domainOf(website) {
  const host = hostOf(/^https?:\/\//i.test(String(website ?? '').trim()) ? String(website).trim() : `https://${String(website ?? '').trim()}`);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host.toLowerCase() : null;
}

/* ------------------------------------------------------------------ *
 * The searches
 * ------------------------------------------------------------------ */

/**
 * One search per company (one Tavily credit), covering every kind of opportunity it might run.
 * `tag` is the company name: --only and the search label match on it.
 */
export function planEmployerSearches(companies) {
  return companies.map((c) => {
    const seen = new Set();
    return {
      pass: EMPLOYER_PASS,
      category: 'Employers',
      tag: c.name,
      company: c.name,
      domain: c.domain,
      query: `${c.name} bursary graduate programme internship learnership applications closing date South Africa`,
      include: [c.domain],
      maxResults: MAX_RESULTS,
      judge: (result, search, now) => judgeEmployer(result, search, now, seen),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Judging a result
 * ------------------------------------------------------------------ */

/**
 * Which kind of opportunity a page is, from its title and address only. The snippet is not used: it is
 * often menu text that mentions every kind at once. null means we cannot tell, so it is not a lead.
 */
export function employerCategory({ title = '', url = '' }) {
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname).replace(/[-_/+]+/g, ' '); } catch { /* keep '' */ }
  const hay = `${title} ${path}`;
  if (/\b(bursar(y|ies)|scholarships?)\b/i.test(hay)) return 'Bursaries';
  if (/\b(learnerships?|apprentice(ship)?s?|yes programme|youth employment service)\b/i.test(hay)) return 'Learnerships';
  if (/\b(vac(ation)? work|vac work|student vacation)\b/i.test(hay)) return 'Training & vac work';
  if (/\b(interns?|internships?|work integrated learning|wil)\b/i.test(hay)) return 'Internships';
  if (/\b(graduates?|trainee|young professionals?|talent programme|academy)\b/i.test(hay)) return 'Graduate programmes';
  return null;
}

const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** The newest year in a page title that is this year or later ("Graduate Programme 2027"). */
function cycleYear(title, now) {
  const years = (title.match(/\b(20\d\d)\b/g) || []).map(Number).filter((y) => y >= now.getUTCFullYear());
  return years.length ? Math.max(...years) : null;
}

/** Same contract as `judge` in opportunities.js: { finding } or { reason }. `seen` keeps one lead per company and kind. */
export function judgeEmployer(result, search, now, seen = new Set()) {
  const url = safeUrl(result.url);
  if (!url) return { reason: 'not a usable http(s) link' };
  if (!onDomain(hostOf(url), search.domain)) return { reason: `not on ${search.domain}, so not the company's own page` };
  if (search.minScore && !(result.score >= search.minScore)) return { reason: `relevance score ${result.score?.toFixed(2) ?? '?'} is below ${search.minScore}` };
  if (isNoise(url)) return { reason: 'noise page (home, search, pagination, contact…)' };

  const pageTitle = oneLine(result.title, 120);
  if (isStale(pageTitle, now)) return { reason: 'title only mentions past years' };

  const category = employerCategory({ title: pageTitle, url });
  if (!category) return { reason: 'cannot tell whether this is a bursary, graduate programme or internship' };

  const deadline = extractDeadline(`${result.title}. ${result.content}`, now);
  if (!deadline) return { reason: 'no closing date found (dated entries only)' };
  if (deadline.past) return { reason: `closing date ${deadline.date} has already passed` };

  const key = `${search.company}|${category}`;
  if (seen.has(key)) return { reason: `already have a ${LABEL[category].toLowerCase()} lead for ${search.company}` };
  seen.add(key);

  const year = cycleYear(pageTitle, now);
  return {
    finding: {
      title: `${search.company} ${LABEL[category]}${year ? ` ${year}` : ''}`,
      url,
      desc: '',
      source: search.company,
      company: search.company,
      closes: deadline.date,
      pass: EMPLOYER_PASS,
      category,
      tag: null,
    },
  };
}
