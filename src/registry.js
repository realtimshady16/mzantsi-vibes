/**
 * Registry mode: where does each company keep its careers, graduate, bursary and youth pages?
 *
 * A different job from the publish path in employers.js. That one asks "is there something open to apply for,
 * with a date?" and so needs a closing date. This one builds a list of places to look, so it needs none: a
 * careers page is worth recording whether or not it states a date today. It never feeds a PR or the site, leaves
 * `closes` empty, and never assumes a year. A person reviews the list before anything is published.
 *
 * What it keeps per company is one primary URL and up to two alternates, each typed:
 *   landing    a careers or early-careers hub (the parent of the specific pages)
 *   programme  a specific graduate / bursary / internship / learnership / youth page
 *   job-board  a list of vacancies
 *   other      news, press, blog, terms and conditions: kept, but never preferred
 * Job-detail pages, apply endpoints, URLs with query-string tokens and other countries' pages are dropped.
 */

import { collect, hostOf, oneLine, safeUrl, searchLabel } from './opportunities.js';
import { planEmployerSearches, onAnyDomain, otherCountry } from './employers.js';

export const REGISTRY_PASS = 'registry';
export const REGISTRY_MIN_SCORE = 0.5;
export const REGISTRY_PER_COMPANY = 3; // one primary, two alternates
// Candidates between the floor and the minimum are kept but marked `lowScore`, so the run can list them apart and the
// threshold can be judged from evidence. They are never in the main output.
export const REGISTRY_FLOOR = 0.2;

const TYPE_ORDER = ['landing', 'programme', 'job-board', 'other'];

/* ------------------------------------------------------------------ *
 * Reading a URL
 * ------------------------------------------------------------------ */

/** Lower-case words: CamelCase and separators split, so "YouthDevelopment" and "early-careers" both read as words. */
export function words(s) {
  return String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_/+.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

const segmentsOf = (url) => {
  try { return new URL(url).pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }); } catch { return []; }
};
const pathOf = (url) => segmentsOf(url).join('/');
const lastSegmentWords = (url) => words((segmentsOf(url).at(-1) || '').replace(/\.(html?|php|aspx?|jsp)$/i, ''));

// What a page's path or title must suggest. The core words are the ones asked for; the variants (scholarship, trainee,
// apprentice, students, young talent) are the same kind of page under another name.
const HINT_WORDS = /\b(careers?|graduates?|bursar(?:y|ies)|scholarships?|interns?|internships?|learnerships?|youth|early careers?|trainee(?:ship)?s?|apprentice(?:ship)?s?|young talent|future leaders?|students?)\b/;
// ...and the same words run together ("earlycareers", "graduateprogramme", "youthdevelopment"). Only words that do not occur
// inside others: "intern" would match "international", so only "internship" is looked for joined.
const HINT_JOINED = /(career|graduate|bursar|internship|learnership|youth|earlycareer|youngtalent|scholarship|trainee|apprentice)/;

/** Does the title or path suggest a careers, graduate, bursary, internship, learnership, youth or early-careers page? */
export function suggestsCareers(title, url) {
  const text = `${title} ${pathOf(url)}`;
  return HINT_WORDS.test(words(text)) || HINT_JOINED.test(compact(text));
}

/**
 * The cycle year visible in a page's title, or in a path segment that is a slug with a year in it
 * ("graduate-programme-2027"). A bare /2026/03/ folder is a publication date, not a cycle, and so is a date at
 * the start of a slug. Whatever year is shown is reported, even a past one. Never assumed.
 */
export function visibleCycleYear(title, url) {
  const slugs = segmentsOf(url).filter((s) => /[a-z]/i.test(s)).map((s) => s.replace(/\b20\d\d-\d\d-\d\d\b/g, ''));
  const years = `${title} ${slugs.join(' ')}`.match(/\b20\d\d\b/g) || [];
  return years.length ? Math.max(...years.map(Number)) : null;
}

/* ---- URLs we never record ---- */

const TRACKING_PARAM = /^(utm_.*|icid|fbclid|gclid|mc_cid|mc_eid|_ga|_gl|cmpid|sc_cid|trk|ref|referrer)$/i;

/** The URL without tracking parameters or a fragment, and whatever other query parameters remain. */
export function cleanUrl(url) {
  const u = new URL(url);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  const extra = [...u.searchParams.keys()];
  return { href: u.href, extra };
}

// An apply or sign-in endpoint is a form, not a page to send people to.
const APPLY_SEGMENT = /^(apply|apply-now|applynow|apply-online|apply-here|application-form|login|log-in|signin|sign-in|register|registration|candidate-login)$/i;
const APPLY_HOST = /^(apply|login|auth|signin|account)$/i;

