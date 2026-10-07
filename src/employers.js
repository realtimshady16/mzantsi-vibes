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
 *     the link. Tavily's page text is read for the date and then discarded, never kept or shown.
 *
 * The company list is a lead list, not content. It is not committed: it is read from a CSV on the
 * runner's machine (scripts/run-employers.mjs) and, for the cron, loaded from storage. Only the
 * company name and website are used.
 */

import { isValidDate, todayInSA } from '../PUBLISH/entry-meta.js';
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

/** The host to restrict a search to: no scheme, path, or `www.`/`www2.` (those are the same site, not a subdomain to stick to). null when it is not a usable web address. */
export function domainOf(website) {
  const host = hostOf(/^https?:\/\//i.test(String(website ?? '').trim()) ? String(website).trim() : `https://${String(website ?? '').trim()}`);
  const bare = host.replace(/^www\d*\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bare) ? bare.toLowerCase() : null;
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
    const domains = [c.domain, ...(c.extraDomains || [])];
    return {
      pass: EMPLOYER_PASS,
      category: 'Employers',
      tag: c.name,
      company: c.name,
      domain: c.domain,
      domains,
      query: `${c.name} bursary graduate programme internship learnership applications closing date South Africa`,
      include: domains,
      maxResults: MAX_RESULTS,
      rawContent: true,
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
  if (/\b(graduates?|trainee(?:ship)?s?|young professionals?|ca training|academy)\b/i.test(hay)) return 'Graduate programmes';
  // Vague wording that does not say who it is for (Tiger Brands' "Young Talent" page asks for a matric): a neutral label,
  // so a school-leaver is not told it is a graduate programme, or a graduate that it is for school-leavers.
  if (/\b(young talent|talent programme|students?|early careers?|entry level|development programmes?|training programmes?|future leaders|youth)\b/i.test(hay)) return 'Early careers';
  return null;
}

const LANGUAGE_CODES = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'zh', 'ja', 'ko', 'ar', 'af']);

/**
 * Multinationals keep every country's careers pages on one domain (deloitte.com/ke/en/…). Only
 * South Africa's are for our readers, so a /xx/en/ path for another country is dropped.
 */
export function otherCountry(url) {
  try {
    const path = new URL(url).pathname;
    // /ke/en/… (Deloitte) and /us-en/… (Accenture): a country, then a language.
    // The country can also sit deeper (nedbank.co.za/content/nedbank/zw/en/…), so look for "/xx/en" anywhere.
    const m = /\/([a-z]{2})\/[a-z]{2}(?:-[a-z]{2})?(?:\/|$)/i.exec(path);
    if (m) return m[1].toLowerCase() !== 'za';
    // /us-en/ (country first) or /en-gb/ (language first): the country is the part that is not a language.
    const pair = /^\/([a-z]{2})[-_]([a-z]{2})(?:\/|$)/i.exec(path);
    if (!pair) return false;
    const [a, b] = [pair[1].toLowerCase(), pair[2].toLowerCase()];
    return (LANGUAGE_CODES.has(a) ? b : a) !== 'za';
  } catch {
    return false;
  }
}

/** The page says, in so many words, that applications are shut ("Applications for the 2027 intake have closed"). */
const SAYS_CLOSED = /\b(applications?|intake|programme|bursary)\b[^.\n]{0,80}\b(?:have|has|are|is|now|been)\s+(?:now\s+)?closed\b/i;

const MONTHS_RE = 'january|february|march|april|may|june|july|august|september|october|november|december';
/** A closing date with no year ("applications close 31 October"): our date rule rejects it on purpose, so a person must confirm the year. */
const YEARLESS = new RegExp(`\\b(?:clos(?:e|es|ing)|deadline|apply\\s+(?:by|before))\\b[^.\\d\\n]{0,40}\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS_RE})\\b(?!,?\\s+20\\d\\d)`, 'i');

const MONTH_NAMES = MONTHS_RE.split('|');
const YEARLESS_PARTS = new RegExp(`\\b(?:clos(?:e|es|ing)|deadline|apply\\s+(?:by|before))\\b[^.\\d\\n]{0,40}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS_RE})\\b(?!,?\\s+20\\d\\d)`, 'gi');

/**
 * Companies often print a window with no year ("Open: 22 September  Close: 22 October"), and those
 * are the ones open now. Take the next such date only when there is exactly one on the page and it is
 * at most `withinDays` away: a window closing soon is almost certainly this cycle's, while "31 May"
 * read in October more likely belongs to a past cycle. The caller flags the year as assumed so the
 * reviewer confirms it on the page. Returns { date } to use, { tooFar } to explain a refusal, or null.
 */
export function yearlessDeadline(text, now = new Date(), withinDays = 120) {
  const found = new Set();
  for (const m of String(text ?? '').matchAll(YEARLESS_PARTS)) found.add(`${Number(m[1])}-${MONTH_NAMES.indexOf(m[2].toLowerCase()) + 1}`);
  if (found.size !== 1) return null;
  const [day, month] = [...found][0].split('-').map(Number);
  const today = todayInSA(now);
  const thisYear = Number(today.slice(0, 4));
  for (const year of [thisYear, thisYear + 1]) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidDate(iso) || iso < today) continue;
    const days = (Date.parse(iso) - Date.parse(today)) / 86400000;
    return days <= withinDays ? { date: iso } : { tooFar: iso };
  }
  return null;
}

