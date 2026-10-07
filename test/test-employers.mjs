/**
 * The employer pass: reading the lead list, one search per company on its own domain, judging a
 * result (own domain, dated, our words), and how a lead flows into the digest and the PR.
 * Tavily and GitHub are faked: no network, no credits. Run: node test/test-employers.mjs
 */
import { parseCompaniesCsv, domainOf, employerCategory, planEmployerSearches, otherCountry, yearlessDeadline, withPortals, planDiscovery, isAggregator } from '../src/employers.js';
import { collect, renderDigest, entryLine, genericDesc, searchLabel } from '../src/opportunities.js';
import { planOpportunityPr } from '../src/opportunity-pr.js';
import { parseReadme } from '../PUBLISH/content-parse.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

const NOW = new Date('2026-10-07T08:00:00Z');

/* -------------------------------------------------------------- */
sec('the lead list');
{
  const csv = 'No.,Company,Batch,Opportunity / programme advertised,Company website\r\n' +
    '1,Absa,Batch 1,"Quantum Leap, a ""graduate"" programme",https://www.absa.co.za\r\n' +
    '2,Eskom,"Batch 1, Batch 2",YES internships,eskom.co.za/careers\n' +
    '3,No Site,Batch 1,Something,\n' +
    '4,Bad Site,Batch 1,Something,not a website\n';
  const list = parseCompaniesCsv(csv);
  ok('quoted fields and CRLF read correctly; rows without a usable website are skipped', list.map((c) => c.name).join() === 'Absa,Eskom', JSON.stringify(list));
  ok('only the name and the domain are kept: nothing about what was advertised', list.every((c) => Object.keys(c).sort().join() === 'domain,name') && !JSON.stringify(list).match(/Quantum|YES|Batch/));
  ok('www2 is the same site, not a subdomain to stick to', domainOf('https://www2.deloitte.com/za/en') === 'deloitte.com');
  ok('the domain loses the scheme, www and path', list[0].domain === 'absa.co.za' && list[1].domain === 'eskom.co.za');
  let threw = '';
  try { parseCompaniesCsv('Name,Url\nA,b.com'); } catch (e) { threw = e.message; }
  ok('a CSV without the two columns is refused', /needs "Company" and "Company website"/.test(threw));
  ok('domainOf rejects what is not a web address', domainOf('') === null && domainOf('hello') === null && domainOf(null) === null && domainOf('https://new.abb.com/za') === 'new.abb.com');
}

/* -------------------------------------------------------------- */
sec('the plan');
{
  const searches = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }, { name: 'Eskom', domain: 'eskom.co.za' }]);
  ok('one search (one credit) per company', searches.length === 2);
  ok('each is limited to that company\'s own domain', searches[0].include.join() === 'absa.co.za' && searches[1].include.join() === 'eskom.co.za');
  ok('the label names the company, so --only can find it', searchLabel(searches[0]) === 'employers · Absa');
  ok('page text is requested, so the date can be read from it', searches.every((x) => x.rawContent === true));
  ok('the query asks for every kind of opportunity and the closing date', /bursary.*graduate programme.*internship.*learnership.*closing date/.test(searches[0].query));
}

/* -------------------------------------------------------------- */
sec('what kind of page is it');
{
  const c = (title, url = 'https://x.co.za/page') => employerCategory({ title, url });
  ok('bursary and scholarship', c('Eskom Bursary 2027') === 'Bursaries' && c('Apply', 'https://x.co.za/careers/scholarships') === 'Bursaries');
  ok('graduate programme', c('Graduate Excellence Programme') === 'Graduate programmes' && c('Young Professionals') === 'Graduate programmes');
  ok('internship', c('Finance internship programme') === 'Internships' && c('x', 'https://x.co.za/work-integrated-learning') === 'Internships');
  ok('learnership and YES', c('Learnerships') === 'Learnerships' && c('Youth Employment Service (YES)', 'https://x.co.za/yes-programme') === 'Learnerships');
  ok('vacation work', c('Vac work 2026') === 'Training & vac work');
  ok('traineeships and CA training are graduate routes', c('Tax traineeship positions') === 'Graduate programmes' && c('x', 'https://x.co.za/students/ca-training-programme.html') === 'Graduate programmes');
  ok('vague early-career wording gets a neutral label, never "graduate"', c('Tiger Brands | Young Talent', 'https://x.com/careers-youth.php') === 'Early careers' && c('x', 'https://x.co.za/careers/student-entry-level-programs') === 'Early careers' && c('x', 'https://x.co.za/working-here/young-talent') === 'Early careers');
  ok('...and a line of our own that says so', genericDesc({ category: 'Early careers', company: 'Tiger Brands' }) === 'Early-careers programme at Tiger Brands. See the page for who can apply and how.');
  ok('a store page or a news item is still not one', c('Mr Price Umtata', 'https://mrp.com/en_za/store/mr-price-umtata') === null && c('Motus app forms', 'https://motus.com/news/motus-app-forms') === null);
  ok('a careers home page or a report is not one', c('Careers') === null && c('Sustainability report 2025') === null);
}