export function isApplyEndpoint(url) {
  const label = hostOf(url).replace(/^www\d*\./, '').split('.')[0];
  return APPLY_HOST.test(label) || segmentsOf(url).some((s) => APPLY_SEGMENT.test(s));
}

// A requisition or job id: "R0000397711", "JR-12345", "REQ_9981", or a bare run of five or more digits.
const ID_SEGMENT = /^(?:[a-z]{1,3}[-_]?\d{4,}|\d{5,})$/i;
const ID_LIKE = (s) => ID_SEGMENT.test(s) || /-\d{5,}$/.test(s);
const LIST_WORDS = new Set(['jobs', 'job', 'vacancies', 'vacancy', 'positions', 'position', 'openings', 'opening', 'requisitions', 'requisition', 'postings', 'posting']);

/**
 * A single posting: /job/…, /jobs/<id>, a requisition id anywhere in the path. (/jobs on its own is a list of
 * postings, which is a job board and kept.)
 */
export function isJobDetail(url) {
  const segs = segmentsOf(url).map((s) => s.toLowerCase());
  return segs.some((s, i) => (s === 'job' && segs[i + 1]) || (LIST_WORDS.has(s) && segs[i + 1] && ID_LIKE(segs[i + 1])) || ID_SEGMENT.test(s));
}

/* ---- locale ---- */

const LANGUAGES = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'zh', 'ja', 'ko', 'ar', 'af']);
// Countries and regions that are not South Africa. The first group is the one asked for; the rest are the same kind.
const NOT_SA = new Set([
  'us', 'uk', 'uki', 'de', 'fr', 'es', 'it', 'mx', 'apac', 'amer', 'sea', 'zw',
  'gb', 'emea', 'ke', 'tz', 'ie', 'ng', 'au', 'nz', 'ca', 'br', 'in', 'cn', 'jp', 'ch', 'nl', 'be', 'pt', 'pl', 'se', 'dk', 'fi', 'ae', 'sg', 'hk', 'ph',
]);
const REGIONS = new Set(['uki', 'apac', 'amer', 'emea', 'sea']); // never anything else, so recognised anywhere in the path
const GLOBAL_SEGMENTS = new Set(['global', 'international', 'intl', 'worldwide']);
const SA_SEGMENTS = new Set(['za', 'south-africa', 'southafrica']);

/**
 * Where a URL is for. { kind: 'other', code } is another country or region, to be dropped. 'za' says South Africa
 * outright, 'global' is a company-wide page (a flagged fallback), and 'neutral' has no locale in it at all.
 * A bare two-letter segment is a locale only first in the path or just before a language ("/de/en/", "/mx/en/"),
 * so "/graduates/it/" (information technology) is not mistaken for Italy.
 */
export function localeOf(url) {
  const segs = segmentsOf(url).map((s) => s.toLowerCase());
  const first = hostOf(url).replace(/^www\d*\./, '').split('.')[0];
  if (NOT_SA.has(first) && first.length > 1) return { kind: 'other', code: first };

  let za = false, global = false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const pair = /^([a-z]{2})[-_]([a-z]{2})$/.exec(s); // en-za, za-en, us-en, fr-ca
    if (pair) {
      const country = LANGUAGES.has(pair[1]) ? pair[2] : pair[1];
      if (country === 'za') za = true;
      else if (NOT_SA.has(country)) return { kind: 'other', code: country };
      continue;
    }
    if (REGIONS.has(s)) return { kind: 'other', code: s };
    const next = segs[i + 1] || '';
    const languageNext = LANGUAGES.has(next) || /^(en|fr|de|es|it|pt|nl)[-_][a-z]{2}$/.test(next);
    if (NOT_SA.has(s) && s.length === 2 && (i === 0 || languageNext)) return { kind: 'other', code: s };
    if (SA_SEGMENTS.has(s)) za = true;
    if (GLOBAL_SEGMENTS.has(s)) global = true;
  }
  // The general "/xx/en/" rule, wherever it sits in the path (nedbank.co.za/content/nedbank/zw/en/…).
  if (otherCountry(url)) return { kind: 'other', code: '?' };
  if (za) return { kind: 'za' };
  if (global) return { kind: 'global' };
  return { kind: 'neutral' };
}

/* ---- the type of page ---- */

