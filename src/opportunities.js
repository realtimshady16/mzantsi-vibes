/**
 * Weekly opportunity digest.
 *
 * Searches two known-good SA sites for bursaries, learnerships, graduate
 * programmes, jobs and training, and posts what it finds as ONE GitHub issue
 * for a human to read. A broader whole-web pass exists but is OFF in the weekly
 * run: real runs showed it was mostly noise (see BROAD below), so it is only
 * available on demand while it is tuned.
 *
 * It is a leads list, not a publisher: nothing here touches the README, and
 * there is deliberately no deduplication against earlier runs.
 *
 * Cost: every search is Tavily "basic" = 1 credit. The weekly run is
 *   10 scoped searches = 10 credits (+5 if the broader pass is switched on). The "closing soon" pages cost nothing:
 * zabursaries publishes one page per month at a predictable URL, so they are
 * built and checked directly (Tavily's index missed the current month's page).
 */

import { isValidDate, todayInSA } from '../PUBLISH/entry-meta.js';

export const OPPS_LABEL = 'opportunity-digest';
export const OPPS_LABEL_META = {
  color: '1d76db',
  description: 'Weekly lead list of bursaries, learnerships and jobs — for human review',
};

const TAVILY_URL = 'https://api.tavily.com/search';

const ZA = 'zabursaries.co.za';
const G24 = 'graduates24.com';
const TRUSTED = [ZA, G24];

// Postings go stale fast, so jobs, learnerships, programmes, training and the
// whole broader pass only look at the last month (checked with a dry run: without
// it Tavily returns generic listing pages, with it, specific recent postings).
// Bursary faculty hubs are evergreen, so they get no window.
const RECENT = 'month';

const MAX_RESULTS = { scoped: 5, broad: 5 };

// The broader pass drops the two trusted sites, social media (where the Instagram
// "reel" links came from) and job-board aggregators.
const BROAD_EXCLUDE = [
  ...TRUSTED,
  'instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'x.com', 'twitter.com',
  // Job-board search pages ("2026 Graduate Programmes jobs in Gauteng") are
  // listings, not leads, and LinkedIn is out of scope for this version.
  'indeed.com', 'glassdoor.com', 'linkedin.com', 'jooble.org', 'careerjet.co.za', 'ziprecruiter.com',
];
const MAX_DESC = 180;

/** Matches the faculty headings the README already uses. */
const FACULTIES = [
  ['Commerce', 'commerce accounting finance economics'],
  ['Engineering', 'engineering'],
  ['Science', 'science maths computer science'],
  ['Health Sciences', 'medicine nursing pharmacy health sciences'],
  ['Humanities', 'humanities education social sciences'],
  ['Law', 'law LLB'],
];

const OTHER = [
  ['Learnerships', 'learnership programme South Africa'],
  ['Graduate programmes', 'graduate programme South Africa'],
  ['Job openings', 'entry level job opening youth South Africa'],
  ['Training & vac work', 'vacation work internship training programme South Africa'],
];

/** Display order of the category sections. */
const CATEGORY_ORDER = ['Bursaries', ...OTHER.map(([c]) => c)];

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/* ------------------------------------------------------------------ *
 * The searches that make up one run
 * ------------------------------------------------------------------ */

/**
 * The searches for one run. The cron uses the defaults (the trusted pass only);
 * `overrides` exist so queries can be tuned from the command line without
 * editing code:
 *   broad       also run the broader whole-web pass (off by default; also on
 *               when `only` names it)
 *   only        keep searches whose pass, category or faculty matches any of these
 *   query       replace the query text of the searches that are kept
 *   timeRange   'day' | 'week' | 'month' | 'year', or 'none' to remove the window
 *   maxResults  results per search
 *   minScore    drop results Tavily scored below this (0 to 1)
 */