const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);
export const onAnyDomain = (host, search) => (search.domains || [search.domain]).some((d) => onDomain(host, d));

/** The newest year in a page title that is this year or later ("Graduate Programme 2027"). */
function cycleYear(title, now) {
  const years = (title.match(/\b(20\d\d)\b/g) || []).map(Number).filter((y) => y >= now.getUTCFullYear());
  return years.length ? Math.max(...years) : null;
}

/** Same contract as `judge` in opportunities.js: { finding } or { reason }. `seen` keeps one lead per company and kind. */
export function judgeEmployer(result, search, now, seen = new Set()) {
  const url = safeUrl(result.url);
  if (!url) return { reason: 'not a usable http(s) link' };
  if (!onAnyDomain(hostOf(url), search)) return { reason: `not on ${(search.domains || [search.domain]).join(' or ')}, so not the company's own page` };
  if (search.minScore && !(result.score >= search.minScore)) return { reason: `relevance score ${result.score?.toFixed(2) ?? '?'} is below ${search.minScore}` };
  if (isNoise(url)) return { reason: 'noise page (home, search, pagination, contact…)' };
  if (/\.pdf$/i.test(new URL(url).pathname)) return { reason: 'a PDF (reports and fact sheets, not an application page)' };
  if (otherCountry(url)) return { reason: 'another country\'s page (only South Africa\'s are for our readers)' };

  const pageTitle = oneLine(result.title, 120);
  if (isStale(pageTitle, now)) return { reason: 'title only mentions past years' };

  const category = employerCategory({ title: pageTitle, url });
  if (!category) return { reason: 'cannot tell whether this is a bursary, graduate programme or internship' };

  // The snippet is a fragment and rarely holds the date; the page text does. Read it here and drop it:
  // only the date leaves this function.
  let deadline = extractDeadline(`${result.title}. ${result.content}. ${result.raw_content ?? ''}`, now);
  let yearAssumed = false;
  if (!deadline) {
    const text = `${result.content} ${result.raw_content ?? ''}`;
    if (SAYS_CLOSED.test(text)) return { reason: 'the page says applications are closed' };
    const guess = yearlessDeadline(text, now);
    if (guess?.date) {
      deadline = { date: guess.date, past: false };
      yearAssumed = true;
    } else if (guess?.tooFar) {
      return { reason: `a closing date without a year, and the next one (${guess.tooFar}) is too far off to assume` };
    } else if (YEARLESS.test(text)) {
      return { reason: 'closing dates given without a year, and not just one: confirm on the page' };
    } else {
      return { reason: 'no closing date found (dated entries only)' };
    }
  }
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
      ...(yearAssumed && { yearAssumed: true }),
      pass: EMPLOYER_PASS,
      category,
      tag: null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Portals: a company's careers or bursary site on another domain
 * ------------------------------------------------------------------ */

// Never a company's own page, so never a portal: aggregators and job boards (AGENTS.md rule 9).
const NOT_A_PORTAL = [
  'graduates24.com', 'careers24.com', 'zabursaries.co.za', 'indeed.com', 'glassdoor.com', 'linkedin.com', 'jooble.org',
  'careerjet.co.za', 'ziprecruiter.com', 'pnet.co.za', 'careerjunction.co.za', 'jobmail.co.za', 'facebook.com', 'instagram.com',
  'tiktok.com', 'youtube.com', 'x.com', 'twitter.com', 'wikipedia.org',
];
export const isAggregator = (host) => NOT_A_PORTAL.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Add reviewed portal domains to companies. `portals` is { "Company name": ["domain", ...] }, matched
 * by exact name. A human puts a domain there after opening it and seeing it is the company's own
 * (a bursary site run by the company, say). An aggregator is refused.
 */
export function withPortals(companies, portals = {}) {
  const known = new Set(companies.map((c) => c.name.toLowerCase()));
  for (const name of Object.keys(portals)) {
    if (!known.has(name.toLowerCase())) throw new Error(`portals: "${name}" is not in the company list.`);
  }
  return companies.map((c) => {
    const key = Object.keys(portals).find((n) => n.toLowerCase() === c.name.toLowerCase());
    if (!key) return c;
    const extraDomains = [];
    for (const raw of portals[key]) {
      const d = domainOf(raw);
      if (!d) throw new Error(`portals: "${raw}" for ${c.name} is not a web address.`);
      if (isAggregator(d)) throw new Error(`portals: ${d} is an aggregator, not ${c.name}'s own site.`);
      if (d !== c.domain && !extraDomains.includes(d)) extraDomains.push(d);
    }
    return { ...c, extraDomains };
  });
}

/**
 * A search for where a company keeps its careers pages, to suggest portal domains to a human. It
 * leaves out the company's own domain and the aggregators. What it yields is only a suggestion:
 * nothing is added until someone opens the site and confirms it is the company's.
 */
export function planDiscovery(companies) {
  return companies.map((c) => ({
    pass: 'discover',
    category: 'Employers',
    tag: c.name,
    company: c.name,
    query: `${c.name} graduate programme bursary internship apply South Africa`,
    exclude: [c.domain, ...NOT_A_PORTAL],
    maxResults: 8,
  }));
}
