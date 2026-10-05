/**
 * Running jobs by hand: the signed run tokens, the /api/admin/run endpoint, and
 * the dry-run mode of the review jobs. Also the new-section fix that the manual
 * submit tool turned up. All fake: no network, nothing sent, nothing merged.
 *
 * Run: node test/test-admin.mjs
 */
import { signToken, verifyToken, signAdminToken, verifyAdminToken } from '../src/tokens.js';
import { handleAdminRun } from '../src/admin.js';
import { runDigest, runBatchMerge } from '../src/cron.js';
import { handleSubmit } from '../src/submit.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);

const SECRET = 'unit-test-hmac-secret';
const config = {
  hmacSecret: SECRET, owner: 'realtimshady16', repo: 'mzantsi-vibes', branchPrefix: 'contribute',
  baseUrl: 'https://mz.example', reviewerEmail: 'tim@example.com', reviewerName: 'Tim',
  resendKey: 're_x', emailFrom: 'a@b.c', tokenTtlHours: 72,
};

/* -------------------------------------------------------------- */
sec('run tokens');
{
  const t = await signAdminToken(SECRET, { job: 'digest' });
  ok('a token verifies for its own job', (await verifyAdminToken(SECRET, t, 'digest')).ok);
  ok('...and not for another job', !(await verifyAdminToken(SECRET, t, 'merge')).ok);
  ok('...the error says it is for a different job', /different job/.test((await verifyAdminToken(SECRET, t, 'merge')).error));
  ok('a token signed with another secret is refused', !(await verifyAdminToken('other-secret', t, 'digest')).ok);

  const expired = await signAdminToken(SECRET, { job: 'digest', ttlMinutes: -1 });
  const e = await verifyAdminToken(SECRET, expired, 'digest');
  ok('an expired token is refused', !e.ok && /expired/.test(e.error), JSON.stringify(e));
  ok('the default lifetime is five minutes', (() => {
    return t.split('.')[0] && JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).e - Math.floor(Date.now() / 1000) <= 300;
  })());

  const [body, sig] = t.split('.');
  const forged = btoa(JSON.stringify({ j: 'digest', e: 9999999999 })).replace(/=+$/, '');
  ok('editing the payload (to extend the expiry) breaks the signature', !(await verifyAdminToken(SECRET, `${forged}.${sig}`, 'digest')).ok);
  ok('garbage is refused', !(await verifyAdminToken(SECRET, 'nope', 'digest')).ok && !(await verifyAdminToken(SECRET, '', 'digest')).ok && !(await verifyAdminToken(SECRET, undefined, 'digest')).ok && !(await verifyAdminToken(SECRET, 'a.b.c', 'digest')).ok);

  // The two kinds of token share a secret, so they must not be interchangeable.
  const approve = await signToken(SECRET, { pr: 1, action: 'approve', ttlHours: 72 });
  ok('an Approve link cannot be used to run a job', !(await verifyAdminToken(SECRET, approve, 'digest')).ok);
  ok('a run token cannot be used as an Approve link', !(await verifyToken(SECRET, t)).ok);
}