/* -------------------------------------------------------------- */
sec('judging a result');
{
  const [s] = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }]);
  const r = (o) => ({ title: 'Graduate Programme 2027', url: 'https://www.absa.co.za/careers/graduates', content: 'Applications close on 30 November 2026.', score: 0.8, ...o });

  const good = s.judge(r(), s, NOW);
  ok('a dated page on the company\'s own site is a lead', good.finding?.closes === '2026-11-30' && good.finding.category === 'Graduate programmes', JSON.stringify(good));
  ok('named in our words with the cycle year, never the page title', good.finding.title === 'Absa Graduate programme 2027');
  ok('the page\'s own text is not kept', good.finding.desc === '');
  ok('the source is the company', good.finding.source === 'Absa' && good.finding.pass === 'employers');

  ok('another host is dropped, even one with the name in it', /not on absa\.co\.za/.test(s.judge(r({ url: 'https://www.graduates24.com/absa-graduate' }), s, NOW).reason) && /not on absa\.co\.za/.test(s.judge(r({ url: 'https://absa.co.za.evil.org/x' }), s, NOW).reason));
  const [fresh] = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }]);
  ok('a subdomain of the company is fine', Boolean(fresh.judge(r({ url: 'https://jobs.absa.co.za/graduates' }), fresh, NOW).finding));
  ok('no date means no lead (dated entries only)', /no closing date/.test(s.judge(r({ content: 'Apply now for our programme.' }), s, NOW).reason));
  ok('a closing date in the past is dropped', /already passed/.test(s.judge(r({ content: 'Applications close on 30 September 2026.' }), s, NOW).reason));
  ok('a title that only mentions past years is dropped', /past years/.test(s.judge(r({ title: 'Graduate Programme 2024' }), s, NOW).reason));
  ok('a page we cannot classify is dropped', /cannot tell/.test(s.judge(r({ title: 'Careers', url: 'https://www.absa.co.za/careers/home' }), s, NOW).reason));
  ok('a home page is dropped as noise', /noise/.test(s.judge(r({ url: 'https://www.absa.co.za/' }), s, NOW).reason));

  const fromText = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }])[0];
  const viaRaw = fromText.judge(r({ content: 'Short fragment with no date.', raw_content: 'Menu. Application opens 1 October 2026. Application closes 20 November 2026. Footer.' }), fromText, NOW);
  ok('the closing date is read from the page text when the snippet has none', viaRaw.finding?.closes === '2026-11-20', JSON.stringify(viaRaw));
  ok('...and none of that text ends up in the lead', !JSON.stringify(viaRaw).match(/Menu|Footer|Short fragment/));
  const closed = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }])[0];
  ok('a page that says applications are closed says so as the reason', /says applications are closed/.test(closed.judge(r({ content: 'x', raw_content: 'Applications for the 2027 intake have closed. The 2028 programme opens January 2027.' }), closed, NOW).reason));
  const yl = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }])[0];
  // NOW is 7 October 2026.
  const soon = yl.judge(r({ content: 'x', raw_content: 'Application Dates Open: 22 September Close: 22 October Qualifying criteria' }), yl, NOW);
  ok('a window with no year that closes soon is taken, with the year assumed and flagged', soon.finding?.closes === '2026-10-22' && soon.finding.yearAssumed === true, JSON.stringify(soon));
  const dec = yearlessDeadline('Applications close on 5 January.', NOW);
  ok('across the new year, the next 5 January is next year\'s', dec?.date === '2027-01-05', JSON.stringify(dec));
  const far = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }])[0].judge(r({ content: 'x', raw_content: 'Applications close 31 May. Apply early.' }), yl, NOW);
  ok('"31 May" read in October is too far off to assume, and says so', /too far off to assume/.test(far.reason) && !far.finding, JSON.stringify(far));
  ok('two different year-less dates on one page are never guessed between', yearlessDeadline('Closes 22 October. Deadline 30 November.', NOW) === null && /without a year, and not just one/.test(yl.judge(r({ content: 'x', raw_content: 'Closes 22 October. Deadline 30 November.' }), yl, NOW).reason));
  ok('a page that says it is closed is not guessed at', /says applications are closed/.test(yl.judge(r({ content: 'x', raw_content: 'Applications for the 2027 intake have closed. Close: 22 October' }), yl, NOW).reason));
  ok('a date with a year is read as before, never flagged', yl.judge(r(), yl, NOW).finding?.yearAssumed === undefined);
  const issueLine = renderDigest({ findings: [soon.finding], failures: [], searched: 1, now: NOW, employersOnly: true }).body;
  ok('the issue says the year is assumed', /closes 2026-10-22\*\* \(year assumed, confirm on the page\)/.test(issueLine));
  ok('a PDF is dropped', /PDF/.test(yl.judge(r({ url: 'https://www.absa.co.za/docs/graduate-programme-report.pdf' }), yl, NOW).reason));
  ok('another country\'s page on a shared domain is dropped', otherCountry('https://www.deloitte.com/ke/en/careers/x.html') && !otherCountry('https://www.deloitte.com/za/en/careers/x.html') && !otherCountry('https://www.absa.co.za/careers/graduates'));
  const kenya = planEmployerSearches([{ name: 'Deloitte', domain: 'deloitte.com' }])[0];
  ok('...with that as the reason', /another country/.test(kenya.judge(r({ url: 'https://www.deloitte.com/ke/en/careers/students/graduate-programme.html' }), kenya, NOW).reason));

  const again = s.judge(r({ url: 'https://www.absa.co.za/careers/graduates-2' }), s, NOW);
  ok('a second lead of the same kind for the company is dropped', /already have a graduate programme lead/.test(again.reason));
  ok('...but a different kind is kept', Boolean(s.judge(r({ title: 'Bursary 2027', url: 'https://www.absa.co.za/careers/bursary' }), s, NOW).finding));
}

