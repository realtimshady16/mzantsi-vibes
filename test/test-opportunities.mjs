/**
 * Weekly opportunity digest — search plan, filtering, issue rendering, and the
 * budget. Tavily and GitHub are both faked: no network, no credits spent.
 *
 * Run: node test/test-opportunities.mjs
 */
import {
  planSearches, collect, renderDigest, runOpportunityDigest, sourceOf, oneLine, inert, sastDate, OPPS_LABEL,
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
const plan = planSearches(NOW);
const by = (pass) => plan.filter((s) => s.pass === pass);
ok('17 searches = 17 credits (budget is "well under 50")', plan.length === 17, String(plan.length));
ok('2 closing-soon, 10 scoped, 5 broader', by('closing').length === 2 && by('scoped').length === 10 && by('broad').length === 5);
ok('six faculties, matching the README', ['Commerce', 'Engineering', 'Science', 'Health Sciences', 'Humanities', 'Law']
  .every((f) => by('scoped').some((s) => s.tag === f)));
ok('learnerships, graduate programmes, jobs and training are all covered',
  ['Learnerships', 'Graduate programmes', 'Job openings', 'Training & vac work']
    .every((c) => by('scoped').some((s) => s.category === c) && by('broad').some((s) => s.category === c)));
ok('scoped searches are limited to the two trusted sites',
  by('scoped').every((s) => s.include.length === 2 && s.include.includes('zabursaries.co.za') && s.include.includes('graduates24.com')));
ok('broader searches exclude the two trusted sites, so they only add new sources',
  by('broad').every((s) => !s.include && s.exclude.includes('zabursaries.co.za') && s.exclude.includes('graduates24.com')));
ok('closing-soon asks for this month and next by name',
  by('closing')[0].query.includes('october 2026') && by('closing')[1].query.includes('november 2026'),
  by('closing').map((s) => s.query).join(' | '));
ok('December rolls over to January',
  planSearches(new Date('2026-12-10T00:00:00Z')).filter((s) => s.pass === 'closing')[1].query.includes('january 2027'));

/* -------------------------------------------------------------- */
sec('what gets sent to Tavily');
{
  const t = fakeTavily(() => []);
  await collect({ key: 'tvly-secret', searches: plan, fetchImpl: t.fetchImpl });
  ok('one request per search', t.calls.length === 17);
  ok('all requests hit the search endpoint with a bearer key',
    t.calls.every((c) => c.url === 'https://api.tavily.com/search' && c.headers.Authorization === 'Bearer tvly-secret'));
  ok('every search is the 1-credit basic tier, never advanced', t.calls.every((c) => c.body.search_depth === 'basic'));
  ok('only broader searches ask for the South Africa boost',
    t.calls.filter((c) => c.body.country === 'south africa').length === 5);
  ok('the API key is never in a request body', !t.calls.some((c) => JSON.stringify(c.body).includes('tvly-secret')));
}

/* -------------------------------------------------------------- */
sec('filtering and de-duplication within a run');
{
  const t = fakeTavily((body) => {
    if (body.query.startsWith('bursaries closing in')) {
      return [
        result('Bursaries closing in October 2026', 'https://www.zabursaries.co.za/bursaries-closing-in-october-2026/'),
        result('How to write a motivational letter', 'https://www.zabursaries.co.za/how-to-write-a-bursary-motivational-letter/'),
        result('Closing news item', 'https://www.zabursaries.co.za/bursary-news/some-item/'),
      ];
    }
    if (body.include_domains) return [result('Shared bursary', 'https://www.zabursaries.co.za/shared-bursary/?utm_source=x')];
    return [result('Shared bursary (broader)', 'https://zabursaries.co.za/shared-bursary'), result('Other site', 'https://example.org/b')];
  });
  const { findings } = await collect({ key: 'k', searches: plan, fetchImpl: t.fetchImpl });
  const closing = findings.filter((f) => f.category === 'Closing soon');
  ok('closing-soon keeps month pages and /bursary-news/, drops unrelated pages',
    closing.length === 2 && !closing.some((f) => f.url.includes('motivational')), closing.map((f) => f.url).join(' '));
  ok('the same page found by many searches (even with tracking params) appears once',
    findings.filter((f) => /shared-bursary/.test(f.url)).length === 1);
  ok('the trusted-source copy wins over the broader one',
    findings.find((f) => /shared-bursary/.test(f.url)).pass === 'scoped');
  ok('a genuinely different site from the broader pass is kept',
    findings.some((f) => f.url === 'https://example.org/b' && f.pass === 'broad'));
}

/* -------------------------------------------------------------- */
sec('the issue');
{
  const t = fakeTavily((body) => {
    if (body.query.startsWith('bursaries closing in october')) return [result('Closing in October', 'https://www.zabursaries.co.za/bursaries-closing-in-october-2026/', 'Dozens of bursaries.')];
    if (body.include_domains && /engineering/.test(body.query)) return [result('Eng bursary', 'https://www.zabursaries.co.za/eng/', 'For engineers.')];
    if (body.include_domains && /learnership/.test(body.query)) return [result('A learnership', 'https://www.graduates24.com/l/', 'Paid learnership.')];
    if (body.exclude_domains && /job opening/.test(body.query)) return [result('A broad job', 'https://jobs.example.org/1', 'Entry level.')];
    return [];
  });
  const { findings, failures, searched } = await collect({ key: 'k', searches: plan, fetchImpl: t.fetchImpl });
  const { title, body } = renderDigest({ findings, failures, searched, now: NOW });

  ok('title is "Opportunity digest — <date>"', title === 'Opportunity digest — 2026-10-05', title);
  ok('says nothing here is in the README', body.includes('nothing here is in the README'));
  ok('each bullet has title, link, description and source',
    body.includes('- [Eng bursary](https://www.zabursaries.co.za/eng/) — For engineers. · _zabursaries_') &&
    body.includes('- [A learnership](https://www.graduates24.com/l/) — Paid learnership. · _graduates24_') &&
    body.includes('- [A broad job](https://jobs.example.org/1) — Entry level. · _broader search_'));
  ok('closing soon comes first', body.indexOf('Closing soon') < body.indexOf('## Bursaries'));
  ok('bursaries are grouped by faculty', /## Bursaries\n\n### Engineering/.test(body));
  ok('the broader results sit under a clearly lower-trust heading, after the trusted ones',
    body.indexOf('Broader search (less trusted)') > body.indexOf('A learnership') && body.indexOf('A broad job') > body.indexOf('Broader search (less trusted)'));
  ok('empty categories say so instead of vanishing', body.includes('_Nothing found this run._'));
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
  const t = fakeTavily(() => [
    result('Bad link', 'javascript:alert(1)'),
    result('Parens (in) url', 'https://example.org/a_(b)'),
    result('Spaced [title] @user', 'https://example.org/c', 'x'),
  ]);
  const { findings } = await collect({ key: 'k', searches: planSearches(NOW).slice(2, 3), fetchImpl: t.fetchImpl });
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

  const dry = await runOpportunityDigest({ config, gh, fetchImpl: good().fetchImpl, dryRun: true, now: NOW });
  ok('dry run returns the issue text and creates nothing', dry.body.includes('Opportunity') || dry.title.startsWith('Opportunity') , '') ;
  ok('dry run did not touch GitHub', gh.calls.length === 0);
  ok('dry run reports the credit cost', dry.credits === 17 && dry.searches === 17);

  const live = await runOpportunityDigest({ config, gh, fetchImpl: good().fetchImpl, now: NOW });
  const created = gh.calls.find((c) => c[0] === 'createIssue');
  ok('a real run opens exactly one issue', gh.calls.filter((c) => c[0] === 'createIssue').length === 1 && live.issueUrl.endsWith('/7'));
  ok('on the configured repo, with the dated title', created[1] === 'o' && created[2] === 'r' && created[3].title === 'Opportunity digest — 2026-10-05');
  ok('labelled for filtering', created[3].labels.includes(OPPS_LABEL));

  const noLabel = { calls: [], async ensureLabel() { throw new Error('403'); }, async createIssue(o, r, i) { this.calls.push(i); return { html_url: 'u', number: 1 }; } };
  await runOpportunityDigest({ config, gh: noLabel, fetchImpl: good().fetchImpl, now: NOW });
  ok('a label failure does not lose the digest', noLabel.calls.length === 1 && noLabel.calls[0].labels.length === 0);

  const partial = fakeTavily((b, n) => (n === 3 ? 500 : [result('X', `https://www.zabursaries.co.za/p${n}/`)]));
  const p = await runOpportunityDigest({ config, gh: { ...gh, calls: [], ensureLabel: async () => {}, createIssue: async (o, r, i) => ({ html_url: 'u', number: 2, _i: i }) }, fetchImpl: partial.fetchImpl, dryRun: true, now: NOW });
  ok('one failed search is reported in the issue, not hidden', p.failures === 1 && p.body.includes('1 of 17 searches failed'));

  let threw = '';
  try { await runOpportunityDigest({ config, gh, fetchImpl: fakeTavily(() => 401).fetchImpl, now: NOW }); } catch (e) { threw = e.message; }
  ok('every search failing throws (and points at the key) instead of posting an empty issue', /All 17 searches failed/.test(threw) && /TAVILY_API_KEY/.test(threw), threw);

  let noKey = '';
  try { await runOpportunityDigest({ config: { ...config, tavilyKey: '' }, gh, now: NOW }); } catch (e) { noKey = e.message; }
  ok('a missing key gives a clear instruction', /wrangler secret put TAVILY_API_KEY/.test(noKey), noKey);
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