/* -------------------------------------------------------------- */
sec('the endpoint: who gets in');
const calls = [];
const jobs = {
  digest: async (a) => { calls.push(['digest', a.dryRun]); return { sent: true }; },
  merge: async (a) => { calls.push(['merge', a.dryRun]); return { merged: [1] }; },
  opportunities: async (a) => { calls.push(['opportunities', a.dryRun]); return { findings: 3 }; },
  explode: async () => { throw new Error('GitHub said no'); },
};
const post = (body, token, method = 'POST') =>
  new Request('https://mz.example/api/admin/run', {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const run = async (req) => {
  const res = await handleAdminRun({ request: req, config, gh: {}, jobs });
  return { res, data: await res.json() };
};

{
  const tok = await signAdminToken(SECRET, { job: 'digest' });
  let r = await run(post({ job: 'digest' }, null));
  ok('no token: 401', r.res.status === 401 && r.data.ok === false);
  r = await run(post({ job: 'digest' }, 'garbage'));
  ok('a garbage token: 401', r.res.status === 401);
  r = await run(post({ job: 'digest' }, await signAdminToken('wrong', { job: 'digest' })));
  ok('a token signed with the wrong secret: 401', r.res.status === 401);
  r = await run(post({ job: 'merge' }, tok));
  ok('a "digest" token cannot start "merge": 401', r.res.status === 401 && calls.length === 0);
  r = await run(post({ job: 'digest' }, await signAdminToken(SECRET, { job: 'digest', ttlMinutes: -1 })));
  ok('an expired token: 401', r.res.status === 401);
  r = await run(post({ job: 'digest' }, await signToken(SECRET, { pr: 1, action: 'approve', ttlHours: 1 })));
  ok('an Approve-link token: 401', r.res.status === 401);
  ok('the 401 does not say why (nothing to probe)', r.data.error === 'Unauthorised.');
  ok('none of those ran anything', calls.length === 0);

  r = await run(post(null, tok, 'GET'));
  ok('GET is refused: 405', r.res.status === 405);
  r = await run(post('{not json', tok));
  ok('a bad body: 400', r.res.status === 400);
  ok('responses are never cached', r.res.headers.get('Cache-Control') === 'no-store');

  for (const sneaky of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const t = await signAdminToken(SECRET, { job: sneaky });
    r = await run(post({ job: sneaky }, t));
    ok(`"${sneaky}" is not treated as a job`, r.res.status === 400 && calls.length === 0, `${r.res.status}`);
  }
  const unk = await signAdminToken(SECRET, { job: 'bogus' });
  r = await run(post({ job: 'bogus' }, unk));
  ok('an unknown job (even with a valid token) lists the real ones', r.res.status === 400 && /digest, merge, opportunities/.test(r.data.error), r.data.error);
}

sec('the endpoint: what it runs');
{
  calls.length = 0;
  let r = await run(post({ job: 'digest', dryRun: true }, await signAdminToken(SECRET, { job: 'digest' })));
  ok('digest runs, as a dry run when asked', r.res.status === 200 && r.data.ok && calls[0][0] === 'digest' && calls[0][1] === true);
  ok('the response says what ran and how', r.data.job === 'digest' && r.data.dryRun === true && r.data.result.sent === true);

  r = await run(post({ job: 'merge', dryRun: false }, await signAdminToken(SECRET, { job: 'merge' })));
  ok('merge runs live when dryRun is false', calls[1][0] === 'merge' && calls[1][1] === false);

  r = await run(post({ job: 'opportunities' }, await signAdminToken(SECRET, { job: 'opportunities' })));
  ok('leaving dryRun out means a real run (it is what the cron does)', calls[2][0] === 'opportunities' && calls[2][1] === false);

  r = await run(post({ job: 'merge', dryRun: 'true' }, await signAdminToken(SECRET, { job: 'merge' })));
  ok('only a real boolean true is a dry run: the string "true" is not', calls[3][1] === false);

  r = await run(post({ job: 'explode' }, await signAdminToken(SECRET, { job: 'explode' })));
  ok('a failing job: 500 with its message', r.res.status === 500 && r.data.error === 'GitHub said no');
  ok('...and no stack trace or secret leaks', !JSON.stringify(r.data).includes('at ') && !JSON.stringify(r.data).includes(SECRET));
}

/* -------------------------------------------------------------- */
sec('dry runs change nothing');

const pull = (n, over = {}) => ({
  number: n, title: `contribute: Add to Law (#${n})`, state: 'open', html_url: `https://github.com/x/y/pull/${n}`,
  user: { type: 'Bot', login: 'app[bot]' },
  head: { ref: `contribute/add-law-${n}`, repo: { full_name: 'realtimshady16/mzantsi-vibes' } },
  labels: [{ name: 'needs-review' }], ...over,
});
const human = (n, labels) => pull(n, { user: { type: 'User', login: 'tim' }, head: { ref: 'feature/x', repo: { full_name: 'realtimshady16/mzantsi-vibes' } }, labels: labels.map((name) => ({ name })) });

function spyGh(pulls) {
  const writes = [];
  const w = (name) => async (...a) => { writes.push(name); return {}; };
  return {
    writes,
    listOpenPulls: async (o, r, { labels } = {}) =>
      pulls.filter((p) => !labels || p.labels.some((l) => labels.map((x) => x.toLowerCase()).includes(l.name.toLowerCase()))),
    ensureLabel: w('ensureLabel'), addLabels: w('addLabels'), removeLabel: w('removeLabel'),
    mergePull: w('mergePull'), closePull: w('closePull'), commentPull: w('commentPull'), deleteBranch: w('deleteBranch'),
  };
}
const neverFetch = async () => { throw new Error('a dry run must not send email'); };

{
  const gh = spyGh([
    pull(1), pull(2, { labels: [{ name: 'approved' }] }), pull(3, { labels: [{ name: 'rejected' }] }), human(4, ['needs-review']),
  ]);
  const r = await runDigest({ config, gh, fetchImpl: neverFetch, dryRun: true });
  ok('digest dry run reports who would be emailed', r.dryRun === true && r.wouldEmail === 'tim@example.com');
  ok('...and exactly which PRs: only the undecided contribution', r.pending.length === 1 && r.pending[0].number === 1, JSON.stringify(r.pending));
  ok('...counts the rest', r.openContributionPRs === 3 && r.skippedDecided === 2);
  ok('...sent nothing and wrote nothing (not even labels)', gh.writes.length === 0, gh.writes.join());
}

{
  const gh = spyGh([
    pull(1, { labels: [{ name: 'approved' }] }), pull(2, { labels: [{ name: 'rejected' }] }), pull(3),
    human(4, ['approved']), human(5, ['rejected']),
  ]);
  const r = await runBatchMerge({ config, gh, dryRun: true });
  ok('merge dry run lists what it would merge and close',
    r.dryRun === true && r.wouldMerge.map((p) => p.number).join() === '1' && r.wouldClose.map((p) => p.number).join() === '2', JSON.stringify(r));
  ok('...never lists someone else\'s PR, even labelled', !JSON.stringify(r).includes('"number":4') && !JSON.stringify(r).includes('"number":5'));
  ok('...merged, closed, commented and relabelled nothing', gh.writes.length === 0, gh.writes.join());

  // and a real run is unchanged
  const live = spyGh([pull(1, { labels: [{ name: 'approved' }] })]);
  live.mergePull = async () => { live.writes.push('mergePull'); return { merged: true }; };
  const real = await runBatchMerge({ config, gh: live });
  ok('without dryRun it still merges', real.merged.length === 1 && live.writes.includes('mergePull'));
}

/* -------------------------------------------------------------- */
sec('the new-section choice (a bug the manual submit tool turned up)');
{
  const README = [
    '# Site', '', "## 🎓 I'm Going to Study", '', '### Before You Apply', '', '-   [A](https://a.org) — one', '',
    "## 💼 I'm Going to Work", '', '### Finding Work', '', '-   [B](https://b.org) — two', '',
    '## 🤷 I Don\'t Know Yet', '', '### Things you can do right now', '', '-   [C](https://c.org) — three', '',
    '## 🌍 For Everyone', '', '### Book Summaries', '', '-   [D](https://d.org) — four', '',
  ].join('\n');
  const committed = [];
  const gh = {
    getReadme: async () => ({ content: README, sha: 'abc' }),
    getDefaultBranchSha: async () => 'deadbeef',
    createBranch: async () => {},
    commitReadme: async (o, r, b, a) => { committed.push(a.content); },
    createPullRequest: async () => ({ number: 7, html_url: 'https://github.com/x/y/pull/7' }),
    listOpenPulls: async () => [],
    ensureLabel: async () => ({}), addLabels: async () => ({}),
  };
  const submit = (section) => handleSubmit({
    request: { json: async () => ({ flow: 'new', pillar: "I'm Going to Study", section, newSectionName: 'Learnerships', content: '[X](https://x.co.za) — y' }) },
    config, gh,
  });

  committed.length = 0;
  await submit('new');
  ok('plain "new" creates the section', committed[0].includes('### Learnerships'));

  committed.length = 0;
  await submit("new::I'm Going to Study");
  ok('"new::<pillar>" (what the form used to send) works too', committed[0]?.includes('### Learnerships'), 'it threw or committed nothing');
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