// News and the like: kept in the registry, but as "other", and never preferred over a real page.
// Matched against the words of each path segment, so "press-statements", "media-centre" and "newsroom" all count.
const OTHER_WORDS = /\b(news|newsroom|press|media|blog|blogs|stories|story|spotlight|insights?|articles?|scoop|announcements?|terms|tcs)\b/;
const JOB_BOARD_WORDS = new Set(['jobs', 'job search', 'search jobs', 'vacancies', 'available jobs', 'current vacancies', 'open positions', 'job opportunities', 'job listings', 'job board']);
const JOB_BOARD_LAST = new Set(['opportunities', 'openings', 'positions', 'vacancy', 'job']);
const LANDING_WORDS = new Set(['careers', 'career', 'early careers', 'early talent', 'early in career', 'join us', 'work with us', 'work for us', 'working here', 'careers home', 'careers index', 'careers php']);
const PROGRAMME_KINDS = [/graduate/, /bursar|scholarship/, /intern/, /learnership/, /apprentice/, /trainee/, /youth/, /student/, /young talent/, /future leader/];
const PROGRAMME_JOINED = /(graduate|bursar|internship|learnership|youth|youngtalent|scholarship|trainee|apprentice)/; // run together: "YouthDevelopment"

/** landing | programme | job-board | other: from the path and title only. */
export function registryType(url, title = '') {
  const segs = segmentsOf(url).map((s) => words(s.replace(/\.(html?|php|aspx?|jsp)$/i, '')));
  const label = hostOf(url).replace(/^www\d*\./, '').split('.')[0];
  const last = segs.at(-1) || '';

  if (segs.some((s) => OTHER_WORDS.test(s)) || /\b(terms and conditions|press release|media release)\b/i.test(title)) return 'other';
  if (label === 'jobs' || segs.some((s) => JOB_BOARD_WORDS.has(s)) || JOB_BOARD_LAST.has(last)) return 'job-board';

  const all = `${words(title)} ${segs.join(' ')}`;
  const kinds = PROGRAMME_KINDS.filter((re) => re.test(last)).length;
  if (LANDING_WORDS.has(last) || kinds >= 2) return 'landing'; // "graduates and bursaries" is a hub of programmes
  if (PROGRAMME_KINDS.some((re) => re.test(all)) || PROGRAMME_JOINED.test(compact(all))) return 'programme';
  return 'landing'; // careers wording only: the careers hub
}

/* ------------------------------------------------------------------ *
 * Judging a result
 * ------------------------------------------------------------------ */

/** Same contract as judgeEmployer: { finding } or { reason }. No date test, by design. */
export function judgeRegistry(result, search) {
  const raw = safeUrl(result.url);
  if (!raw) return { reason: 'not a usable http(s) link' };
  if (!onAnyDomain(hostOf(raw), search)) return { reason: `not on ${(search.domains || [search.domain]).join(' or ')}, so not the company's own page` };

  const { href: url, extra } = cleanUrl(raw);
  if (extra.length) return { reason: `query-string parameters (${extra.slice(0, 3).join(', ')}): a token, id or search, not a stable page` };
  if (isApplyEndpoint(url)) return { reason: 'an apply or sign-in endpoint, not a page to send people to' };
  if (isJobDetail(url)) return { reason: 'a single job posting (/job/…, /jobs/<id> or a requisition id), not the careers page' };
  if (new URL(url).pathname.replace(/\/+$/, '') === '') return { reason: 'the site\'s home page' };
  if (/^\/(contact|privacy|privacy-policy|cookie|cookies|sitemap)\b/i.test(new URL(url).pathname)) return { reason: 'boilerplate page (contact, privacy…)' };
  if (/\.pdf$/i.test(new URL(url).pathname)) return { reason: 'a PDF (reports and fact sheets, not a page to send people to)' };

  const locale = localeOf(url);
  if (locale.kind === 'other') return { reason: `another country's or region's page (${locale.code})` };
  if (!(result.score >= REGISTRY_FLOOR)) return { reason: `relevance score ${result.score?.toFixed(3) ?? '?'} is below even the ${REGISTRY_FLOOR} floor` };

  const title = oneLine(result.title, 120);
  if (!suggestsCareers(title, url)) return { reason: 'neither the path nor the title suggests careers, graduate, bursary, internship, learnership, youth or early careers' };

  return {
    finding: {
      company: search.company,
      url,
      title,
      score: Number(result.score),
      type: registryType(url, title),
      locale: locale.kind,
      cycleYear: visibleCycleYear(title, url),
      closes: '',
      lowScore: !(result.score >= REGISTRY_MIN_SCORE),
      pass: REGISTRY_PASS,
      source: search.company,
    },
  };
}

