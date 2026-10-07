/**
 * Registry mode: which URLs it keeps (no job postings, tokens or apply endpoints; South African or neutral pages;
 * CamelCase and joined words), how each is typed, the one primary and two alternates per company, and the retry for
 * companies with nothing. Tavily is faked: no network, no credits. Run: node test/test-registry.mjs
 */
import {
  words, suggestsCareers, visibleCycleYear, cleanUrl, isApplyEndpoint, isJobDetail, localeOf, registryType, judgeRegistry,
  planRegistrySearches, planVariantSearches, registryFallback, pickRegistry, registryCsv, REGISTRY_VARIANTS,
} from '../src/registry.js';
import { planEmployerSearches, withPortals, parseCompaniesCsv } from '../src/employers.js';
import { collect } from '../src/opportunities.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

const NOW = new Date('2026-10-07T08:00:00Z');

/* -------------------------------------------------------------- */
sec('(3) keywords: CamelCase and joined words');
{
  ok('CamelCase is split into words', words('YouthDevelopmentProgrammes') === 'youth development programmes' && words('EarlyCareers') === 'early careers' && words('graduate-programme_2027') === 'graduate programme 2027');
  const hit = (path) => suggestsCareers('', `https://x.co.za/${path}`);
  ok('YouthDevelopment and EarlyCareers match', hit('YouthDevelopment') && hit('EarlyCareers') && hit('Home/GraduateProgramme'));
  ok('words run together in lower case match too', hit('earlycareers') && hit('graduateprogramme') && hit('learnershipprogramme') && hit('youthdevelopment') && hit('bursaryapplications'));
  ok('a title alone can match, in either form', suggestsCareers('Our GraduateProgramme', 'https://x.co.za/p/1') && suggestsCareers('Early careers', 'https://x.co.za/p/1'));
  ok('look-alike words do not', !suggestsCareers('International markets', 'https://x.co.za/international/internal-audit') && !suggestsCareers('Home loans', 'https://x.co.za/personal/loans'));
}

/* -------------------------------------------------------------- */
sec('(1) job postings, query tokens and apply endpoints are dropped');
{
  const detail = ['https://x.co.za/job/senior-analyst', 'https://x.co.za/jobs/12345', 'https://careers.x.com/en/jobs/r0000397711/2027-field-rep-programme',
    'https://x.co.za/careers/JR-48213', 'https://x.co.za/vacancies/REQ_9981', 'https://x.co.za/jobs/senior-analyst-48213'];
  ok('/job/…, /jobs/<id>, and requisition ids are job details', detail.every((u) => isJobDetail(u)), detail.filter((u) => !isJobDetail(u)).join());
  ok('...but the list of jobs, and a programme with a year, are not', !isJobDetail('https://x.co.za/jobs') && !isJobDetail('https://x.co.za/vacancies') && !isJobDetail('https://x.co.za/careers/graduate-programme-2027') && !isJobDetail('https://x.co.za/careers/2027'));

  ok('apply and sign-in endpoints', ['https://x.co.za/careers/apply', 'https://x.co.za/apply-now', 'https://apply.x.co.za/graduate', 'https://x.co.za/login', 'https://x.co.za/bursary/sign-in'].every(isApplyEndpoint));
  ok('...but "how to apply" is information, not an endpoint', !isApplyEndpoint('https://x.co.za/bursary/how-to-apply') && !isApplyEndpoint('https://x.co.za/careers/graduates'));

  const s = planRegistrySearches([{ name: 'X', domain: 'x.co.za' }])[0];
  const r = (url, o = {}) => ({ title: 'Careers', url, score: 0.8, content: '', ...o });
  const j = (url, o) => s.judge(r(url, o), s);
  ok('a token, id or search in the query string is dropped, and says why', /query-string/.test(j('https://x.co.za/careers?token=abc').reason) && /query-string/.test(j('https://x.co.za/careers?id=1234').reason) && /query-string/.test(j('https://x.co.za/careers?lang=en&sid=9').reason));
  const tracked = j('https://x.co.za/careers/graduates?utm_source=mail&icid=top&fbclid=zz#section');
  ok('tracking parameters and the fragment are stripped, and the page is kept: the parent, not the tracked copy', tracked.finding?.url === 'https://x.co.za/careers/graduates', JSON.stringify(tracked));
  ok('a job posting, an apply endpoint and the home page are each dropped with their own reason',
    /single job posting/.test(j('https://x.co.za/jobs/12345').reason) && /apply or sign-in/.test(j('https://x.co.za/careers/apply').reason) && /home page/.test(j('https://x.co.za/').reason));
  ok('a parent careers page is kept when it is what the search returned', Boolean(j('https://x.co.za/careers').finding) && Boolean(j('https://x.co.za/careers/early-careers').finding));
  ok('cleanUrl reports what is left', cleanUrl('https://x.co.za/a?utm_x=1&id=7').extra.join() === 'id' && cleanUrl('https://x.co.za/a?utm_x=1').extra.length === 0);
}

