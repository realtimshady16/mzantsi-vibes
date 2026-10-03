/**
 * Weekly opportunity digest — search plan, filtering, issue rendering, and the
 * budget. Tavily and GitHub are both faked: no network, no credits spent.
 *
 * Run: node test/test-opportunities.mjs
 */
import {
  usableDesc, looksSouthAfrican, planSearches, closingPages, collect, renderDigest, runOpportunityDigest, sourceOf, oneLine, inert, sastDate,
  isNoise, isStale, facultyFromUrl, includesClosing, OPPS_LABEL,
  extractDeadline, entryLine, pasteBlock, parseClosingLists, genericDesc, ZA_CRAWL_DELAY_MS,
} from '../src/opportunities.js';
import { splitEntryMeta } from '../PUBLISH/entry-meta.js';
import { parseReadme } from '../PUBLISH/content-parse.js';
import { applyNew } from '../src/readme.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

const NOW = new Date('2026-10-05T05:00:00Z'); // a Monday

/** A fake Tavily: records every request and answers from `handler`. */
function fakeTavily(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const out = handler(body, calls.length);
    if (out instanceof Error) throw out;
    if (typeof out === 'number') return { ok: false, status: out, text: async () => 'nope', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: out }) };
  };
  return { fetchImpl, calls };
}

const result = (title, url, content = 'A description.') => ({ title, url, content, score: 0.9 });

/* -------------------------------------------------------------- */
sec('the plan and the budget');
// `plan` is the full 15 so the broader-pass machinery stays covered; the weekly
// default is checked separately just below.
const plan = planSearches({ broad: true });
const by = (pass) => plan.filter((s) => s.pass === pass);
const weekly = planSearches();
ok('the weekly run is 10 searches = 10 credits (budget is "well under 50")', weekly.length === 10, String(weekly.length));
ok('the weekly run leaves out the broader pass (it was mostly noise)', weekly.every((s) => s.pass === 'scoped'));
ok('opting in adds the 5 broader searches: 15 in all', plan.length === 15 && by('scoped').length === 10 && by('broad').length === 5);
ok('six faculties, matching the README', ['Commerce', 'Engineering', 'Science', 'Health Sciences', 'Humanities', 'Law']
  .every((f) => by('scoped').some((s) => s.tag === f)));
ok('learnerships, graduate programmes, jobs and training are all covered',
  ['Learnerships', 'Graduate programmes', 'Job openings', 'Training & vac work']
    .every((c) => by('scoped').some((s) => s.category === c) && by('broad').some((s) => s.category === c)));
ok('faculty bursary searches go to zabursaries only',
  by('scoped').filter((s) => s.category === 'Bursaries').every((s) => s.include.length === 1 && s.include[0] === 'zabursaries.co.za'));
ok('every other scoped search is limited to the two trusted sites',
  by('scoped').filter((s) => s.category !== 'Bursaries').every((s) => s.include.length === 2 && s.include.includes('graduates24.com')));
ok('broader searches exclude the two trusted sites, so they only add new sources',
  by('broad').every((s) => !s.include && s.exclude.includes('zabursaries.co.za') && s.exclude.includes('graduates24.com')));
ok('broader searches also exclude social media and job-board search pages',
  by('broad').every((s) => s.exclude.includes('instagram.com') && s.exclude.includes('indeed.com') && s.exclude.includes('linkedin.com')));
ok('time-sensitive searches look at the last month; evergreen faculty hubs do not',
  by('broad').every((s) => s.timeRange === 'month') &&
  by('scoped').filter((s) => s.category !== 'Bursaries').every((s) => s.timeRange === 'month') &&
  by('scoped').filter((s) => s.category === 'Bursaries').every((s) => !s.timeRange));