export function planSearches(overrides = {}) {
  const searches = [];

  // Bursary faculties: zabursaries is the bursary specialist. graduates24's
  // answers to these queries were interview tips and job ads.
  for (const [tag, terms] of FACULTIES) {
    searches.push({
      pass: 'scoped',
      category: 'Bursaries',
      tag,
      query: `${terms} bursary South Africa`,
      include: [ZA],
      maxResults: MAX_RESULTS.scoped,
    });
  }
  for (const [category, query] of OTHER) {
    searches.push({ pass: 'scoped', category, query, include: TRUSTED, maxResults: MAX_RESULTS.scoped, timeRange: RECENT });
  }

  // BROAD: the whole web minus the trusted sites, nudged towards South Africa,
  // one search per category. Off by default. In real runs it returned job-board
  // listings, foreign employers and generic careers pages alongside a few good
  // leads, so half of a weekly issue was noise. Run it with --with-broad (or
  // --only broad) while tuning; once --min-score or the queries make it
  // trustworthy, switch it on in the cron by passing { broad: true }.
  searches.push({
    pass: 'broad',
    category: 'Bursaries',
    query: 'bursary applications open South Africa',
    exclude: BROAD_EXCLUDE,
    maxResults: MAX_RESULTS.broad,
    timeRange: RECENT,
  });
  for (const [category, query] of OTHER) {
    searches.push({ pass: 'broad', category, query, exclude: BROAD_EXCLUDE, maxResults: MAX_RESULTS.broad, timeRange: RECENT });
  }

  const wantsBroad = overrides.broad || (overrides.only || []).some((w) => /broad/i.test(w));
  return applyOverrides(wantsBroad ? searches : searches.filter((s) => s.pass !== 'broad'), overrides);
}

export function searchLabel(s) {
  return `${s.pass} · ${s.tag || s.category}`;
}

function applyOverrides(searches, { only, query, timeRange, maxResults, minScore } = {}) {
  let out = searches;

  if (only && only.length) {
    const wanted = only.map((w) => w.trim().toLowerCase()).filter(Boolean);
    out = out.filter((s) => {
      const hay = [s.pass, s.category, s.tag || ''].map((x) => x.toLowerCase());
      return wanted.some((w) => hay.some((h) => h.includes(w)));
    });
  }

  return out.map((s) => {
    const next = { ...s };
    if (query) next.query = query;
    if (maxResults) next.maxResults = maxResults;
    if (minScore) next.minScore = minScore;
    if (timeRange) {
      if (timeRange === 'none') delete next.timeRange;
      else next.timeRange = timeRange;
    }
    return next;
  });
}

/** True when the closing-soon pages belong in a run limited by `only`. */
export function includesClosing(only) {
  return !only || !only.length || only.some((w) => /closing|^all$/i.test(w.trim()));
}

/**
 * zabursaries keeps "closing soon" on one page per month, at
 * /bursaries-closing-in-<month>-<year>/. Build this month's and the next two
 * and keep the ones that exist. Only a 404/410 rules a page out: a blocked or
 * slow request still yields a lead, since a human reviews the list anyway.
 */