/* -------------------------------------------------------------- */
sec('(2) locales: non-SA rejected, global only as a flagged fallback');
{
  const kind = (u) => localeOf(u).kind;
  const others = ['https://x.com/us/en/careers', 'https://x.com/uk/careers', 'https://x.com/uki/graduates', 'https://x.com/de/en/careers', 'https://x.com/fr/careers',
    'https://x.com/es/en/careers', 'https://x.com/it/careers', 'https://x.com/mx/en/graduate', 'https://x.com/careers/apac/graduates', 'https://x.com/amer/careers',
    'https://x.com/sea/careers', 'https://x.com/content/nedbank/zw/en/careers.html', 'https://x.com/us-en/careers', 'https://x.com/en-gb/careers', 'https://uk.x.com/careers'];
  ok('every asked-for locale is rejected, in segment, pair and subdomain forms', others.every((u) => kind(u) === 'other'), others.filter((u) => kind(u) !== 'other').join());
  ok('South Africa and neutral pages are not', kind('https://x.com/za/en/careers') === 'za' && kind('https://x.com/za-en/careers') === 'za' && kind('https://x.com/en-za/careers') === 'za' && kind('https://x.com/south-africa/careers') === 'za' && kind('https://x.com/careers') === 'neutral');
  ok('"it" or "es" inside a path (IT jobs) is not Italy or Spain', kind('https://x.co.za/graduates/it/programme') === 'neutral' && kind('https://x.co.za/careers/es/stuff') === 'neutral');
  ok('a global page is flagged global, and an explicit South Africa page under it is South Africa', kind('https://x.com/global/en/careers') === 'global' && kind('https://careers.bcg.com/global/en/locations/south-africa') === 'za');

  const s = planRegistrySearches([{ name: 'X', domain: 'x.com' }])[0];
  const j = (url) => s.judge({ title: 'Careers', url, score: 0.8 }, s);
  ok('judging drops another country, with the code', /another country's or region's page \(mx\)/.test(j('https://x.com/mx/en/careers').reason));
  ok('judging keeps a global page, marked global', j('https://x.com/global/en/careers').finding?.locale === 'global');
}