sec('tuning overrides (the on-demand script uses these; the cron does not)');
{
  ok('no overrides = the same 10 searches the cron runs', planSearches().length === 10 && planSearches({}).length === 10);
  ok('--with-broad adds the broader pass', planSearches({ broad: true }).length === 15);
  ok('--only broad turns the broader pass on by itself', planSearches({ only: ['broad'] }).length === 5 && planSearches({ only: ['broad'] }).every((s) => s.pass === 'broad'));
  ok('--only matches the category, case-insensitively', planSearches({ only: ['job'] }).length === 1 && planSearches({ only: ['JOB'] }).length === 1 && planSearches({ only: ['job'], broad: true }).length === 2);
  ok('--only matches a faculty', planSearches({ only: ['law'] }).map((s) => s.tag).join() === 'Law');
  ok('--only matches a whole pass', planSearches({ only: ['scoped'] }).length === 10);
  ok('several --only terms combine', planSearches({ only: ['law', 'learnership'] }).length === 2 && planSearches({ only: ['law', 'learnership'], broad: true }).length === 3);
  ok('--query replaces the query text of the selected searches only',
    planSearches({ only: ['job'], query: 'x', broad: true }).every((s) => s.query === 'x') && planSearches({ only: ['job'], query: 'x', broad: true }).length === 2);
  ok('--time-range overrides, and "none" removes the window',
    planSearches({ only: ['job'], timeRange: 'week', broad: true }).every((s) => s.timeRange === 'week') &&
    planSearches({ only: ['job'], timeRange: 'none', broad: true }).every((s) => !('timeRange' in s)));
  ok('--max-results overrides', planSearches({ only: ['job'], maxResults: 9 }).every((s) => s.maxResults === 9));
  ok('overrides never mutate the defaults', (() => { planSearches({ only: ['job'], query: 'x', timeRange: 'none' }); return planSearches().every((s) => s.query !== 'x'); })());
  ok('closing-soon pages are included unless --only leaves them out',
    includesClosing(undefined) && includesClosing([]) && !includesClosing(['job']) && includesClosing(['closing']) && includesClosing(['job', 'closing']));

  // --explain and --min-score: every decision is reported, with a reason.
  const events = [];
  const t2 = fakeTavily(() => [
    { title: 'Good', url: 'https://www.graduates24.com/good-2027', content: 'A real lead for people.', score: 0.9 },
    { title: 'Weak', url: 'https://www.graduates24.com/weak-2027', content: 'Meh content here ok.', score: 0.2 },
    { title: 'Home', url: 'https://www.graduates24.com/', content: 'x', score: 0.9 },
    { title: 'Good again', url: 'https://www.graduates24.com/good-2027/', content: 'dup', score: 0.8 },
  ]);
  const one = planSearches({ only: ['job'], minScore: 0.5 }).slice(0, 1);
  ok('--min-score is carried on the search', one[0].minScore === 0.5);
  const out = await collect({ key: 'k', searches: one, fetchImpl: t2.fetchImpl, now: NOW, onResult: (e) => events.push(e) });
  ok('--min-score drops weak results', out.findings.length === 1 && out.findings[0].title === 'Good');
  ok('every result is reported, kept or dropped', events.length === 4 && events.filter((e) => e.kept).length === 1);
  ok('a drop carries its reason',
    /below 0.5/.test(events.find((e) => e.result.title === 'Weak').reason) &&
    /noise/.test(events.find((e) => e.result.title === 'Home').reason) &&
    /duplicate/.test(events.find((e) => e.result.title === 'Good again').reason));
  const failing = [];
  await collect({ key: 'k', searches: one, fetchImpl: fakeTavily(() => 500).fetchImpl, now: NOW, onResult: (e) => failing.push(e) });
  ok('a failed search is reported too', failing.length === 1 && /Tavily 500/.test(failing[0].error));
}

sec('closing-soon pages (built, not searched)');
{
  const asked = [];
  const pageFetch = async (url) => { asked.push(url); return { status: /december/.test(url) ? 404 : 200 }; };
  const pages = await closingPages({ now: NOW, fetchPage: pageFetch , delayMs: 0 });
  ok('asks for this month and the next two', asked.length === 3 && asked[0].includes('october-2026') && asked[1].includes('november-2026') && asked[2].includes('december-2026'), asked.join(' '));
  ok('a month that does not exist (404) is left out', pages.length === 2 && !pages.some((p) => p.url.includes('december')));
  ok('they point at the real zabursaries URL shape',
    pages[0].url === 'https://www.zabursaries.co.za/bursaries-closing-in-october-2026/' && pages[0].title === 'Bursaries closing in October 2026');
  ok('they are labelled zabursaries / Closing soon', pages.every((p) => p.source === 'zabursaries' && p.category === 'Closing soon'));
  const blocked = await closingPages({ now: NOW, fetchPage: async () => { throw new Error('network'); } , delayMs: 0 });
  ok('a blocked or failed check still yields the leads', blocked.length === 3);
  const forbidden = await closingPages({ now: NOW, fetchPage: async () => ({ status: 406 }) , delayMs: 0 });
  ok('only 404/410 rules a page out; 406 (site blocks scripts) does not', forbidden.length === 3);
  const year = await closingPages({ now: new Date('2026-12-10T00:00:00Z'), fetchPage: async () => ({ status: 200 }) , delayMs: 0 });
  ok('December rolls over to January of next year', year[1].url.includes('january-2027') && year[2].url.includes('february-2027'));
}

sec('what gets sent to Tavily');
{
  const t = fakeTavily(() => []);
  await collect({ key: 'tvly-secret', searches: plan, fetchImpl: t.fetchImpl });
  ok('one request per search', t.calls.length === 15);
  ok('all requests hit the search endpoint with a bearer key',
    t.calls.every((c) => c.url === 'https://api.tavily.com/search' && c.headers.Authorization === 'Bearer tvly-secret'));
  ok('every search is the 1-credit basic tier, never advanced', t.calls.every((c) => c.body.search_depth === 'basic'));
  ok('only broader searches ask for the South Africa boost',
    t.calls.filter((c) => c.body.country === 'south africa').length === 5);
  ok('time_range is sent for the windowed searches only', t.calls.filter((c) => c.body.time_range === 'month').length === 9);
  ok('the API key is never in a request body', !t.calls.some((c) => JSON.stringify(c.body).includes('tvly-secret')));
}

/* -------------------------------------------------------------- */
sec('filtering and de-duplication within a run');
{
  const t = fakeTavily((body) => {
    if (body.include_domains) return [result('Shared bursary', 'https://www.zabursaries.co.za/shared-bursary/?utm_source=x')];
    return [result('Shared bursary (broader)', 'https://zabursaries.co.za/shared-bursary'), result('Other site', 'https://example.co.za/b')];
  });
  const { findings } = await collect({ key: 'k', searches: plan, fetchImpl: t.fetchImpl, now: NOW });
  ok('the same page found by many searches (even with tracking params) appears once',
    findings.filter((f) => /shared-bursary/.test(f.url)).length === 1);
  ok('the trusted-source copy wins over the broader one',
    findings.find((f) => /shared-bursary/.test(f.url)).pass === 'scoped');
  ok('a genuinely different site from the broader pass is kept',
    findings.some((f) => f.url === 'https://example.co.za/b' && f.pass === 'broad'));
}

