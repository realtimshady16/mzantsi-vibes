/**
 * The weekly digest's PR of dated leads: inserting into OPPORTUNITIES.md, what is
 * skipped, the safety limits, and the whole job with GitHub and Tavily faked.
 * No network, nothing opened. Run: node test/test-opportunity-pr.mjs
 */
import { readFileSync } from 'node:fs';
import { insertEntries, linkTargets } from '../src/opportunities-file.js';
import { planOpportunityPr, openOpportunityPr, runWeeklyOpportunities, MAX_ENTRIES, OPPS_PATH } from '../src/opportunity-pr.js';
import { isContributionPull, LABELS } from '../src/github.js';
import { parseReadme } from '../PUBLISH/content-parse.js';
import { entryLine } from '../src/opportunities.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

const NOW = new Date('2026-10-05T05:00:00Z'); // a Monday
const STUDY = "🎓 I'm Going to Study", WORK = "💼 I'm Going to Work";
const skeleton = readFileSync(new URL('../OPPORTUNITIES.md', import.meta.url), 'utf8');
const L = (n, d = '2026-11-30') => `-   [${n}](https://x.org/${n.toLowerCase().replace(/\W+/g, '-')}) — About ${n}. {closes: ${d}; tags: bursary, deadline; source: x.org}`;
const added = (before, after) => after.split('\n').filter((l, i, a) => !before.split('\n').includes(l) || (l === '' && false));