/* -------------------------------------------------------------- */
sec('(4) and (5) types: landing, programme, job-board, other');
{
  const t = (u, title = '') => registryType(u, title);
  ok('a careers hub is a landing page', t('https://x.co.za/careers') === 'landing' && t('https://x.co.za/about-us/careers') === 'landing' && t('https://x.co.za/EarlyCareers') === 'landing' && t('https://x.co.za/careers.php') === 'landing');
  ok('a hub of several programme kinds is a landing page too', t('https://x.co.za/careers/graduates-and-bursaries.html') === 'landing' && t('https://x.co.za/students-and-graduates') === 'landing');
  ok('a specific programme page is a programme', t('https://x.co.za/careers/graduate-programme-2027') === 'programme' && t('https://x.co.za/YouthDevelopmentProgrammes') === 'programme' && t('https://x.co.za/bursary') === 'programme' && t('https://x.co.za/p/1', 'Learnership programme') === 'programme');
  ok('a list of vacancies is a job-board', t('https://x.co.za/jobs') === 'job-board' && t('https://x.co.za/careers/vacancies') === 'job-board' && t('https://jobs.x.co.za/search') === 'job-board' && t('https://x.co.za/careers/opportunities') === 'job-board');
  ok('news, press, blog and terms and conditions are other', ['https://x.co.za/newsroom/2026/bursaries-open', 'https://x.co.za/press/graduate-intake', 'https://x.co.za/blog/my-internship', 'https://x.co.za/bursaries/terms-and-conditions', 'https://x.co.za/spotlight/early-careers', 'https://x.co.za/careers/youth/stories.html'].every((u) => t(u) === 'other'));
  ok('press statements and a media centre are other, however the segment is spelt', t('https://x.co.za/media-centre/press-statements/2023/turning-dreams-into-reality-for-future-leaders') === 'other' && t('https://x.co.za/PressStatements/graduates') === 'other' && t('https://x.co.za/newsletters/graduate-programme') === 'programme');
  ok('a title that says terms and conditions is other', t('https://x.co.za/p/9', 'Bursary Terms and Conditions') === 'other');

  const s = planRegistrySearches([{ name: 'X', domain: 'x.co.za' }])[0];
  const f = s.judge({ title: 'Graduate programme', url: 'https://x.co.za/blog/graduate-programme-2027', score: 0.9 }, s).finding;
  ok('an "other" page is still recorded, typed, never dropped', f?.type === 'other' && f.closes === '');
}

/* -------------------------------------------------------------- */
sec('(5) one primary and up to two alternates per company');
{
  const co = [{ name: 'A', domain: 'a.co.za' }, { name: 'B', domain: 'b.co.za' }, { name: 'C', domain: 'c.co.za' }];
  const mk = (company, type, score, o = {}) => ({ company, url: `https://${company.toLowerCase()}.co.za/${type}/${score}`, title: `${type} ${score}`, score, type, locale: 'neutral', cycleYear: null, closes: '', lowScore: false, ...o });
  const rows = pickRegistry([
    mk('A', 'programme', 0.9), mk('A', 'landing', 0.6), mk('A', 'job-board', 0.7), mk('A', 'other', 0.95), mk('A', 'programme', 0.8),
    mk('B', 'programme', 0.7), mk('B', 'programme', 0.6), mk('B', 'programme', 0.55),
    mk('C', 'other', 0.9),
  ], co);
  const a = rows.filter((r) => r.company === 'A');
  ok('at most three per company: one primary, two alternates', a.length === 3 && a[0].role === 'primary' && a[1].role === 'alternate' && a[2].role === 'alternate');
  ok('the primary is the landing page even when other pages score higher', a[0].type === 'landing' && a[1].type === 'programme' && a[1].score === 0.9 && a[2].type === 'job-board');
  ok('"other" is not chosen while real pages are available', !a.some((r) => r.type === 'other'));
  ok('with one type only, the best three of it fill the slots', rows.filter((r) => r.company === 'B').map((r) => r.score).join() === '0.7,0.6,0.55');
  ok('a company with only an "other" page still gets one, typed', rows.filter((r) => r.company === 'C').map((r) => `${r.role}:${r.type}`).join() === 'primary:other');
  ok('companies come out in the order given', [...new Set(rows.map((r) => r.company))].join() === 'A,B,C');

  const deep = pickRegistry([mk('A', 'landing', 0.69, { url: 'https://a.co.za/sbg/contact-us/careers' }), mk('A', 'landing', 0.6, { url: 'https://a.co.za/sbg/careers' })], co.slice(0, 1));
  ok('among landing pages the parent (shallower path) is the primary, even with a lower score', deep[0].url === 'https://a.co.za/sbg/careers' && deep[1].url.endsWith('/contact-us/careers'));
  const za = pickRegistry([mk('A', 'landing', 0.6, { locale: 'neutral' }), mk('A', 'landing', 0.5, { locale: 'za', url: 'https://a.co.za/za/careers' })], co.slice(0, 1));
  ok('within a type, a page that says South Africa beats a neutral one with a higher score', za[0].locale === 'za');
  const onlyGlobal = pickRegistry([mk('A', 'landing', 0.9, { locale: 'global' })], co.slice(0, 1));
  ok('a global page is used when there is nothing else, and flagged', onlyGlobal.length === 1 && onlyGlobal[0].flag === 'global fallback');
  const mixed = pickRegistry([mk('A', 'landing', 0.9, { locale: 'global' }), mk('A', 'programme', 0.5, { locale: 'neutral' })], co.slice(0, 1));
  ok('...but never alongside a South African or neutral page', mixed.length === 1 && mixed[0].type === 'programme' && mixed[0].flag === '');

  const csv = registryCsv([{ ...mk('A, Inc', 'landing', 0.6), role: 'primary', flag: '', cycleYear: 2027, title: 'Say "hi"', url: 'https://a.co.za/careers' }, { ...mk('B', 'other', 0.5), role: 'alternate', flag: 'global fallback' }]);
  const lines = csv.trim().split('\n');
  ok('the CSV has role and type columns, a flag, and closes always empty', lines[0] === 'company,role,type,url,score,cycle_year,flag,closes,title');
  ok('...with awkward characters quoted', lines[1] === '"A, Inc",primary,landing,https://a.co.za/careers,0.60,2027,,,"Say ""hi"""', lines[1]);
  ok('...and the flag shown', lines[2].includes(',alternate,other,') && lines[2].includes(',global fallback,,'), lines[2]);
}

