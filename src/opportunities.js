/**
 * Weekly opportunity digest.
 *
 * Searches two known-good SA sites (then, as a clearly secondary pass, the
 * wider web) for bursaries, learnerships, graduate programmes, jobs and
 * training, and posts what it finds as ONE GitHub issue for a human to read.
 *
 * It is a leads list, not a publisher: nothing here touches the README, and
 * there is deliberately no deduplication against earlier runs.
 *
 * Cost: every search is Tavily "basic" = 1 credit. A run is
 *   2 closing-soon + 10 scoped + 5 broader = 17 credits.
 */

export const OPPS_LABEL = 'opportunity-digest';
export const OPPS_LABEL_META = {
  color: '1d76db',
  description: 'Weekly lead list of bursaries, learnerships and jobs — for human review',
};

const TAVILY_URL = 'https://api.tavily.com/search';

const ZA = 'zabursaries.co.za';
const G24 = 'graduates24.com';
const TRUSTED = [ZA, G24];

// Left unset on purpose: bursary pages stay valid for months, so a window would
// hide good leads. Try 'month' in a --dry-run if the lists feel stale.
const TIME_RANGE = null;

const MAX_RESULTS = { scoped: 5, closing: 10, broad: 5 };
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
 * zabursaries' "closing soon" content is a page per month
 * (/bursaries-closing-in-november-2026/), so ask for this month's and next
 * month's by name rather than hoping a generic query surfaces them.
 */
function closingMonths(now) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    out.push(`${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
  }
  return out;
}

const CLOSING_URL_RE = /\/(bursaries-closing-in-|bursary-news\/)/i;

export function planSearches(now = new Date()) {
  const searches = [];

  for (const month of closingMonths(now)) {
    searches.push({
      pass: 'closing',
      category: 'Closing soon',
      query: `bursaries closing in ${month}`,
      include: [ZA],
      maxResults: MAX_RESULTS.closing,
      keep: (r) => CLOSING_URL_RE.test(r.url),
    });
  }

  for (const [tag, terms] of FACULTIES) {
    searches.push({
      pass: 'scoped',
      category: 'Bursaries',
      tag,
      query: `${terms} bursary South Africa`,
      include: TRUSTED,
      maxResults: MAX_RESULTS.scoped,
    });
  }
  for (const [category, query] of OTHER) {
    searches.push({ pass: 'scoped', category, query, include: TRUSTED, maxResults: MAX_RESULTS.scoped });
  }

  // Second layer: the whole web minus the two sites already covered, nudged
  // towards South Africa. One search per category, not per faculty.
  searches.push({
    pass: 'broad',
    category: 'Bursaries',
    query: 'bursary applications open South Africa',
    exclude: TRUSTED,
    maxResults: MAX_RESULTS.broad,
  });
  for (const [category, query] of OTHER) {
    searches.push({ pass: 'broad', category, query, exclude: TRUSTED, maxResults: MAX_RESULTS.broad });
  }

  return searches;
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
    ...(TIME_RANGE ? { time_range: TIME_RANGE } : {}),
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

export function oneLine(text, max = MAX_DESC) {
  const s = inert(text);
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

function toFinding(result, search) {
  const url = safeUrl(result.url);
  if (!url) return null;
  return {
    title: oneLine(result.title, 120) || hostOf(url),
    url,
    desc: oneLine(result.content),
    source: sourceOf(url),
    pass: search.pass,
    category: search.category,
    tag: search.tag || null,
  };
}

/**
 * Run every search, keep what each one's filter allows, and drop repeats
 * within this run (a bursary matches several faculty queries). Earlier passes
 * win, so a trusted-source hit is never replaced by a broader one.
 */
export async function collect({ key, searches, fetchImpl }) {
  const settled = await Promise.allSettled(searches.map((s) => searchTavily({ key, search: s, fetchImpl })));

  const seen = new Set();
  const findings = [];
  const failures = [];

  settled.forEach((outcome, i) => {
    const search = searches[i];
    if (outcome.status === 'rejected') {
      failures.push(`${search.pass} · ${search.tag || search.category}: ${outcome.reason?.message || outcome.reason}`);
      return;
    }
    for (const result of outcome.value) {
      if (search.keep && !search.keep(result)) continue;
      const finding = toFinding(result, search);
      if (!finding) continue;
      const k = urlKey(finding.url);
      if (seen.has(k)) continue;
      seen.add(k);
      findings.push(finding);
    }
  });

  return { findings, failures, searched: searches.length };
}

/* ------------------------------------------------------------------ *
 * The issue
 * ------------------------------------------------------------------ */

const bullet = (f) => `- [${f.title}](${f.url})${f.desc ? ` — ${f.desc}` : ''} · _${f.source}_`;

function section(heading, level, items) {
  const h = '#'.repeat(level);
  return items.length ? [`${h} ${heading}`, '', ...items.map(bullet), ''] : [`${h} ${heading}`, '', '_Nothing found this run._', ''];
}

function categoryBlock(findings, category, level) {
  const inCat = findings.filter((f) => f.category === category);
  if (category !== 'Bursaries') return section(category, level, inCat);

  // Bursaries by faculty, matching the README's own groupings.
  const lines = [`${'#'.repeat(level)} Bursaries`, ''];
  if (!inCat.length) return [...lines, '_Nothing found this run._', ''];
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

export function renderDigest({ findings, failures, searched, now = new Date() }) {
  const trusted = findings.filter((f) => f.pass !== 'broad');
  const broad = findings.filter((f) => f.pass === 'broad');
  const closing = trusted.filter((f) => f.category === 'Closing soon');
  const scoped = trusted.filter((f) => f.category !== 'Closing soon');

  const body = [
    `Leads for a human to review — **nothing here is in the README**. ` +
      `${findings.length} links from ${searched} searches on ${sastDate(now)}.`,
    '',
    `Trusted sources first (zabursaries.co.za, graduates24.com); the broader search at the bottom is less trusted, so check it before relying on it.`,
    '',
    ...section('⏰ Closing soon', 2, closing),
    ...CATEGORY_ORDER.flatMap((c) => categoryBlock(scoped, c, 2)),
    '---',
    '',
    '## 🌍 Broader search (less trusted)',
    '',
    ...CATEGORY_ORDER.flatMap((c) => categoryBlock(broad, c, 3)),
  ];

  if (failures.length) {
    body.push('---', '', `⚠️ ${failures.length} of ${searched} searches failed, so this list is incomplete:`, '');
    body.push(...failures.map((f) => `- ${inert(f)}`), '');
  }

  return { title: `Opportunity digest — ${sastDate(now)}`, body: body.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}

/* ------------------------------------------------------------------ *
 * Entry point (cron and the local script share this)
 * ------------------------------------------------------------------ */

export async function runOpportunityDigest({ config, gh, fetchImpl, dryRun = false, now = new Date() }) {
  if (!config.tavilyKey) {
    throw new Error('TAVILY_API_KEY is not set. Add it with: wrangler secret put TAVILY_API_KEY');
  }

  const searches = planSearches(now);
  const { findings, failures, searched } = await collect({ key: config.tavilyKey, searches, fetchImpl });

  // Every search failing means a bad key or an outage. Don't open an empty issue.
  if (failures.length === searched) {
    throw new Error(`All ${searched} searches failed. First error: ${failures[0]}`);
  }

  const { title, body } = renderDigest({ findings, failures, searched, now });
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