/* ------------------------------------------------------------------ *
 * The searches
 * ------------------------------------------------------------------ */

/** One search per company, like the publish path, but without page text: the registry needs no dates, and it is faster. */
export function planRegistrySearches(companies) {
  return planEmployerSearches(companies).map((s) => ({
    ...s,
    pass: REGISTRY_PASS,
    query: `${s.company} careers graduate programme bursary internship learnership youth early careers South Africa`,
    maxResults: 10, // room to find three that qualify
    rawContent: false,
    judge: (result, search) => judgeRegistry(result, search),
  }));
}

// For a company the first search found nothing for: narrower queries, one kind of page each.
export const REGISTRY_VARIANTS = [
  ['early careers', 'early careers programme'],
  ['learnership', 'learnership'],
  ['YES programme', 'YES programme youth employment service'],
  ['bursary', 'bursary'],
];

/** The variant searches for one company (the own domain plus any reviewed portals, as in the first pass). */
export function planVariantSearches(company) {
  const [base] = planRegistrySearches([company]);
  return REGISTRY_VARIANTS.map(([label, text]) => ({ ...base, tag: `${company.name} · ${label}`, query: `${company.name} ${text} South Africa` }));
}

/** True when this company has at least one finding that meets the score minimum. */
const hasStrong = (findings, name) => findings.some((f) => f.company === name && !f.lowScore);

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * Retry once, for the companies the first pass left with nothing, using each variant query in turn until one
 * finds a qualifying page. At most one credit per variant per company. Returns { findings, failures, tried }.
 */
export async function registryFallback({ key, companies, fetchImpl, now, onResult, concurrency = 4, retries = 3, retryDelayMs = 5000 }) {
  const findings = [];
  const failures = [];
  const retried = [];
  const tried = [];
  await pool(companies, concurrency, async (company) => {
    let queries = 0;
    for (const search of planVariantSearches(company)) {
      queries++;
      const out = await collect({ key, searches: [search], fetchImpl, now, onResult, concurrency: 1, retries, retryDelayMs });
      findings.push(...out.findings);
      failures.push(...out.failures);
      retried.push(...out.retried);
      if (hasStrong(out.findings, company.name)) break;
    }
    tried.push({ company: company.name, queries, found: hasStrong(findings, company.name) });
  });
  return { findings, failures, retried, tried };
}

/* ------------------------------------------------------------------ *
 * What to keep
 * ------------------------------------------------------------------ */

const LOCALE_RANK = { za: 0, neutral: 1, global: 2 };

/**
 * One primary and up to two alternates per company, companies in the order given. The best of each type first
 * (landing, programme, job-board, other), so the three are not all the same kind of page; within a type, a page
 * that says South Africa beats a neutral one, then the higher score. A global page is used only when a company has
 * nothing else, and is flagged. The primary is the first.
 */
export function pickRegistry(findings, companies, perCompany = REGISTRY_PER_COMPANY) {
  const rows = [];
  for (const c of companies) {
    let mine = findings.filter((f) => f.company === c.name);
    const local = mine.filter((f) => f.locale !== 'global');
    if (local.length) mine = local;
    // Within a type: a page that says South Africa first; then, for landing pages, the parent (the shallower path), since
    // /careers is the hub and /contact-us/careers is a copy of it; then the higher score.
    const depth = (f) => (f.type === 'landing' ? segmentsOf(f.url).length : 0);
    const better = (a, b) => (LOCALE_RANK[a.locale] ?? 1) - (LOCALE_RANK[b.locale] ?? 1) || depth(a) - depth(b) || b.score - a.score;
    const chosen = [];
    for (const t of TYPE_ORDER) {
      const best = mine.filter((f) => f.type === t).sort(better)[0];
      if (best) chosen.push(best);
    }
    const rest = mine.filter((f) => !chosen.includes(f)).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || better(a, b));
    chosen.push(...rest);
    chosen.slice(0, perCompany).forEach((f, i) => rows.push({ ...f, role: i === 0 ? 'primary' : 'alternate', flag: f.locale === 'global' ? 'global fallback' : '' }));
  }
  return rows;
}

const csvCell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** company, role, type, url, score, cycle_year (empty if none visible), flag, closes (always empty), title. */
export function registryCsv(rows) {
  const lines = ['company,role,type,url,score,cycle_year,flag,closes,title'];
  for (const r of rows) lines.push([r.company, r.role, r.type, r.url, r.score.toFixed(2), r.cycleYear ?? '', r.flag || '', '', r.title].map(csvCell).join(','));
  return lines.join('\n') + '\n';
}

export { searchLabel };