/* -------------------------------------------------------------- */
sec('(6) a company with nothing: one retry with variant queries and reviewed portals');
{
  const [company] = withPortals(parseCompaniesCsv('Company,Company website\nAcme,https://www.acme.co.za\n'), { Acme: ['bursaries.acme-example.org'] });
  const variants = planVariantSearches(company);
  ok('there is a variant for early careers, learnership, YES programme and bursary', variants.length === 4 && REGISTRY_VARIANTS.map((v) => v[0]).join() === 'early careers,learnership,YES programme,bursary' && ['early careers', 'learnership', 'YES programme', 'bursary'].every((w, i) => variants[i].query.includes(w)));
  ok('each searches the own domain and the reviewed portal, no page text, and is labelled by variant', variants.every((v) => v.include.join() === 'acme.co.za,bursaries.acme-example.org' && v.rawContent === false && /^Acme · /.test(v.tag)));

  const run = (answer) => {
    const queries = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      queries.push(body.query);
      return { ok: true, status: 200, json: async () => ({ results: answer(body.query) }) };
    };
    return { queries, fetchImpl };
  };
  const hit = (u, score = 0.8) => [{ title: 'Learnership', url: u, score, content: '' }];

  const found = run((q) => (/learnership/.test(q) ? hit('https://www.acme.co.za/careers/learnerships') : []));
  const out = await registryFallback({ key: 'k', companies: [company], fetchImpl: found.fetchImpl, now: NOW, retryDelayMs: 0 });
  ok('it tries the variants in order and stops at the first that finds a page', found.queries.length === 2 && /early careers/.test(found.queries[0]) && /learnership/.test(found.queries[1]) && out.findings.length === 1 && out.tried[0].found === true && out.tried[0].queries === 2, found.queries.join(' | '));

  const none = run(() => []);
  const out2 = await registryFallback({ key: 'k', companies: [company], fetchImpl: none.fetchImpl, now: NOW, retryDelayMs: 0 });
  ok('with nothing found it has tried each variant once, and says so', none.queries.length === 4 && out2.tried[0].found === false && out2.tried[0].queries === 4 && out2.findings.length === 0);

  const weak = run(() => hit('https://www.acme.co.za/careers/learnerships', 0.3));
  const out3 = await registryFallback({ key: 'k', companies: [company], fetchImpl: weak.fetchImpl, now: NOW, retryDelayMs: 0 });
  ok('a page below the score minimum does not end the retry', weak.queries.length === 4 && out3.tried[0].found === false && out3.findings.every((f) => f.lowScore));

  const portal = run(() => hit('https://bursaries.acme-example.org/apply-for-a-bursary/info'));
  const out4 = await registryFallback({ key: 'k', companies: [company], fetchImpl: portal.fetchImpl, now: NOW, retryDelayMs: 0 });
  ok('a page on the reviewed portal counts', out4.tried[0].found === true && out4.findings[0].url.startsWith('https://bursaries.acme-example.org/'));
}