export async function closingPages({ now = new Date(), fetchPage = fetch } = {}) {
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    pages.push({ label, url: `https://www.${ZA}/bursaries-closing-in-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}/` });
  }

  const checked = await Promise.all(
    pages.map(async (page) => {
      try {
        const res = await fetchPage(page.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; mzantsi-vibes-digest)' },
          signal: AbortSignal.timeout(10000),
        });
        return res.status === 404 || res.status === 410 ? null : page;
      } catch {
        return page;
      }
    })
  );

  return checked.filter(Boolean).map(({ label, url }) => {
    const [month, year] = label.split(' ');
    const name = month[0].toUpperCase() + month.slice(1);
    return {
      title: `Bursaries closing in ${name} ${year}`,
      url,
      desc: `zabursaries' running list of bursaries closing in ${name} ${year}.`,
      source: 'zabursaries',
      pass: 'closing',
      category: 'Closing soon',
      tag: null,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Tavily
 * ------------------------------------------------------------------ */

export async function searchTavily({ key, search, fetchImpl = fetch }) {
  const body = {
    query: search.query,
    search_depth: 'basic', // 1 credit
    topic: 'general',
    max_results: search.maxResults,
    ...(search.include ? { include_domains: search.include } : {}),
    ...(search.exclude ? { exclude_domains: search.exclude } : {}),
    ...(search.pass === 'broad' ? { country: 'south africa' } : {}),
    ...(search.timeRange ? { time_range: search.timeRange } : {}),
  };

  const res = await fetchImpl(TAVILY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Tavily ${res.status}${res.status === 401 ? ' (check TAVILY_API_KEY)' : ''}: ${detail}`);
  }

  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

/* ------------------------------------------------------------------ *
 * Turning results into findings
 * ------------------------------------------------------------------ */

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function sourceOf(url) {
  const host = hostOf(url);
  if (host === ZA || host.endsWith(`.${ZA}`)) return 'zabursaries';
  if (host === G24 || host.endsWith(`.${G24}`)) return 'graduates24';
  return 'broader search';
}

/** Same page, different tracking junk, should count once. */
function urlKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    }
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Web text goes into an issue that notifies people and renders links, so keep
 * it inert: no @mentions, no brackets that break the link, no table pipes.
 */
export function inert(text) {
  return String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\[\]|]/g, ' ')
    .replace(/@/g, '@​')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tavily's snippet is whatever chunk of the page matched best, which on these
 * sites is often menu text. Strip the markup and boilerplate we can recognise;
 * what is left is still a hint for a human, not a polished summary.
 */
function cleanSnippet(text, title = '') {
  let t = String(text ?? '');
  // The result's own title is often repeated at the start ("Title: Hatch: ...").
  if (title) t = t.split(title).join(' ');
  t = t
    .replace(/\bTitle:\s*/gi, '')
    .replace(/\*+/g, '')
    // "...Join our WhatsApp Channel for daily updates on the latest Internships,
    // Learnerships, Graduate Programmes and Bursaries" — the whole sentence.
    .replace(/Join our\s+WhatsApp Channel[\s\S]*?(?:and\s+Bursaries|and\s*…|and\s*\.\.\.|$)/gi, '')
    // Everything after these is the site's sidebar: other people's listings.
    .replace(/(Create (My|Your) CV|Build a professional CV|Other Opportunities)[\s\S]*$/i, '')
    .replace(/\b(Apply Now|Share on \w+|Stay Updated)\b/gi, '');

  return inert(t)
    .replace(/#+\s*/g, '')
    .replace(/\\+/g, ' ')
    .replace(/(^|\s)\+\s+/g, '$1')
    .replace(/(\.{2,3}|…)\s*read more/gi, '')
    .replace(/\bread more\b/gi, '')
    .replace(/^(posted|listed)[:\s]+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.-]+/, '')
    .trim();
}

export function oneLine(text, max = MAX_DESC, title = '') {
  const s = cleanSnippet(text, title);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:.\s-]+$/, '') + '…';
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/\(/g, '%28').replace(/\)/g, '%29') : null;
  } catch {
    return null;
  }
}

/**
 * Pages that are never a lead: the site home, on-site search results,
 * pagination, and boilerplate. (Seen in a real run: "Contact SA Bursaries",
 * "Common Interview Questions", and /?s=pharmacy filed under a faculty.)
 */
export function isNoise(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  const path = u.pathname.replace(/\/+$/, '');
  if (path === '') return true;
  if (u.searchParams.has('s') || u.searchParams.has('page')) return true;
  return /^\/(contact|about|about-us|privacy|privacy-policy|terms|cookie|interview[-_]questions|create[-_]cv|bursary-news|universities)\b/i.test(path);
}

/** "BBD Bursary 2025 - 2026" is fine; "Bursaries 2024" is last year's news. */
export function isStale(title, now = new Date()) {
  const years = (title.match(/\b(20\d\d)\b/g) || []).map(Number);
  return years.length > 0 && Math.max(...years) < now.getUTCFullYear();
}

/**
 * zabursaries files each bursary under its faculty in the URL
 * (/engineering-bursaries-south-africa/sasol-bursary). That is more reliable
 * than whichever faculty query happened to find it first: a real run filed
 * Sasol under Humanities. null means "General".
 */
export function facultyFromUrl(url) {
  const seg = (() => { try { return new URL(url).pathname.split('/')[1] || ''; } catch { return ''; } })().toLowerCase();
  if (/^(accounting|commerce)/.test(seg)) return 'Commerce';
  if (/^(engineering|construction)/.test(seg)) return 'Engineering';
  if (/^(computer-science|science)/.test(seg)) return 'Science';
  if (/^medical/.test(seg)) return 'Health Sciences';
  if (/^(education|arts)/.test(seg)) return 'Humanities';
  if (/^law/.test(seg)) return 'Law';
  return null;
}

/* ------------------------------------------------------------------ *
 * Closing dates
 * ------------------------------------------------------------------ */

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// "30 November 2026", "30th of Nov 2026", "November 30, 2026", "2026-11-30", "30/11/2026" (South Africa writes day first)
const DATE_PART = [
  `(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+(20\\d\\d)`,
  `${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)`,
  `(20\\d\\d)-(\\d{2})-(\\d{2})`,
  `(\\d{1,2})[/.](\\d{1,2})[/.](20\\d\\d)`,
].join('|');
// A closing word, then a few non-sentence characters, then the date. No "." or
// line break in between: "applications close. Interviews are on 4 Dec 2026" must not match.
const CLOSING_RE = new RegExp(
  `\\b(?:clos(?:es|ing|ed|e)(?:\\s+date)?|deadline|apply\\s+(?:by|before)|due(?:\\s+date)?|no\\s+later\\s+than)\\b[^\\d.\\n!?]{0,30}?(?:${DATE_PART})`,
  'gi'
);

const pad = (n) => String(n).padStart(2, '0');
const monthNumber = (m) => MONTHS.findIndex((full) => full.startsWith(m.toLowerCase().slice(0, 3))) + 1;

/** Turn one regex hit's groups into YYYY-MM-DD, or null if it is not a real date. */
function isoFromGroups(g) {
  const [dMon, mon1, y1, mon2, d2, y2, y3, m3, d3, dd4, mm4, y4] = g;
  let y, m, d;
  if (y1) { d = Number(dMon); m = monthNumber(mon1); y = Number(y1); }
  else if (y2) { d = Number(d2); m = monthNumber(mon2); y = Number(y2); }
  else if (y3) { y = Number(y3); m = Number(m3); d = Number(d3); }
  else { d = Number(dd4); m = Number(mm4); y = Number(y4); }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidDate(iso) ? iso : null;
}

/**
 * Find the closing date in a result's title and snippet. Conservative on purpose:
 * a date is only taken when a closing word sits right before it, and when the
 * text names more than one closing date it is the sidebar's list of other
 * listings, so no date is reported rather than a wrong one. A wrong deadline is
 * worse than a missing one. A year is required.
 * Returns { date, past } or null. `past` means it has already closed.
 */
export function extractDeadline(text, now = new Date()) {
  const found = new Set();
  for (const m of String(text ?? '').matchAll(CLOSING_RE)) {
    const iso = isoFromGroups(m.slice(1));
    if (iso) found.add(iso);
  }
  if (found.size !== 1) return null;
  const [date] = found;
  return { date, past: date < todayInSA(now) };
}

const DATE_RE = /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d\d\b/gi;

/**
 * Drop a description that is not about the page. Too little left after
 * stripping the chrome means it was all chrome; two or more dates means it is
 * the sidebar list of *other* listings ("Pretoria Closes 09 Oct 2026 Inlumi: ...
 * 30 Sep 2026 NTT DATA: ..."), not this one. The title still carries the lead.
 */
export function usableDesc(desc) {
  if (desc.length < 10) return '';
  if ((desc.match(DATE_RE) || []).length >= 2) return '';
  return desc;
}

const SA_RE = /south africa|gauteng|western cape|eastern cape|kwazulu|limpopo|mpumalanga|free state|north west|northern cape|johannesburg|cape town|durban|pretoria|midrand|sandton|bloemfontein|gqeberha|port elizabeth|stellenbosch|soweto/i;

/** Broader results come from anywhere; keep ones with some South Africa signal. */
export function looksSouthAfrican(result) {
  return /\.za(\/|$)/i.test(hostOf(result.url) + '/') || SA_RE.test(`${result.title} ${result.content}`);
}

/**
 * Decide what to do with one search result: a finding to keep, or the reason it
 * was dropped (shown by --explain so the filters can be tuned with evidence).
 */
function judge(result, search, now) {
  const url = safeUrl(result.url);
  if (!url) return { reason: 'not a usable http(s) link' };
  if (search.minScore && !(result.score >= search.minScore)) {
    return { reason: `relevance score ${result.score?.toFixed(2) ?? '?'} is below ${search.minScore}` };
  }
  if (isNoise(url)) return { reason: 'noise page (home, search, pagination, contact…)' };
  if (search.pass === 'broad' && !looksSouthAfrican(result)) return { reason: 'no South Africa signal' };

  const title = oneLine(result.title, 120) || hostOf(url);
  if (isStale(title, now)) return { reason: 'title only mentions past years' };

  const deadline = extractDeadline(`${result.title}. ${result.content}`, now);
  if (deadline?.past) return { reason: `closing date ${deadline.date} has already passed` };

  const source = sourceOf(url);
  return {
    finding: {
      title,
      url,
      desc: usableDesc(oneLine(result.content, MAX_DESC, result.title)),
      source,
      ...(deadline && { closes: deadline.date }),
      pass: search.pass,
      category: search.category,
      tag: search.category !== 'Bursaries' ? null : source === 'zabursaries' ? facultyFromUrl(url) : search.tag || null,
    },
  };
}

/**
 * Run every search, keep what each one's filter allows, and drop repeats
 * within this run (a bursary matches several faculty queries). Earlier passes
 * win, so a trusted-source hit is never replaced by a broader one.
 */
export async function collect({ key, searches, fetchImpl, now = new Date(), onResult }) {
  const settled = await Promise.allSettled(searches.map((s) => searchTavily({ key, search: s, fetchImpl })));

  const seen = new Set();
  const findings = [];
  const failures = [];

  settled.forEach((outcome, i) => {
    const search = searches[i];
    if (outcome.status === 'rejected') {
      failures.push(`${searchLabel(search)}: ${outcome.reason?.message || outcome.reason}`);
      onResult?.({ search, error: outcome.reason?.message || String(outcome.reason) });
      return;
    }
    for (const result of outcome.value) {
      const { finding, reason } = judge(result, search, now);
      if (!finding) {
        onResult?.({ search, result, kept: false, reason });
        continue;
      }
      const k = urlKey(finding.url);
      if (seen.has(k)) {
        onResult?.({ search, result, kept: false, reason: 'duplicate of a result already kept' });
        continue;
      }
      seen.add(k);
      findings.push(finding);
      onResult?.({ search, result, kept: true, finding });
    }
  });

  return { findings, failures, searched: searches.length };
}

/* ------------------------------------------------------------------ *
 * The issue
 * ------------------------------------------------------------------ */

const bullet = (f) =>
  `- [${f.title}](${f.url})${f.desc ? ` — ${f.desc}` : ''} · _${f.source}_${f.closes ? ` · **closes ${f.closes}**` : ''}`;

/* ------------------------------------------------------------------ *
 * Paste-ready entries for OPPORTUNITIES.md
 * ------------------------------------------------------------------ */

// Where each category belongs in OPPORTUNITIES.md (same pillar and section names as the README).
const DESTINATION = {
  Bursaries: { pillar: "🎓 I'm Going to Study", section: 'Paying for It', tag: 'bursary' },
  Learnerships: { pillar: "💼 I'm Going to Work", section: 'Finding Work', tag: 'learnership' },
  'Graduate programmes': { pillar: "💼 I'm Going to Work", section: 'Finding Work', tag: 'graduate-programme' },
  'Job openings': { pillar: "💼 I'm Going to Work", section: 'Finding Work', tag: 'job' },
  'Training & vac work': { pillar: "💼 I'm Going to Work", section: 'Finding Work', tag: 'vac-work' },
};

const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** One line in the OPPORTUNITIES.md format (see that file), or null if it has no deadline. */
export function entryLine(f) {
  const dest = DESTINATION[f.category];
  if (!dest || !f.closes) return null;
  // Web text must not be able to add or break the {…} block, or split the name at an em dash.
  const clean = (t) => String(t).replace(/[{}]/g, '').replace(/\s[—–]\s/g, ' - ').trim();
  const tags = [dest.tag, f.tag && slug(f.tag), 'deadline'].filter(Boolean);
  const desc = f.desc ? ` — ${clean(f.desc)}` : '';
  return `-   [${clean(f.title)}](${f.url})${desc} {closes: ${f.closes}; tags: ${[...new Set(tags)].join(', ')}; source: ${hostOf(f.url)}}`;
}

/** The "Ready to paste" block: only leads with a deadline found, grouped by where they go. */
export function pasteBlock(findings) {
  const groups = new Map();
  for (const f of findings) {
    const line = entryLine(f);
    if (!line) continue;
    const { pillar, section } = DESTINATION[f.category];
    const key = `${pillar}\u0000${section}`;
    groups.set(key, [...(groups.get(key) || []), line]);
  }
  if (!groups.size) return [];

  const total = [...groups.values()].reduce((n, l) => n + l.length, 0);
  const out = ['---', '', '<details>', `<summary>📋 Ready to paste into OPPORTUNITIES.md (${total} with a closing date)</summary>`, '',
    'Check each date against the page first, then add the line under its heading. Leads without a closing date are not here: they could never expire.', ''];
  for (const [key, lines] of groups) {
    const [pillar, section] = key.split('\u0000');
    out.push(`Under \`## ${pillar}\` → \`### ${section}\`:`, '', '```markdown', ...lines, '```', '');
  }
  out.push('</details>', '');
  return out;
}

function section(heading, level, items) {
  const h = '#'.repeat(level);
  return items.length ? [`${h} ${heading}`, '', ...items.map(bullet), ''] : [`${h} ${heading}`, '', '_Nothing found this run._', ''];
}

function categoryBlock(findings, category, level) {
  const inCat = findings.filter((f) => f.category === category);
  if (category !== 'Bursaries') return section(category, level, inCat);

  // Bursaries by faculty, matching the README's own groupings. When nothing
  // has a faculty (the broader pass), a "General" subheading adds nothing.
  const lines = [`${'#'.repeat(level)} Bursaries`, ''];
  if (!inCat.length) return [...lines, '_Nothing found this run._', ''];
  if (inCat.every((f) => !f.tag)) return [...lines, ...inCat.map(bullet), ''];

  const tags = [...FACULTIES.map(([t]) => t), null];
  for (const tag of tags) {
    const items = inCat.filter((f) => f.tag === tag);
    if (items.length) lines.push(...section(tag || 'General', level + 1, items));
  }
  return lines;
}

/** SAST is UTC+2 all year, and the issue title should show the local date. */
export function sastDate(now = new Date()) {
  return new Date(now.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

export function renderDigest({ findings, failures, searched, now = new Date(), withBroad = findings.some((f) => f.pass === 'broad') }) {
  const trusted = findings.filter((f) => f.pass !== 'broad');
  const broad = findings.filter((f) => f.pass === 'broad');
  const closing = trusted.filter((f) => f.category === 'Closing soon');
  const scoped = trusted.filter((f) => f.category !== 'Closing soon');

  const body = [
    `Leads for a human to review — **nothing here is in the README**. ` +
      `${findings.length} links from ${searched} searches on ${sastDate(now)}.`,
    '',
    withBroad
      ? `Trusted sources first (zabursaries.co.za, graduates24.com); the broader search at the bottom is less trusted, so check it before relying on it.`
      : `Sources: zabursaries.co.za and graduates24.com.`,
    '',
    ...section('⏰ Closing soon', 2, closing),
    ...CATEGORY_ORDER.flatMap((c) => categoryBlock(scoped, c, 2)),
  ];

  if (withBroad) {
    body.push('---', '', '## 🌍 Broader search (less trusted)', '', ...CATEGORY_ORDER.flatMap((c) => categoryBlock(broad, c, 3)));
  }

  body.push(...pasteBlock(findings.filter((f) => f.pass !== 'closing')));

  if (failures.length) {
    body.push('---', '', `⚠️ ${failures.length} of ${searched} searches failed, so this list is incomplete:`, '');
    body.push(...failures.map((f) => `- ${inert(f)}`), '');
  }

  return { title: `Opportunity digest — ${sastDate(now)}`, body: body.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}

/* ------------------------------------------------------------------ *
 * Entry point (cron and the local script share this)
 * ------------------------------------------------------------------ */

export async function runOpportunityDigest({ config, gh, fetchImpl, fetchPage, dryRun = false, now = new Date(), searches: planned, skipClosing = false, onResult }) {
  if (!config.tavilyKey) {
    throw new Error('TAVILY_API_KEY is not set. Add it with: wrangler secret put TAVILY_API_KEY');
  }

  const searches = planned || planSearches();
  const [closing, collected] = await Promise.all([
    skipClosing ? [] : closingPages({ now, fetchPage }),
    collect({ key: config.tavilyKey, searches, fetchImpl, now, onResult }),
  ]);
  const { failures, searched } = collected;
  const findings = [...closing, ...collected.findings];

  // Every search failing means a bad key or an outage. Don't open an empty issue.
  if (failures.length === searched) {
    throw new Error(`All ${searched} searches failed. First error: ${failures[0]}`);
  }

  const { title, body } = renderDigest({ findings, failures, searched, now, withBroad: searches.some((s) => s.pass === 'broad') });
  const summary = { title, findings: findings.length, searches: searched, credits: searched, failures: failures.length };

  if (dryRun) return { ...summary, body, issueUrl: null };

  // The label is a convenience; losing it should not lose the digest.
  let labels = [];
  try {
    await gh.ensureLabel(config.owner, config.repo, OPPS_LABEL, OPPS_LABEL_META.color, OPPS_LABEL_META.description);
    labels = [OPPS_LABEL];
  } catch (err) {
    console.warn('opportunity label unavailable:', err?.message || err);
  }

  const issue = await gh.createIssue(config.owner, config.repo, { title, body, labels });
  return { ...summary, issueUrl: issue.html_url, issueNumber: issue.number };
}