/* -------------------------------------------------------------- */
sec('through the digest and the PR');
{
  const searches = planEmployerSearches([{ name: 'Absa', domain: 'absa.co.za' }, { name: 'Eskom', domain: 'eskom.co.za' }]);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const results = body.include_domains[0] === 'absa.co.za'
      ? [{ title: 'Graduate Programme 2027', url: 'https://www.absa.co.za/careers/graduates', content: 'SECRET PAGE TEXT. Applications close on 30 November 2026.', score: 0.9 }]
      : [{ title: 'Bursary 2027', url: 'https://www.eskom.co.za/careers/bursary', content: 'Closing date: 15 November 2026', score: 0.9 }];
    return { ok: true, status: 200, json: async () => ({ results }) };
  };
  const out = await collect({ key: 'k', searches, fetchImpl, now: NOW });
  ok('collect uses each search\'s own judge', out.findings.map((f) => f.company).join() === 'Absa,Eskom', JSON.stringify(out.findings));
  ok('each request asks Tavily for that one domain only', calls.length === 2 && calls.every((b) => b.include_domains.length === 1 && !b.exclude_domains));

  const issue = renderDigest({ findings: out.findings, failures: [], searched: 2, now: NOW, employersOnly: true }).body;
  ok('the issue names the company\'s own site as the source and has no zabursaries "closing soon" section', /own website/.test(issue) && !/Closing soon/.test(issue) && !/zabursaries/i.test(issue));
  ok('the issue lists title and link, and none of the page text', issue.includes('[Absa Graduate programme 2027](https://www.absa.co.za/careers/graduates)') && !/SECRET PAGE TEXT/.test(issue));
  ok('a graduate programme or bursary is not "Nothing found"', /## Graduate programmes\n\n- \[Absa/.test(issue) && /## Bursaries\n\n- \[Eskom/.test(issue));

  ok('genericDesc gives our own line naming the company', genericDesc(out.findings[0]) === 'Graduate programme at Absa. See the page for who can apply and how.');
  const line = entryLine({ ...out.findings[0], desc: genericDesc(out.findings[0]) });
  ok('the entry line has the date, a tag for the kind, and the company as source', /closes: 2026-11-30; tags: graduate-programme, deadline; source: absa\.co\.za\}$/.test(line) || /closes: 2026-11-30; tags: graduate-programme, deadline; source: www\.absa\.co\.za\}$/.test(line), line);

  const opps = '# Opps\n\n## 🎓 I\'m Going to Study\n\n## 💼 I\'m Going to Work\n\n## 🤷 I Don\'t Know Yet\n\n## 📋 For Everyone\n';
  const fetchContent = async (url) => ({ ok: true, status: 200, text: async () => (/OPPORTUNITIES/.test(url) ? opps : '# README\n') });
  const plan = await planOpportunityPr({ config: { owner: 'o', repo: 'r' }, gh: null, findings: out.findings, now: NOW, fetchImpl: fetchContent });
  ok('the PR plan takes both employer leads, soonest first', plan.entries?.map((f) => f.company).join() === 'Eskom,Absa', JSON.stringify(plan.skipped || plan.entries));
  ok('their descriptions are ours', plan.entries.every((f) => /^(Bursary|Graduate programme) at (Eskom|Absa)\. See the page/.test(f.desc)));
  const parsed = parseReadme(plan.markdown, '2026-10-07');
  ok('the bursary files under Study and the graduate programme under Work, both reading back with their dates',
    parsed.pillars.study['Paying for It']?.[0]?.meta?.closes === '2026-11-15' && parsed.pillars.work['Finding Work']?.[0]?.meta?.closes === '2026-11-30');

  const lookalike = { ...out.findings[0], url: 'https://evil.example/graduates', pass: 'scoped', category: 'Graduate programmes' };
  const refused = await planOpportunityPr({ config: { owner: 'o', repo: 'r' }, gh: null, findings: [lookalike], now: NOW, fetchImpl: fetchContent });
  ok('a lead that did not come from the employer pass or zabursaries is still refused', Boolean(refused.skipped) && !refused.entries);
}