/* -------------------------------------------------------------- */
sec('insertEntries');
{
  const one = insertEntries(skeleton, [{ pillar: STUDY, section: 'Paying for It', line: L('Alpha') }]);
  ok('a pillar with no sections gets a new ### section holding the entry', /## 🎓 I'm Going to Study\n\n### Paying for It\n\n-   \[Alpha\]/.test(one), one.slice(one.indexOf('## 🎓')));
  ok('a blank line separates it from the next pillar', /Alpha[^\n]*\n\n## 💼/.test(one));
  ok('nothing else in the file changed', skeleton.split('\n').every((l) => one.split('\n').includes(l)) && one.split('\n').length === skeleton.split('\n').length + 4);

  const two = insertEntries(one, [{ pillar: STUDY, section: 'Paying for It', line: L('Beta') }]);
  ok('a second entry joins the existing section after the first', /Alpha[^\n]*\n-   \[Beta\][^\n]*\n\n## 💼/.test(two));
  ok('...and does not create a second heading', two.split('### Paying for It').length === 2);

  const multi = insertEntries(skeleton, [
    { pillar: WORK, section: 'Finding Work', line: L('Gamma') },
    { pillar: STUDY, section: 'Paying for It', line: L('Delta') },
    { pillar: STUDY, section: 'Paying for It', line: L('Eps') },
  ]);
  const parsed = parseReadme(multi, '2026-10-05');
  ok('several pillars and sections in one call', parsed.pillars.work['Finding Work'].map((e) => e.name).join() === 'Gamma' && parsed.pillars.study['Paying for It'].map((e) => e.name).join() === 'Delta,Eps');

  const empty = skeleton.replace(`## ${STUDY}\n`, `## ${STUDY}\n\n### Paying for It\n`);
  const into = insertEntries(empty, [{ pillar: STUDY, section: 'Paying for It', line: L('Zed') }]);
  ok('an empty section gets a blank line after its heading', /### Paying for It\n\n-   \[Zed\]/.test(into));

  const endOfFile = skeleton.replace(/\n+$/, '');
  ok('works when the file has no trailing newline', parseReadme(insertEntries(endOfFile, [{ pillar: "📋 For Everyone", section: 'S', line: L('Last') }]), '2026-10-05').pillars.everyone.S.length === 1);
  let threw = '';
  try { insertEntries(skeleton, [{ pillar: 'Nonexistent Pillar', section: 'S', line: L('X') }]); } catch (e) { threw = e.message; }
  ok('an unknown pillar throws instead of writing somewhere else', /no "## Nonexistent Pillar" heading/.test(threw), threw);
  ok('the format documentation in the file is untouched', one.includes('## Format') && one.includes('| `closes` |'));
  ok('linkTargets finds every link target', linkTargets('a [x](https://a.org/1) b [y](http://b.org/2) [z](#anchor)').join() === 'https://a.org/1,http://b.org/2');
}

/* -------------------------------------------------------------- */
const finding = (name, extra = {}) => ({
  title: name, url: `https://www.zabursaries.co.za/engineering-bursaries-south-africa/${name.toLowerCase().replace(/\W+/g, '-')}`,
  desc: `About ${name}.`, source: 'zabursaries', pass: 'scoped', category: 'Bursaries', tag: 'Engineering', closes: '2026-11-30', ...extra,
});

function fakeGh({ opps = skeleton, readme = '# README\n\n-   [Listed](https://www.zabursaries.co.za/listed) — Already here.\n', pulls = [], failAt } = {}) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push([name, ...a]); if (failAt === name) throw new Error(`${name} exploded`); return fn(...a); };
  return {
    calls,
    getReadme: rec('getReadme', async (o, r, path = 'README.md') => (path === OPPS_PATH ? { content: opps, sha: 'opps-sha' } : { content: readme, sha: 'readme-sha' })),
    listOpenPulls: rec('listOpenPulls', async () => pulls),
    getDefaultBranchSha: rec('getDefaultBranchSha', async () => 'main-sha'),
    createBranch: rec('createBranch', async () => ({})),
    commitReadme: rec('commitReadme', async () => ({})),
    createPullRequest: rec('createPullRequest', async (o, r, pr) => ({ number: 77, html_url: 'https://github.com/o/r/pull/77', ...pr })),
    deleteBranch: rec('deleteBranch', async () => ({})),
    ensureLabel: rec('ensureLabel', async () => ({})),
    addLabels: rec('addLabels', async () => ({})),
    createIssue: rec('createIssue', async (o, r, i) => ({ number: 9, html_url: 'https://github.com/o/r/issues/9', ...i })),
    names: () => calls.map((c) => c[0]),
    of: (n) => calls.filter((c) => c[0] === n),
  };
}
const config = { owner: 'o', repo: 'r', branchPrefix: 'contribute', tavilyKey: 'k' };

sec('planOpportunityPr: what goes in and what is left out');
{
  const gh = fakeGh();
  const plan = await planOpportunityPr({ config, gh, now: NOW, findings: [
    finding('Late', { closes: '2026-12-20' }), finding('Soon', { closes: '2026-10-20' }), finding('Mid'),
    finding('Undated', { closes: undefined }),
    finding('Past', { closes: '2026-10-04' }),
    finding('Broad', { pass: 'broad', source: 'broader search', url: 'https://jobs.example.co.za/1' }),
    finding('Closing page', { pass: 'closing', category: 'Closing soon', closes: undefined }),
  ] });
  ok('only dated, open, trusted leads go in, soonest closing first', plan.entries.map((f) => f.title).join() === 'Soon,Mid,Late', plan.entries.map((f) => f.title).join());
  ok('the markdown has them under the right pillar and section', (() => { const p = parseReadme(plan.markdown, '2026-10-05'); return p.pillars.study['Paying for It'].map((e) => e.name).join() === 'Soon,Mid,Late'; })());
  ok('it carries the file sha for the commit', plan.sha === 'opps-sha');
  ok('planning writes nothing', gh.names().every((n) => ['getReadme', 'listOpenPulls'].includes(n)));

  const dup = await planOpportunityPr({ config, gh: fakeGh({ opps: insertEntries(skeleton, [{ pillar: STUDY, section: 'Paying for It', line: L('Mid') }]).replace('https://x.org/mid', finding('Mid').url + '?utm_source=x') }), now: NOW, findings: [finding('Mid'), finding('Fresh')] });
  ok('a link already in OPPORTUNITIES.md is skipped (even with tracking junk or www)', dup.entries.map((f) => f.title).join() === 'Fresh' && dup.skippedDuplicates === 1);
  const inReadme = await planOpportunityPr({ config, gh: fakeGh(), now: NOW, findings: [{ ...finding('Listed'), url: 'https://zabursaries.co.za/listed/' }, finding('Fresh')] });
  ok('a link already in the README is skipped too', inReadme.entries.map((f) => f.title).join() === 'Fresh');
  const none = await planOpportunityPr({ config, gh: fakeGh(), now: NOW, findings: [finding('Undated', { closes: undefined })] });
  ok('no dated lead → no PR, with the reason', /no lead this week had a closing date/.test(none.skipped));
  const allDup = await planOpportunityPr({ config, gh: fakeGh(), now: NOW, findings: [{ ...finding('Listed'), url: 'https://www.zabursaries.co.za/listed' }] });
  ok('all already listed → no PR, with the reason', /already listed/.test(allDup.skipped));

  const many = Array.from({ length: MAX_ENTRIES + 4 }, (_, i) => finding(`Bursary ${i}`, { closes: `2026-11-${String(10 + i).padStart(2, '0')}` }));
  const capped = await planOpportunityPr({ config, gh: fakeGh(), now: NOW, findings: many });
  ok(`at most ${MAX_ENTRIES} entries per PR, the soonest ones, and it says how many wait`, capped.entries.length === MAX_ENTRIES && capped.entries[0].title === 'Bursary 0' && capped.hiddenByCap === 4);

  const bot = { user: { type: 'Bot' }, number: 51, head: { ref: 'contribute/opps-2026-09-28-abc123', repo: { full_name: 'o/r' } } };
  const guarded = await planOpportunityPr({ config, gh: fakeGh({ pulls: [bot] }), now: NOW, findings: [finding('Fresh')] });
  ok("an earlier digest PR still open → no second one, and it names #51", /PR #51 .* still open/.test(guarded.skipped));
  const formPr = { user: { type: 'Bot' }, number: 52, head: { ref: 'contribute/new-paying-for-it-abc', repo: { full_name: 'o/r' } } };
  const human = { user: { type: 'User' }, number: 53, head: { ref: 'contribute/opps-fake', repo: { full_name: 'o/r' } } };
  const notGuarded = await planOpportunityPr({ config, gh: fakeGh({ pulls: [formPr, human] }), now: NOW, findings: [finding('Fresh')] });
  ok("a form submission's PR, or a person's branch that looks similar, does not block it", Boolean(notGuarded.entries));

  const rawCalls = [];
  const rawFetch = async (u) => { rawCalls.push(u); return { ok: true, status: 200, text: async () => (u.endsWith(OPPS_PATH) ? skeleton : '# README\n') }; };
  const preview = await planOpportunityPr({ config, gh: null, now: NOW, findings: [finding('Fresh')], fetchImpl: rawFetch });
  ok('with no GitHub login (a preview) it reads the public raw files', preview.entries.length === 1 && rawCalls.length === 2 && rawCalls.every((u) => u.startsWith('https://raw.githubusercontent.com/o/r/main/')));
}

/* -------------------------------------------------------------- */
sec('openOpportunityPr: it is a normal contribution PR');
{
  const gh = fakeGh();
  const findings = [finding('Soon', { closes: '2026-10-20' }), finding('Mid')];
  const plan = await planOpportunityPr({ config, gh, now: NOW, findings });
  const pr = await openOpportunityPr({ config, gh, plan, now: NOW });
  ok('returns the PR number and link', pr.number === 77 && /pull\/77/.test(pr.url));
  const [, , , branch, base] = gh.of('createBranch')[0];
  ok('branched from main, onto contribute/opps-<date>-<random>', base === 'main-sha' && /^contribute\/opps-2026-10-05-[0-9a-f]{6}$/.test(branch), branch);
  const commit = gh.of('commitReadme')[0];
  ok('commits OPPORTUNITIES.md to that branch, never anything else, with the sha it read', commit[3] === branch && commit[4].path === OPPS_PATH && commit[4].sha === 'opps-sha' && commit[4].content === plan.markdown);
  ok('only the one file is committed, once', gh.of('commitReadme').length === 1);
  const made = gh.of('createPullRequest')[0][3];
  ok('the PR targets main from that branch', made.base === 'main' && made.head === branch);
  ok('the title says how many', made.title === 'contribute: Add 2 opportunities with closing dates (weekly digest)', made.title);
  ok('the body lists each entry with its date and link, and says to check the dates', made.body.includes('closes **2026-10-20**') && made.body.includes('zabursaries.co.za/engineering-bursaries-south-africa/soon') && /Check each date against the page/.test(made.body));
  ok('it is labelled needs-review, like a form submission', gh.of('addLabels')[0][4].join() === LABELS.pending);
  const asPull = { user: { type: 'Bot' }, head: { ref: branch, repo: { full_name: 'o/r' } } };
  ok('the existing review flow recognises it (isContributionPull)', isContributionPull(asPull, config));
  ok('nothing is merged and nothing is pushed to main', !gh.names().includes('mergePull') && gh.of('commitReadme').every((c) => c[3] !== 'main'));
}

/* -------------------------------------------------------------- */
sec('runWeeklyOpportunities: the whole job');
{
  const fetchPage = async () => ({ ok: true, status: 200, text: async () => '' });
  const tavily = () => async (url, init) => {
    const body = JSON.parse(init.body);
    const results = /engineering/.test(body.query)
      ? [{ title: 'Sasol Bursary', url: 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary', content: 'For engineers. Closing date: 30 November 2026.', score: 0.9 },
         { title: 'Undated Bursary', url: 'https://www.zabursaries.co.za/engineering-bursaries-south-africa/undated', content: 'No date given.', score: 0.9 }]
      : [];
    return { ok: true, status: 200, json: async () => ({ results }) };
  };
  const base = (gh, extra = {}) => ({ config, gh, fetchImpl: tavily(), fetchPage, now: NOW, ...extra });

  const gh = fakeGh();
  const real = await runWeeklyOpportunities(base(gh));
  ok('a real run opens the PR and the issue', real.pr?.number === 77 && real.issueUrl && gh.of('createPullRequest').length === 1 && gh.of('createIssue').length === 1);
  const issue = gh.of('createIssue')[0][3].body;
  ok('the issue says the PR was opened, right after its opening paragraph', /📬 Opened PR #77 adding 1 dated lead/.test(issue) && issue.indexOf('📬') < issue.indexOf('## ⏰'));
  ok('only the dated lead is in the PR', gh.of('commitReadme')[0][4].content.includes('Sasol Bursary') && !gh.of('commitReadme')[0][4].content.includes('Undated Bursary'));
  ok('the issue still lists both leads', issue.includes('[Sasol Bursary]') && issue.includes('[Undated Bursary]'));

  const dgh = fakeGh();
  const dry = await runWeeklyOpportunities(base(dgh, { dryRun: true }));
  ok('a dry run opens nothing and writes nothing (no branch, commit, PR, label or issue)',
    !dgh.names().some((n) => ['createBranch', 'commitReadme', 'createPullRequest', 'ensureLabel', 'addLabels', 'createIssue'].includes(n)));
  ok('...but shows exactly what it would add', dry.prPreview?.count === 1 && dry.prPreview.entries[0].line.includes('{closes: 2026-11-30;') && /Preview/.test(dry.body));
  ok('...and returns no issue link', dry.issueUrl === null);

  const noPr = fakeGh();
  await runWeeklyOpportunities(base(noPr, { openPr: false }));
  ok('openPr:false posts the issue only', noPr.of('createPullRequest').length === 0 && noPr.of('createBranch').length === 0 && noPr.of('createIssue').length === 1);

  const boom = fakeGh({ failAt: 'createPullRequest' });
  const errs = console.error; console.error = () => {};
  const failed = await runWeeklyOpportunities(base(boom));
  console.error = errs;
  ok('if the PR fails the issue is still posted, and says so', failed.issueUrl && failed.pr === null && /Could not open the PR/.test(boom.of('createIssue')[0][3].body) && /createPullRequest exploded/.test(failed.prError));

  const blocked = fakeGh({ pulls: [{ user: { type: 'Bot' }, number: 51, head: { ref: 'contribute/opps-2026-09-28-abc123', repo: { full_name: 'o/r' } } }] });
  const skipped = await runWeeklyOpportunities(base(blocked));
  ok('with an earlier PR still open: no new PR, the issue explains', skipped.pr === null && /No PR this week: PR #51/.test(blocked.of('createIssue')[0][3].body) && blocked.of('createPullRequest').length === 0);

  const dupGh = fakeGh({ readme: '# R\n\n-   [Sasol](https://www.zabursaries.co.za/engineering-bursaries-south-africa/sasol-bursary) — Already.\n' });
  await runWeeklyOpportunities(base(dupGh));
  ok('a lead already in the README is not proposed again', dupGh.of('createPullRequest').length === 0 && /already listed/.test(dupGh.of('createIssue')[0][3].body));
}

/* -------------------------------------------------------------- */
sec('the Worker\'s 50-request limit');
{
  // The first deployed run failed with "Too many subrequests": 20 page lookups that each
  // redirected, on top of the searches and the PR. Count every outbound request in a worst case.
  let n = 0;
  const gh = fakeGh();
  const counted = {};
  for (const [k, v] of Object.entries(gh)) if (typeof v === 'function' && !['names', 'of'].includes(k)) counted[k] = async (...a) => { n += k === 'ensureLabel' ? 2 : 1; return v(...a); };
  const tavilyFetch = async (url, init) => {
    n++;
    const q = JSON.parse(init.body).query;
    const results = Array.from({ length: 5 }, (_, i) => ({ title: `B ${q.slice(0, 6)} ${i}`, url: `https://www.zabursaries.co.za/f${q.length}/${encodeURIComponent(q.slice(0, 6))}-${i}`, content: 'A bursary.', score: 0.9 }));
    return { ok: true, status: 200, json: async () => ({ results }) };
  };
  const pageFetch = async (u) => { n++; return { ok: true, status: 200, text: async () => '<p>Closing date: 30 November 2026</p>' }; };
  const AUTH = 2; // JWT -> installation id -> token
  const out = await runWeeklyOpportunities({ config, gh: { ...gh, ...counted }, fetchImpl: tavilyFetch, fetchPage: pageFetch, now: NOW });
  const total = n + AUTH;
  ok('a worst-case run (50 dated leads, PR and issue both opened) stays under the limit with a margin', out.pr?.number === 77 && out.issueUrl && total <= 45, `used ${total} of 50`);
  console.log(`        (worst case used ${total} of 50)`);
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
