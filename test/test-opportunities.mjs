/**
 * Weekly opportunity digest — search plan, filtering, issue rendering, and the
 * budget. Tavily and GitHub are both faked: no network, no credits spent.
 *
 * Run: node test/test-opportunities.mjs
 */
import {
  usableDesc, looksSouthAfrican, planSearches, closingPages, collect, renderDigest, runOpportunityDigest, sourceOf, oneLine, inert, sastDate,
  isNoise, isStale, facultyFromUrl, OPPS_LABEL,
} from '../src/opportunities.js';

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
const plan = planSearches();
const by = (pass) => plan.filter((s) => s.pass === pass);
ok('15 searches = 15 credits (budget is "well under 50")', plan.length === 15, String(plan.length));
ok('10 scoped, 5 broader', by('scoped').length === 10 && by('broad').length === 5);
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

sec('closing-soon pages (built, not searched)');
{
  const asked = [];
  const pageFetch = async (url) => { asked.push(url); return { status: /december/.test(url) ? 404 : 200 }; };
  const pages = await closingPages({ now: NOW, fetchPage: pageFetch });
  ok('asks for this month and the next two', asked.length === 3 && asked[0].includes('october-2026') && asked[1].includes('november-2026') && asked[2].includes('december-2026'), asked.join(' '));
  ok('a month that does not exist (404) is left out', pages.length === 2 && !pages.some((p) => p.url.includes('december')));
  ok('they point at the real zabursaries URL shape',
    pages[0].url === 'https://www.zabursaries.co.za/bursaries-closing-in-october-2026/' && pages[0].title === 'Bursaries closing in October 2026');
  ok('they are labelled zabursaries / Closing soon', pages.every((p) => p.source === 'zabursaries' && p.category === 'Closing soon'));
  const blocked = await closingPages({ now: NOW, fetchPage: async () => { throw new Error('network'); } });
  ok('a blocked or failed check still yields the leads', blocked.length === 3);
  const forbidden = await closingPages({ now: NOW, fetchPage: async () => ({ status: 406 }) });
  ok('only 404/410 rules a page out; 406 (site blocks scripts) does not', forbidden.length === 3);
  const year = await closingPages({ now: new Date('2026-12-10T00:00:00Z'), fetchPage: async () => ({ status: 200 }) });
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
  const closing = await closingPages({ now: NOW, fetchPage: async () => ({ status: 200 }) });
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

  const dry = await runOpportunityDigest({ config, gh, fetchImpl: good().fetchImpl, fetchPage: async () => ({ status: 200 }), dryRun: true, now: NOW });
  ok('dry run returns the issue text and creates nothing', dry.body.includes('Opportunity') || dry.title.startsWith('Opportunity') , '') ;
  ok('dry run did not touch GitHub', gh.calls.length === 0);
  ok('dry run reports the credit cost', dry.credits === 15 && dry.searches === 15);

  const live = await runOpportunityDigest({ config, gh, fetchImpl: good().fetchImpl, fetchPage: async () => ({ status: 200 }), now: NOW });
  const created = gh.calls.find((c) => c[0] === 'createIssue');
  ok('a real run opens exactly one issue', gh.calls.filter((c) => c[0] === 'createIssue').length === 1 && live.issueUrl.endsWith('/7'));
  ok('on the configured repo, with the dated title', created[1] === 'o' && created[2] === 'r' && created[3].title === 'Opportunity digest — 2026-10-05');
  ok('labelled for filtering', created[3].labels.includes(OPPS_LABEL));

  const noLabel = { calls: [], async ensureLabel() { throw new Error('403'); }, async createIssue(o, r, i) { this.calls.push(i); return { html_url: 'u', number: 1 }; } };
  await runOpportunityDigest({ config, gh: noLabel, fetchImpl: good().fetchImpl, fetchPage: async () => ({ status: 200 }), now: NOW });
  ok('a label failure does not lose the digest', noLabel.calls.length === 1 && noLabel.calls[0].labels.length === 0);

  const partial = fakeTavily((b, n) => (n === 3 ? 500 : [result('X', `https://www.zabursaries.co.za/p${n}/`)]));
  const p = await runOpportunityDigest({ config, gh: { ...gh, calls: [], ensureLabel: async () => {}, createIssue: async (o, r, i) => ({ html_url: 'u', number: 2, _i: i }) }, fetchImpl: partial.fetchImpl, fetchPage: async () => ({ status: 200 }), dryRun: true, now: NOW });
  ok('one failed search is reported in the issue, not hidden', p.failures === 1 && p.body.includes('1 of 15 searches failed'));

  let threw = '';
  try { await runOpportunityDigest({ config, gh, fetchImpl: fakeTavily(() => 401).fetchImpl, fetchPage: async () => ({ status: 200 }), now: NOW }); } catch (e) { threw = e.message; }
  ok('every search failing throws (and points at the key) instead of posting an empty issue', /All 15 searches failed/.test(threw) && /TAVILY_API_KEY/.test(threw), threw);

  let noKey = '';
  try { await runOpportunityDigest({ config: { ...config, tavilyKey: '' }, gh, now: NOW }); } catch (e) { noKey = e.message; }
  ok('a missing key gives a clear instruction', /wrangler secret put TAVILY_API_KEY/.test(noKey), noKey);
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