/* -------------------------------------------------------------- */
sec('portals and discovery');
{
  const base = parseCompaniesCsv('Company,Company website\nEskom,https://www.eskom.co.za\nSanlam,https://www.sanlam.co.za\n');
  const withP = withPortals(base, { eskom: ['https://bursaries.eskom-example.org/apply', 'eskom.co.za'] });
  ok('a portal is matched by exact name, any case; the company\'s own domain is not repeated', withP[0].extraDomains.join() === 'bursaries.eskom-example.org' && withP[1].extraDomains === undefined);
  let e1 = '', e2 = '', e3 = '';
  try { withPortals(base, { Eskom: ['https://www.graduates24.com/eskom'] }); } catch (e) { e1 = e.message; }
  try { withPortals(base, { Nobody: ['x.org'] }); } catch (e) { e2 = e.message; }
  try { withPortals(base, { Eskom: ['not a site'] }); } catch (e) { e3 = e.message; }
  ok('an aggregator can never be a portal, even by subdomain', /aggregator/.test(e1) && isAggregator('jobs.careers24.com') && isAggregator('www.zabursaries.co.za') && !isAggregator('eskom.co.za'), e1);
  ok('a name that is not in the list, or not a web address, is refused', /not in the company list/.test(e2) && /not a web address/.test(e3));

  const [s] = planEmployerSearches(withP);
  ok('the search covers the own domain and the portal', s.include.join() === 'eskom.co.za,bursaries.eskom-example.org');
  const r = (url) => ({ title: 'Bursary 2027', url, content: 'Applications close on 30 November 2026.', score: 0.8 });
  ok('a page on the portal is a lead', s.judge(r('https://bursaries.eskom-example.org/apply'), s, NOW).finding?.closes === '2026-11-30');
  ok('a page on a domain nobody listed is not', /not on eskom\.co\.za or bursaries\.eskom-example\.org/.test(s.judge(r('https://other.example/bursary'), s, NOW).reason));

  const [d] = planDiscovery(withP);
  ok('discovery leaves out the company\'s own site and every aggregator, and asks for no page text', d.exclude.includes('eskom.co.za') && d.exclude.includes('graduates24.com') && d.exclude.includes('careers24.com') && !d.rawContent && !d.include);
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