/* -------------------------------------------------------------- */
sec('retrying a timeout or a rate limit');
{
  const [s] = planRegistrySearches([{ name: 'Absa', domain: 'absa.co.za' }]);
  let tries = 0;
  const flaky = async () => { tries++; if (tries < 3) throw new Error('The operation was aborted due to timeout'); return { ok: true, status: 200, json: async () => ({ results: [] }) }; };
  const a = await collect({ key: 'k', searches: [s], fetchImpl: flaky, now: NOW, retries: 2 });
  ok('a timeout is retried and, once it works, is not a failure', tries === 3 && a.failures.length === 0 && a.retried.length === 2, `tries ${tries}`);
  tries = 0;
  const never = async () => { tries++; throw new Error('The operation was aborted due to timeout'); };
  const b = await collect({ key: 'k', searches: [s], fetchImpl: never, now: NOW, retries: 2 });
  ok('after the retries it is a failure, and says so', tries === 3 && b.failures.length === 1 && /timeout/.test(b.failures[0]));
  tries = 0;
  const t0 = Date.now();
  const limited = async () => { tries++; if (tries < 3) return { ok: false, status: 429, text: async () => 'slow down', json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ results: [] }) }; };
  const c = await collect({ key: 'k', searches: [s], fetchImpl: limited, now: NOW, retries: 3, retryDelayMs: 20 });
  ok('a rate limit (429) is retried, pausing longer each time', tries === 3 && c.failures.length === 0 && Date.now() - t0 >= 55, `${Date.now() - t0} ms`);
  tries = 0;
  await collect({ key: 'k', searches: [s], fetchImpl: async () => { tries++; return { ok: false, status: 401, text: async () => 'nope', json: async () => ({}) }; }, now: NOW, retries: 2 });
  ok('a bad key is not retried', tries === 1);
  tries = 0;
  await collect({ key: 'k', searches: [s], fetchImpl: never, now: NOW });
  ok('with no retries (the cron) it tries once', tries === 1);
}

/* -------------------------------------------------------------- */
sec('the registry changes nothing about publishing');
{
  const [pub] = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }]);
  ok('the strict dated-entry filter still holds for the publish path', /no closing date/.test(pub.judge({ title: 'Graduate Programme', url: 'https://www.absa.co.za/careers/graduates', content: 'Apply now.', score: 0.9 }, pub, NOW).reason));
  const [reg] = planRegistrySearches([{ name: 'Absa', domain: 'absa.co.za' }]);
  const f = reg.judge({ title: 'Graduate Programme 2027', url: 'https://www.absa.co.za/careers/graduates', content: 'Applications close 31 October.', score: 0.9 }, reg).finding;
  ok('a registry finding has no closing date and no assumed year, whatever the text says', f.closes === '' && f.cycleYear === 2027 && f.yearAssumed === undefined);
  ok('a registry search is not a publish search: no page text, a different pass', reg.rawContent === false && reg.pass === 'registry' && pub.pass === 'employers');
  ok('the visible cycle year is the title\'s or slug\'s, not a post date', visibleCycleYear('Careers', 'https://x.com/spotlight/2022-11-29-early-careers-1785966') === null && visibleCycleYear('Careers', 'https://x.co.za/graduate-programme-2028') === 2028 && visibleCycleYear('Graduate programme 2022', 'https://x.co.za/careers') === 2022);
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