sec('noise, stale leads and faculty filing (all seen in a real run)');
{
  ok('site home pages are noise', isNoise('https://www.zabursaries.co.za') && isNoise('https://www.graduates24.com/'));
  ok('on-site search results are noise', isNoise('https://www.zabursaries.co.za/?s=pharmacy') && isNoise('https://www.zabursaries.co.za?s=logistics'));
  ok('pagination is noise', isNoise('https://www.graduates24.com/entry_level_jobs?page=9'));
  ok('contact and interview-tips pages are noise',
    isNoise('https://www.zabursaries.co.za/contact') && isNoise('https://www.graduates24.com/interview_questions'));
  ok('real leads are not noise',
    !isNoise('https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary') &&
    !isNoise('https://www.graduates24.com/absa-graduate-programme-2027') &&
    !isNoise('https://www.graduates24.com/learnerships'));
  ok('a title with only past years is stale', isStale('Bursaries 2024', NOW) && isStale('Intake 2025', NOW));
  ok('a range reaching this year is kept', !isStale('BBD Bursary South Africa 2025 - 2026', NOW) && !isStale('Graduate Programme 2027', NOW));
  ok('no year at all is kept', !isStale('Learnerships in South Africa', NOW));

  ok('engineering URLs file under Engineering', facultyFromUrl('https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary') === 'Engineering');
  ok('accounting and commerce file under Commerce',
    facultyFromUrl('https://www.zabursaries.co.za/accounting-bursaries-south-africa') === 'Commerce' &&
    facultyFromUrl('https://www.zabursaries.co.za/commerce-bursaries-south-africa') === 'Commerce');
  ok('computer science and science file under Science',
    facultyFromUrl('https://www.zabursaries.co.za/computer-science-it-bursaries-south-africa/vodacom-bursary') === 'Science');
  ok('medical, education and law', facultyFromUrl('https://www.zabursaries.co.za/medical-bursaries-south-africa') === 'Health Sciences' &&
    facultyFromUrl('https://www.zabursaries.co.za/education-bursaries-south-africa') === 'Humanities' &&
    facultyFromUrl('https://www.zabursaries.co.za/law-bursaries-south-africa') === 'Law');
  ok('general bursaries have no faculty', facultyFromUrl('https://www.zabursaries.co.za/general-bursaries-south-africa/isfap-bursary') === null);

  // Sasol is an engineering bursary even when the *Humanities* search found it.
  const t = fakeTavily((body) => (/humanities/.test(body.query)
    ? [
        result('Sasol Bursary South Africa 2027', 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary'),
        result('Contact SA Bursaries', 'https://www.zabursaries.co.za/contact'),
        result('Pharmacy search', 'https://www.zabursaries.co.za/?s=pharmacy'),
        result('Old Bursary 2024', 'https://www.zabursaries.co.za/old-bursary-2024'),
      ]
    : []));
  const { findings } = await collect({ key: 'k', searches: plan, fetchImpl: t.fetchImpl, now: NOW });
  ok('a bursary found by the wrong faculty search is filed by its URL', findings.length === 1 && findings[0].tag === 'Engineering', JSON.stringify(findings));
}

sec('the issue');
{
  const t = fakeTavily((body) => {
    if (body.include_domains && /engineering/.test(body.query)) return [result('Eng bursary', 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/eng-bursary', 'For engineers.')];
    if (body.include_domains && /learnership/.test(body.query)) return [result('A learnership', 'https://www.graduates24.com/l/', 'Paid learnership.')];
    if (body.exclude_domains && /job opening/.test(body.query)) return [result('A broad job', 'https://jobs.example.co.za/1', 'Entry level.')];
    return [];
  });
  const collected = await collect({ key: 'k', searches: plan, fetchImpl: t.fetchImpl, now: NOW });
  const closing = await closingPages({ now: NOW, fetchPage: async () => ({ status: 200 }) , delayMs: 0 });
  const { failures, searched } = collected;
  const findings = [...closing, ...collected.findings];
  const { title, body } = renderDigest({ findings, failures, searched, now: NOW });

  ok('title is "Opportunity digest — <date>"', title === 'Opportunity digest — 2026-10-05', title);
  ok('says nothing here is in the README', body.includes('nothing here is in the README'));
  ok('each bullet has title, link, description and source',
    body.includes('- [Eng bursary](https://www.zabursaries.co.za/engineering-bursaries-south-africa/eng-bursary) — For engineers. · _zabursaries_') &&
    body.includes('- [A learnership](https://www.graduates24.com/l/) — Paid learnership. · _graduates24_') &&
    body.includes('- [A broad job](https://jobs.example.co.za/1) — Entry level. · _broader search_'));
  ok('closing soon comes first', body.indexOf('Closing soon') < body.indexOf('## Bursaries') && body.includes('Bursaries closing in October 2026'));
  ok('bursaries are grouped by faculty', /## Bursaries\n\n### Engineering/.test(body));
  ok('the broader results sit under a clearly lower-trust heading, after the trusted ones',
    body.indexOf('Broader search (less trusted)') > body.indexOf('A learnership') && body.indexOf('A broad job') > body.indexOf('Broader search (less trusted)'));
  ok('empty categories say so instead of vanishing', body.includes('_Nothing found this run._'));
  ok('closing-soon descriptions read properly ("an October", not "a October")', !/ a October| a April| a August/.test(body) && body.includes('closing in October 2026'));
  ok('no lone "General" subheading when nothing has a faculty', !/#### General/.test(body));
  ok('a clean run has no failure warning', !body.includes('searches failed'));

  // The weekly issue: no broader section at all, and the intro does not promise one.
  const weeklyRun = await collect({ key: 'k', searches: weekly, fetchImpl: t.fetchImpl, now: NOW });
  const weeklyIssue = renderDigest({ findings: weeklyRun.findings, failures: [], searched: weeklyRun.searched, now: NOW, withBroad: false });
  ok('the weekly issue has no "less trusted" section', !/Broader search/.test(weeklyIssue.body) && !/less trusted/.test(weeklyIssue.body));
  ok('...and no broader-pass links', !weeklyIssue.body.includes('A broad job'));
  ok('...but still has the trusted ones', weeklyIssue.body.includes('A learnership') && weeklyIssue.body.includes('Eng bursary'));
  ok('a broader run that found nothing still shows its section',
    /Broader search \(less trusted\)/.test(renderDigest({ findings: [], failures: [], searched: 5, now: NOW, withBroad: true }).body));
}

/* -------------------------------------------------------------- */
sec('untrusted web text is made inert');
{
  ok('@mentions cannot ping anyone', !/@[a-z]/i.test(inert('thanks @octocat and @tim')));
  ok('brackets and pipes cannot break the link or a table', !/[\[\]|]/.test(inert('Win [big] | now')));
  ok('HTML is stripped', inert('<script>alert(1)</script>Hi <b>there</b>') === 'alert(1) Hi there');
  ok('markdown links in snippets are flattened to their text', inert('see [the site](https://evil.example) now') === 'see the site now');
  ok('long descriptions end on a word, not mid-word', (() => { const s = oneLine('word '.repeat(100)); return s.length <= 181 && s.endsWith('…') && !s.endsWith('wor…'); })());
  ok('menu markup is stripped from descriptions',
    oneLine('## BURSARIES BY CATEGORY ### ACCOUNTING + Bester Bursary + Cape Wools \\\\ RELATED') === 'BURSARIES BY CATEGORY ACCOUNTING Bester Bursary Cape Wools RELATED');
  ok('graduates24 page chrome is stripped',
    oneLine('Title: Hatch: Graduate Programme Join our **WhatsApp Channel** for daily updates on the latest Internships, Learnerships, Graduate Programmes and Bursaries Apply for the role Create My CV Other Opportunities Eskom: Graduate', 180, 'Hatch: Graduate Programme').startsWith('Apply for the role'),
    oneLine('Title: Hatch: Graduate Programme Join our **WhatsApp Channel** for daily updates on the latest Internships, Learnerships, Graduate Programmes and Bursaries Apply for the role Create My CV Other Opportunities Eskom: Graduate', 180, 'Hatch: Graduate Programme'));
  ok('the result title is not repeated at the start of its own description',
    !oneLine('Hatch: Graduate Programme 2026 Join us in Johannesburg for a 2-year rotation.', 180, 'Hatch: Graduate Programme 2026').startsWith('Hatch'));
  ok('page chrome is stripped even when the snippet has line breaks',
    oneLine('Apply for the role.\nCreate Your CV\nBuild a professional CV in minutes\nOther Opportunities Eskom: Graduate').startsWith('Apply for the role') &&
    !oneLine('Apply for the role.\nCreate Your CV\nBuild a professional CV in minutes').includes('CV'));
  ok('a sidebar roll of other listings (2+ dates) is dropped, a single deadline is kept',
    usableDesc('Pretoria Closes 09 Oct 2026 Inlumi: Graduate Internships 2027 30 Sep 2026 NTT DATA') === '' &&
    usableDesc('Closing date: 31 October 2026 for undergraduate students') !== '' &&
    usableDesc('Apply') === '');
  ok('broader results need a South Africa signal',
    looksSouthAfrican({ url: 'https://www.woodside.com/careers', title: 'Woodside Graduate Programs', content: 'Explore engineering in Perth' }) === false &&
    looksSouthAfrican({ url: 'https://careers.example.co.za/graduates', title: 'Graduates', content: 'x' }) === true &&
    looksSouthAfrican({ url: 'https://example.com/a', title: 'Learnership', content: 'Based in Johannesburg' }) === true);
  ok('"Read more" boilerplate is removed', oneLine('Closing Date 04 June 2026 ...Read more') === 'Closing Date 04 June 2026');
  const t = fakeTavily(() => [
    result('Bad link', 'javascript:alert(1)'),
    result('Parens (in) url', 'https://example.org/a_(b)'),
    result('Spaced [title] @user', 'https://example.org/c', 'x'),
  ]);
  const { findings } = await collect({ key: 'k', searches: planSearches().slice(0, 1), fetchImpl: t.fetchImpl, now: NOW });
  ok('javascript: URLs are dropped', !findings.some((f) => f.url.startsWith('javascript')));
  ok('parentheses in a URL cannot end the markdown link early', findings.some((f) => f.url === 'https://example.org/a_%28b%29'), JSON.stringify(findings.map((f) => f.url)));
  ok('titles are inert', findings.every((f) => !/[\[\]]/.test(f.title) && !/@[a-z]/.test(f.title)));
}

/* -------------------------------------------------------------- */
sec('source labels and dates');
ok('zabursaries (with and without www)', sourceOf('https://www.zabursaries.co.za/x') === 'zabursaries' && sourceOf('https://zabursaries.co.za/x') === 'zabursaries');
ok('graduates24', sourceOf('https://www.graduates24.com/x') === 'graduates24');
ok('anything else is "broader search"', sourceOf('https://evilzabursaries.co.za.example.org/') === 'broader search');
ok('the title date is the SAST date, not UTC', sastDate(new Date('2026-10-04T23:30:00Z')) === '2026-10-05');

/* -------------------------------------------------------------- */
sec('running it');
{
  const gh = {
    calls: [],
    async ensureLabel(...a) { this.calls.push(['ensureLabel', ...a]); },
    async createIssue(owner, repo, issue) { this.calls.push(['createIssue', owner, repo, issue]); return { html_url: 'https://github.com/o/r/issues/7', number: 7 }; },
  };
  const config = { tavilyKey: 'k', owner: 'o', repo: 'r' };
  const good = () => fakeTavily(() => [result('X', 'https://www.zabursaries.co.za/x/')]);

  const dry = await runOpportunityDigest({ closingDelayMs: 0, config, gh, fetchImpl: good().fetchImpl, fetchPage: async () => ({ status: 200 }), dryRun: true, now: NOW });
  ok('dry run returns the issue text and creates nothing', dry.body.includes('Opportunity') || dry.title.startsWith('Opportunity') , '') ;
  ok('dry run did not touch GitHub', gh.calls.length === 0);
  ok('dry run reports the weekly credit cost: 10', dry.credits === 10 && dry.searches === 10);
  ok('the weekly dry run has no broader section', !/Broader search/.test(dry.body));

  const live = await runOpportunityDigest({ closingDelayMs: 0, config, gh, fetchImpl: good().fetchImpl, fetchPage: async () => ({ status: 200 }), now: NOW });
  const created = gh.calls.find((c) => c[0] === 'createIssue');
  ok('a real run opens exactly one issue', gh.calls.filter((c) => c[0] === 'createIssue').length === 1 && live.issueUrl.endsWith('/7'));
  ok('on the configured repo, with the dated title', created[1] === 'o' && created[2] === 'r' && created[3].title === 'Opportunity digest — 2026-10-05');
  ok('labelled for filtering', created[3].labels.includes(OPPS_LABEL));

  const noLabel = { calls: [], async ensureLabel() { throw new Error('403'); }, async createIssue(o, r, i) { this.calls.push(i); return { html_url: 'u', number: 1 }; } };
  await runOpportunityDigest({ closingDelayMs: 0, config, gh: noLabel, fetchImpl: good().fetchImpl, fetchPage: async () => ({ status: 200 }), now: NOW });
  ok('a label failure does not lose the digest', noLabel.calls.length === 1 && noLabel.calls[0].labels.length === 0);

  const partial = fakeTavily((b, n) => (n === 3 ? 500 : [result('X', `https://www.zabursaries.co.za/p${n}/`)]));
  const p = await runOpportunityDigest({ closingDelayMs: 0, config, gh: { ...gh, calls: [], ensureLabel: async () => {}, createIssue: async (o, r, i) => ({ html_url: 'u', number: 2, _i: i }) }, fetchImpl: partial.fetchImpl, fetchPage: async () => ({ status: 200 }), dryRun: true, now: NOW });
  ok('one failed search is reported in the issue, not hidden', p.failures === 1 && p.body.includes('1 of 10 searches failed'));

  let threw = '';
  try { await runOpportunityDigest({ closingDelayMs: 0, config, gh, fetchImpl: fakeTavily(() => 401).fetchImpl, fetchPage: async () => ({ status: 200 }), now: NOW }); } catch (e) { threw = e.message; }
  ok('every search failing throws (and points at the key) instead of posting an empty issue', /All 10 searches failed/.test(threw) && /TAVILY_API_KEY/.test(threw), threw);

  let noKey = '';
  try { await runOpportunityDigest({ closingDelayMs: 0, config: { ...config, tavilyKey: '' }, gh, now: NOW }); } catch (e) { noKey = e.message; }
  ok('a missing key gives a clear instruction', /wrangler secret put TAVILY_API_KEY/.test(noKey), noKey);
}

/* -------------------------------------------------------------- */
sec('closing dates: extraction');
{
  const dl = (t) => extractDeadline(t, NOW);
  const date = (t) => dl(t)?.date ?? null;
  ok('"Closing date: 30 November 2026"', date('Sasol Bursary. Closing date: 30 November 2026. Apply online.') === '2026-11-30');
  ok('short month, ordinal and "of"', date('Applications close on 15th of Oct 2026') === '2026-10-15');
  ok('month first: "Deadline: November 30, 2026"', date('Deadline: November 30, 2026') === '2026-11-30');
  ok('ISO date', date('closes 2026-12-01') === '2026-12-01');
  ok('SA day-first numeric date, past a weekday', date('Closing Date: Thursday, 30/11/2026') === '2026-11-30');
  ok('"apply by" and "no later than"', date('Apply by 14 Dec 2026') === '2026-12-14' && date('Submit no later than 9 January 2027') === '2027-01-09');
  ok('the closing date is picked over an opening date', date('Opens 1 Nov 2026, closes 30 Nov 2026') === '2026-11-30');
  ok('an opening date alone is not a deadline', date('Applications open 1 Nov 2026') === null);
  ok('an unrelated date after a full stop is not taken', date('Applications close. Interviews are on 4 Dec 2026') === null);
  ok('a date with no closing word is ignored', date('Posted 3 Oct 2026. Great bursary.') === null);
  ok('two different closing dates in a sentence → none, not a guess', date('closes 30 Nov 2026 ... closes 5 Dec 2026') === null);
  ok('the same date twice is still one date', date('Closes 30 Nov 2026. Remember: closing date 30 November 2026') === '2026-11-30');
  ok('an impossible date is rejected', date('closes 31 Feb 2027') === null);
  ok('a date without a year is not guessed', date('Closes 30 November') === null);
  ok('a closing date in the past is flagged', dl('Applications closed on 3 Mar 2026').past === true);
  ok('the closing day itself is not past', dl('closes 5 Oct 2026').past === false);
  ok('"today" is judged in South Africa (22:30 UTC is already tomorrow)',
    extractDeadline('closes 5 Oct 2026', new Date('2026-10-05T22:30:00Z')).past === true);
  // Wording taken from real graduates24 / zabursaries results (see the PR).
  ok('capitalised "Closes: 30 Sep 2026" is a listing row, never taken', date('2026 Learnerships\n Pretoria  Closes: 30 Sep 2026\n Other Co: Programme\n Durban  Closes: 30 Sep 2026') === null);
  ok('a listing page of rows with several dates → none', date('Closes 09 Oct 2026 Inlumi 30 Sep 2026 NTT Closes 09 Oct 2026 Simah 30 Sep 2026 Eskom Closes 08 Oct 2026') === null);
  ok("a job page's own \"Closing Date\" label beats the sidebar's rows",
    date('#### Job Summary\n Company  Home Affairs\n Closing Date  18 September 2026\n Date Listed17 September 2026\n#### Other Opportunities\n Freedom Stationery  KwaZulu-Natal  01 Oct 2026\n NTT DATA  Closes 09 Oct 2026') === '2026-09-18');
  ok('two different "Closing Date" labels → none', date('Closing Date 18 Sep 2026 ... Closing Date 20 Sep 2026') === null);
  ok("zabursaries' question form: \"WHEN IS THE CLOSING DATE FOR THE ESKOM BURSARY? 22 September 2026.\"",
    date('WHEN IS THE CLOSING DATE FOR THE ESKOM BURSARY? 22 September 2026. (Applications submitted after this date will not be accepted)') === '2026-09-22');
  ok('a month name alone in a nav ("BURSARIES CLOSING IN NOVEMBER 2026") is not a date', date('CLOSING SOON & BLOG ... BURSARIES CLOSING IN NOVEMBER 2026 BURSARIES CLOSING IN OCTOBER 2026') === null);
  ok('empty and non-text input is safe', date('') === null && date(undefined) === null && date(null) === null);
}

/* -------------------------------------------------------------- */
sec('closing dates: in findings and the issue');
{
  const t = fakeTavily((body) => {
    if (/engineering/.test(body.query)) return [
      result('Sasol Bursary', 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary', 'For engineers. Closing date: 30 November 2026.'),
      result('Old Bursary', 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/old-bursary', 'Closing date: 30 June 2026.'),
      result('Undated Bursary', 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/undated', 'No date given.'),
    ];
    if (/learnership/.test(body.query)) return [result('A learnership', 'https://www.graduates24.com/l/', 'Paid. Applications close 15 Dec 2026.')];
    return [];
  });
  const seen = [];
  const { findings } = await collect({ key: 'k', searches: planSearches(), fetchImpl: t.fetchImpl, now: NOW, onResult: (r) => seen.push(r) });
  const by = (name) => findings.find((f) => f.title === name);

  ok('a found deadline is on the finding', by('Sasol Bursary')?.closes === '2026-11-30' && by('A learnership')?.closes === '2026-12-15');
  ok('a lead with no deadline has no closes key', by('Undated Bursary') && !('closes' in by('Undated Bursary')));
  ok('a lead whose deadline has passed is dropped', !by('Old Bursary'));
  ok('...and --explain says why', seen.some((r) => r.kept === false && /2026-06-30 has already passed/.test(r.reason)));

  const { body } = renderDigest({ findings, failures: [], searched: 10, now: NOW });
  ok('the bullet shows the closing date', body.includes('_zabursaries_ · **closes 2026-11-30**'));
  ok('an undated bullet is unchanged', /\[Undated Bursary\]\([^)]+\) — No date given\. · _zabursaries_\n/.test(body));
  ok('there is a paste-ready block, collapsed', body.includes('<details>') && body.includes('Ready to paste into OPPORTUNITIES.md (2 with a closing date)'));
  ok('it says where each line goes', body.includes("Under `## 🎓 I'm Going to Study` → `### Paying for It`") && body.includes("Under `## 💼 I'm Going to Work` → `### Finding Work`"));
  ok('only dated leads are in it', !body.slice(body.indexOf('<details>')).includes('Undated Bursary'));
  ok('the block comes before the footer and after the leads', body.indexOf('<details>') > body.indexOf('A learnership'));
  ok('no block at all when nothing has a deadline', !renderDigest({ findings: [{ title: 'X', url: 'https://x.org/a', desc: '', source: 'zabursaries', pass: 'scoped', category: 'Bursaries', tag: null }], failures: [], searched: 1, now: NOW }).body.includes('<details>'));
}

/* -------------------------------------------------------------- */
sec('closing dates: paste-ready lines are valid OPPORTUNITIES.md entries');
{
  const f = { title: 'Sasol Bursary', url: 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary', desc: 'For engineers.', source: 'zabursaries', pass: 'scoped', category: 'Bursaries', tag: 'Engineering', closes: '2026-11-30' };
  const line = entryLine(f);
  ok('the line has the README shape and the block', line === '-   [Sasol Bursary](https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary) — For engineers. {closes: 2026-11-30; tags: bursary, engineering, deadline; source: zabursaries.co.za}', line);

  const parsed = splitEntryMeta(line.replace(/^-\s+/, ''));
  ok('the site reads the block back with no errors', parsed.errors.length === 0 && parsed.meta.closes === '2026-11-30' && parsed.meta.tags.join() === 'bursary,engineering,deadline');
  const page = parseReadme(`## 🎓 I'm Going to Study\n\n### Paying for It\n\n${line}\n`, '2026-10-05').pillars.study['Paying for It'];
  ok('the site parser shows it as a card with the right name, link and description', page.length === 1 && page[0].name === 'Sasol Bursary' && page[0].desc === 'For engineers.' && page[0].meta.closes === '2026-11-30', JSON.stringify(page));
  let accepted = true;
  try { applyNew(`## 🎓 I'm Going to Study\n\n### Paying for It\n\n-   [N](https://n.org) — x\n`, { pillar: "I'm Going to Study", section: 'Paying for It', content: line }); } catch { accepted = false; }
  ok('the form would accept it too', accepted);

  const hostile = entryLine({ ...f, title: 'Evil {closes: 2099-01-01} Bursary — Free', desc: 'x {tags: pwned} y — z' });
  const h = splitEntryMeta(hostile.replace(/^-\s+/, ''));
  ok('braces in web text cannot add to or replace the block', h.errors.length === 0 && h.meta.closes === '2026-11-30' && !h.meta.tags.includes('pwned'), hostile);
  ok('an em dash in a title does not split the name', parseReadme(`## 🎓 I'm Going to Study\n\n### S\n\n${hostile}\n`, '2026-10-05').pillars.study.S[0].name === 'Evil closes: 2099-01-01 Bursary - Free');
  ok('a lead with no deadline has no line', entryLine({ ...f, closes: undefined }) === null);
  ok('a category with no home has no line', entryLine({ ...f, category: 'Closing soon' }) === null);
  ok('learnerships go to Finding Work with their own tag', /\{closes: 2026-12-15; tags: learnership, deadline; source: graduates24\.com\}/.test(entryLine({ title: 'L', url: 'https://www.graduates24.com/l/', desc: '', category: 'Learnerships', tag: null, closes: '2026-12-15' })));
  ok('pasteBlock is empty for no leads', pasteBlock([]).length === 0);
}

/* -------------------------------------------------------------- */
sec("zabursaries' monthly pages: individual bursaries with dates");
{
  // Rows copied from the real "Bursaries closing in October 2026" page.
  const row = (href, name, closing, attrs = 'target="_blank" rel="noopener"') => `<li><strong><a ${attrs.includes('title') ? attrs + ' ' : ''}href="${href}" ${attrs.includes('title') ? '' : attrs}>${name}</a></strong> (closing: ${closing})</li>`;
  const Z = 'https://www.zabursaries.co.za';
  const html = '<h2>SOUTH AFRICAN BURSARIES CLOSING IN OCTOBER 2026</h2><ul class="wp-block-list">' + [
    row(`${Z}/government-bursaries-south-africa/department-of-environment-forestry-and-fisheries-bursary/`, 'Department of Forestry, Fisheries and the Environment (DFFE) Bursary', '6 October 2026'),
    row(`${Z}/engineering-bursaries-south-africa/samancor-chrome-bursary/`, 'Samancor Chrome Bursary', '8 October 2026'),
    row(`${Z}/engineering-bursaries-south-africa/aws-skills-development-bursary/`, 'AWS Skills Development Bursary', '16 October 2026 &#8211;  extended deadline '),
    row(`${Z}/general-bursaries-south-africa/tiso-foundation-bursary/`, 'Tiso &amp; Co Bursary', '31 October 2026', 'title="" target="_blank"'),
    row(`${Z}/medical-bursaries-south-africa/old-bursary/`, 'Old Bursary', '2 July 2026'),
    row(`${Z}/engineering-bursaries-south-africa/anytime-bursary/`, 'Anytime Bursary', 'none &#8211; applications are accepted anytime'),
    row(`https://evil.example.com/engineering-bursaries-south-africa/phish/`, 'Phish', '9 October 2026'),
    row(`${Z}/engineering-bursaries-south-africa/samancor-chrome-bursary/`, 'Samancor again', '9 October 2026'),
    row(`${Z}/law-bursaries-south-africa/bad-date/`, 'Bad Date', '31 Feb 2026'),
    row(`${Z}/law-bursaries-south-africa/evil-title/`, 'Evil [click](http://x.example) @everyone', '20 October 2026'),
  ].join('') + '</ul><p>Other (closing: 5 October 2026) text that is not a list row</p>';

  const list = parseClosingLists([{ html }], NOW);
  const byTitle = (t) => list.find((e) => e.title.startsWith(t));
  ok('every dated, open, zabursaries row becomes a lead', list.length === 5 && ['Department of Forestry', 'Samancor Chrome', 'AWS Skills', 'Tiso & Co', 'Evil'].every((t) => byTitle(t)), list.map((e) => e.title).join(' | '));
  ok('with its own closing date', byTitle('Samancor').closes === '2026-10-08' && byTitle('Department').closes === '2026-10-06');
  ok('an "extended deadline" row keeps its date', byTitle('AWS').closes === '2026-10-16');
  ok('an attribute order with title first still reads the link', byTitle('Tiso').url === `${Z}/general-bursaries-south-africa/tiso-foundation-bursary/`);
  ok('entities in the title are decoded', byTitle('Tiso').title === 'Tiso & Co Bursary');
  ok('"closing: none, anytime" rows are skipped (they could never expire)', !byTitle('Anytime'));
  ok('closed rows, impossible dates and non-zabursaries links are skipped', !byTitle('Old') && !byTitle('Bad Date') && !byTitle('Phish'));
  ok('the same bursary twice is one lead (first date wins)', list.filter((e) => /Samancor/.test(e.title)).length === 1);
  ok('text that is not a list row is ignored', !list.some((e) => e.closes === '2026-10-05'));
  ok('web text in a title is made inert', !/[\[\]]|@[a-z]/i.test(byTitle('Evil').title), byTitle('Evil').title);
  ok('faculty comes from the URL; hubs like government have none', byTitle('Samancor').tag === 'Engineering' && byTitle('Department').tag === null);
  ok('they are labelled as list entries, as bursaries, from zabursaries', list.every((e) => e.pass === 'closing-list' && e.category === 'Bursaries' && e.source === 'zabursaries' && e.desc === ''));
  ok('a closing date of today still counts', parseClosingLists([{ html: row(`${Z}/a-bursaries/b/`, 'Today', '5 October 2026') }], NOW).length === 1);
  ok('pages with no html or no list give nothing', parseClosingLists([{}, { html: '' }, { html: '<ul><li>nothing</li></ul>' }], NOW).length === 0);

  // closingPages keeps the body it already fetched, so reading the list costs no extra request.
  const pages = await closingPages({ now: NOW, fetchPage: async (u) => (u.includes('december') ? { status: 404 } : { status: 200, ok: true, text: async () => html }), delayMs: 0 });
  ok('closingPages attaches the page body without it showing in the finding', pages.length === 2 && pages.every((p) => typeof p.html === 'string' && p.html.length > 100) && !JSON.stringify(pages).includes('closing:'));
  ok('...and parseClosingLists reads straight from them', parseClosingLists(pages, NOW).length === 5);
  const blocked = await closingPages({ now: NOW, fetchPage: async () => ({ status: 200 }) , delayMs: 0 });
  ok('a response with no body (as the older fakes) still yields the page lead', blocked.length === 3 && blocked.every((p) => p.html === undefined));

  ok('genericDesc is our own plain line, naming the faculty or just "Bursary"', genericDesc({ tag: 'Engineering' }) === 'Engineering bursary. See the page for who can apply and how.' && genericDesc({ tag: null }).startsWith('Bursary.'));

  // robots.txt on zabursaries asks for Crawl-delay: 30. The monthly pages are read one at a time, that far apart.
  const events = []; let inFlight = 0, maxInFlight = 0;
  const slowFetch = async (u) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); events.push(['get', u.match(/closing-in-(\w+)/)[1]]); await Promise.resolve(); inFlight--; return { status: 200, ok: true, text: async () => html }; };
  const naps = [];
  await closingPages({ now: NOW, fetchPage: slowFetch, sleep: async (ms) => { naps.push(ms); events.push(['sleep', ms]); } });
  ok('the crawl delay is the 30 seconds robots.txt asks for', ZA_CRAWL_DELAY_MS === 30000);
  ok('the three monthly pages are fetched one at a time, with a full delay between each', maxInFlight === 1 && events.map((e) => e[0]).join() === 'get,sleep,get,sleep,get' && naps.every((n) => n === 30000) && naps.length === 2, JSON.stringify(events));
  ok('no wait before the first request or after the last', events[0][0] === 'get' && events[events.length - 1][0] === 'get');
  const missing = await closingPages({ now: NOW, fetchPage: async () => ({ status: 404 }), sleep: async () => {} });
  ok('a missing month does not stop the next one being checked', missing.length === 0);
  ok('the default really waits (a short override proves the clock is used)', await (async () => { const t0 = Date.now(); await closingPages({ now: NOW, fetchPage: async () => ({ status: 404 }), delayMs: 20 }); return Date.now() - t0 >= 35; })());
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
