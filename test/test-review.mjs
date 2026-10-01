/**
 * Tests the review half: digest email, signed action links, batch merge.
 * All network is mocked; nothing is sent or merged.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { signToken, verifyToken } from '../src/tokens.js';
import { sendDigest } from '../src/email.js';
import { handleAction } from '../src/action.js';
import { runDigest, runBatchMerge } from '../src/cron.js';

const SECRET = 'unit-test-hmac-secret';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${e}`)); };

const config = {
  token: 't', hmacSecret: SECRET, resendKey: 're_test',
  owner: 'realtimshady16', repo: 'mzantsi-vibes',
  reviewerName: 'Tim', reviewerEmail: 'tim@example.com',
  emailFrom: 'Mzantsi Vibes <onboarding@resend.dev>',
  baseUrl: 'https://mz.example', tokenTtlHours: 72, branchPrefix: 'contribute',
};

const pull = (n, over = {}) => ({
  number: n, title: `contribute: Add to Book Summaries (from Someone)`, state: 'open',
  html_url: `https://github.com/realtimshady16/mzantsi-vibes/pull/${n}`,
  // What the GitHub App's PRs look like: a Bot user, and a branch in this repo.
  user: { login: 'mzantsi-vibes-contribute[bot]', type: 'Bot' },
  head: { ref: `contribute/add-book-summaries-${n}`, repo: { full_name: 'realtimshady16/mzantsi-vibes' } },
  created_at: '2026-09-27T06:00:00Z',
  labels: [{ name: 'needs-review' }], ...over,
});

/* A PR that is not ours: the repo owner's own work, on a branch in the same repo. */
const humanPull = (n, over = {}) => pull(n, {
  user: { login: 'realtimshady16', type: 'User' },
  head: { ref: 'feature/something', repo: { full_name: 'realtimshady16/mzantsi-vibes' } },
  ...over,
});

/* mock gh that records label mutations */
function mockGh(pulls) {
  const rec = { added: [], removed: [], merged: [], closed: [], commented: [], ensured: [], branchesDeleted: [] };
  const state = new Map(pulls.map((p) => [p.number, new Set(p.labels.map((l) => l.name))]));
  return {
    rec, state,
    ensureLabel: async (o, r, name) => { rec.ensured.push(name); return { name }; },
    listLabels: async () => [...rec.ensured].map((name) => ({ name })),
    listOpenPulls: async (o, r, { labels } = {}) => {
      const live = (p) => state.get(p.number) || new Set(p.labels.map((l) => l.name));
      let out = pulls.filter((p) => p.state === 'open');
      if (labels) {
        const want = new Set(labels.map((l) => l.toLowerCase()));
        out = out.filter((p) => [...live(p)].some((n) => want.has(n.toLowerCase())));
      }
      return out;
    },
    addLabels: async (o, r, n, labels) => {
      rec.added.push({ n, labels });
      for (const l of labels) state.get(n)?.add(l);
    },
    removeLabel: async (o, r, n, name) => { rec.removed.push({ n, name }); state.get(n)?.delete(name); },
    mergePull: async (o, r, n) => { rec.merged.push(n); return { merged: true }; },
    closePull: async (o, r, n) => { rec.closed.push(n); return {}; },
    deleteBranch: async (o, r, branch) => { rec.branchesDeleted.push(branch); return {}; },
    commentPull: async (o, r, n, body) => { rec.commented.push({ n, body }); return {}; },
    getPull: async (o, r, n) => {
      const p = pulls.find((x) => x.number === n);
      if (!p) { const e = new Error('Not Found'); e.status = 404; throw e; }
      return p;
    },
  };
}

const mockFetch = (capture) => async (url, opts) => {
  capture.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
  return new Response(JSON.stringify({ id: 'em_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

/* ---------------- digest ---------------- */
console.log('\n== digest ==');
{
  const captured = [];
  const gh = mockGh([pull(1), pull(2), pull(3)]);
  await runDigest({ config, gh, fetchImpl: mockFetch(captured) });
  ok('labels ensured on first run', gh.rec.ensured.includes('approved'));
  ok('runDigest sends one email', captured.length === 1, `${captured.length}`);
  const r = await sendDigest({ config, pulls: [pull(1), pull(2)], gh: mockGh([]), fetchImpl: mockFetch(captured) });
  ok('reports pending count', r.pending === 2, JSON.stringify(r));

  const mail = captured.at(-1);  // the explicit 2-PR sendDigest below runDigest's 3-PR email
  ok('posts to resend', mail.url === 'https://api.resend.com/emails');
  ok('exactly one email per sendDigest call', captured.length === 2, `${captured.length}`);
  ok('authorised with the api key', mail.headers.Authorization === 'Bearer re_test', mail.headers.Authorization);
  ok('sent to the reviewer', mail.body.to[0] === 'tim@example.com');
  ok('from is configured sender', mail.body.from.includes('@'));
  ok('subject counts the PRs', /2 contributions to review/.test(mail.body.subject), mail.body.subject);

  const html = mail.body.html;
  const links = [...html.matchAll(/https:\/\/mz\.example\/action\?token=([A-Za-z0-9_.%-]+)/g)].map((m) => m[1]);
  ok('one approve + one reject link per PR', links.length === 4, `${links.length} links`);
  ok('links are url-encoded', links.every((l) => !l.includes('+') && !l.includes('/')), links[0]);

  const decoded = await Promise.all(links.map((l) => verifyToken(SECRET, decodeURIComponent(l))));
  ok('every link verifies', decoded.every((d) => d.ok));
  const pairs = decoded.map((d) => `${d.payload.p}:${d.payload.a}`).sort();
  ok('links cover approve+reject for #1 and #2',
    JSON.stringify(pairs) === JSON.stringify(['1:approve','1:reject','2:approve','2:reject']),
    pairs.join(', '));
  ok('html escapes the reviewer name', !html.includes('<script'));
}

console.log('\n== digest: nothing pending ==');
{
  const captured = [];
  const r = await sendDigest({ config, pulls: [], gh: mockGh([]), fetchImpl: mockFetch(captured) });
  ok('still sends an all-clear', r.sent && captured.length === 1);
  ok('all-clear says nothing is pending', /Nothing is waiting/.test(captured[0].body.html));
  ok('subject is not alarming', /nothing to review/.test(captured[0].body.subject));
}

console.log('\n== digest: already-decided PRs are skipped ==');
{
  const gh = mockGh([
    pull(1),
    pull(2, { labels: [{ name: 'approved' }] }),
    pull(3, { labels: [{ name: 'rejected' }] }),
  ]);
  const captured = [];
  const result = await runDigest({ config, gh, fetchImpl: mockFetch(captured) });
  ok('digest run completes', result.sent === true, JSON.stringify(result));
  ok('3 open contribution PRs found', result.openContributionPRs === 3, String(result.openContributionPRs));
  ok('2 already-decided PRs skipped', result.skippedDecided === 2, String(result.skippedDecided));
  ok('only the undecided PR is in the email', /#1 /.test(captured[0].body.html) && !/#2 |#3 /.test(captured[0].body.html));
  ok('digest subject says 1 contribution', /1 contribution to review/.test(captured[0].body.subject), captured[0].body.subject);
}

console.log('\n== digest: only the contribute form\'s own PRs ==');
{
  const gh = mockGh([pull(1), humanPull(2), humanPull(3, { head: { ref: 'contribute/looks-like-ours', repo: { full_name: 'realtimshady16/mzantsi-vibes' } } })]);
  const captured = [];
  const result = await runDigest({ config, gh, fetchImpl: mockFetch(captured) });
  ok('the owner\'s own PRs are not digested, even on a contribute/ branch', result.openContributionPRs === 1, String(result.openContributionPRs));
  ok('only #1 is in the email', /#1 /.test(captured[0].body.html) && !/#2 |#3 /.test(captured[0].body.html));
}

/* ---------------- action endpoint ---------------- */
console.log('\n== action endpoint ==');
const act = async (prs, token, cfg = config) => {
  const gh = mockGh(prs);
  const url = new URL('https://mz.example/action?token=' + encodeURIComponent(token));
  const res = await handleAction({ request: {}, config: cfg, gh, url });
  return { gh, res, html: await res.text() };
};

{
  const good = await signToken(SECRET, { pr: 1, action: 'approve', ttlHours: 72 });
  const { gh, res, html } = await act([pull(1)], good);
  ok('approve returns 200', res.status === 200);
  ok('adds the approved label', gh.rec.added.some((a) => a.labels.includes('approved')));
  ok('removes rejected so last click wins', gh.rec.removed.some((r) => r.name === 'rejected'));
  ok('removes needs-review', gh.rec.removed.some((r) => r.name === 'needs-review'));
  ok('confirms in the page', /approved/.test(html));
  ok('page explains it does not merge yet', /18:00/.test(html));
}

{
  const tok = await signToken(SECRET, { pr: 1, action: 'reject', ttlHours: 72 });
  const { gh, res, html } = await act([pull(1)], tok);
  ok('reject returns 200', res.status === 200);
  ok('adds the rejected label', gh.rec.added.some((a) => a.labels.includes('rejected')));
  ok('removes approved', gh.rec.removed.some((r) => r.name === 'approved'));
  ok('confirms rejection', /rejected/.test(html));
}

console.log('\n== action endpoint: refuses PRs that are not contributions ==');
{
  const tok = await signToken(SECRET, { pr: 5, action: 'approve', ttlHours: 72 });
  const { gh, res, html } = await act([humanPull(5)], tok);
  ok('a validly-signed link to someone\'s own PR is refused (403)', res.status === 403, String(res.status));
  ok('...says why', /Not a contribution/.test(html));
  ok('...and labels nothing, so the batch job could never merge it', gh.rec.added.length === 0 && gh.rec.removed.length === 0);
}

console.log('\n== action endpoint: rejects bad input ==');
{
  let { res, html } = await act([pull(1)], 'garbage');
  ok('garbage token -> 400', res.status === 400);
  ok('explains the link is invalid', /not valid|malformed/i.test(html), html.slice(0, 120));

  const wrong = await signToken('other-secret', { pr: 1, action: 'approve', ttlHours: 72 });
  ({ res, html } = await act([pull(1)], wrong));
  ok('token signed with another secret -> 400', res.status === 400);
  ok('says signature does not match', /Signature does not match/.test(html));

  const expired = await signToken(SECRET, { pr: 1, action: 'approve', ttlHours: -1 });
  ({ res, html } = await act([pull(1)], expired));
  ok('expired token -> 400', res.status === 400);
  ok('says expired', /expired/i.test(html));

  const valid = await signToken(SECRET, { pr: 77, action: 'approve', ttlHours: 72 });
  ({ res } = await act([pull(1)], valid));
  ok('valid token for a missing PR -> 404', res.status === 404);

  const forOne = await signToken(SECRET, { pr: 1, action: 'approve', ttlHours: 72 });
  ({ res, html } = await act([pull(1, { state: 'closed' })], forOne));
  ok('already-closed PR -> 409', res.status === 409);
  ok('says nothing to do', /Nothing to do/.test(html));

  const url = new URL('https://mz.example/action');
  const gh = mockGh([pull(1)]);
  const r2 = await handleAction({ request: {}, config, gh, url });
  ok('no token at all -> 400', r2.status === 400);
  ok('no labels mutated by any bad input', gh.rec.added.length === 0 && gh.rec.removed.length === 0);
}

/* ---------------- batch merge ---------------- */
console.log('\n== batch merge ==');
{
  const gh = mockGh([
    pull(1, { labels: [{ name: 'approved' }, { name: 'needs-review' }] }),
    pull(2, { labels: [{ name: 'approved' }] }),
    pull(3, { labels: [{ name: 'rejected' }] }),
    pull(4, { labels: [{ name: 'needs-review' }] }),
  ]);
  const s = await runBatchMerge({ config, gh });
  ok('merges only approved', JSON.stringify(s.merged) === '[1,2]', JSON.stringify(s.merged));
  ok('closes only rejected', JSON.stringify(s.closed) === '[3]', JSON.stringify(s.closed));
  ok('leaves undecided PR 4 alone', !s.merged.includes(4) && !s.closed.includes(4));
  ok('nothing failed', s.failed.length === 0, JSON.stringify(s.failed));
  ok('labels stripped after merge so it cannot re-run',
    gh.rec.removed.some((r) => r.n === 1 && r.name === 'approved') &&
    gh.rec.removed.some((r) => r.n === 1 && r.name === 'needs-review'));
  ok('rejected PR gets a comment', gh.rec.commented.some((c) => c.n === 3 && /rejected/i.test(c.body)));
  ok('comment links back to the form', gh.rec.commented.some((c) => c.body.includes('https://mz.example/contribute/')));
  ok('...with a single https:// (baseUrl already has one)', !gh.rec.commented.some((c) => /https:\/\/https:/.test(c.body)));
}

console.log('\n== batch merge: never touches PRs that are not contributions ==');
{
  const gh = mockGh([
    humanPull(10, { labels: [{ name: 'approved' }] }),
    humanPull(11, { labels: [{ name: 'rejected' }] }),
    pull(12, { labels: [{ name: 'approved' }] }),
  ]);
  const s = await runBatchMerge({ config, gh });
  ok('an approved-labelled human PR is not merged', !s.merged.includes(10) && JSON.stringify(s.merged) === '[12]', JSON.stringify(s.merged));
  ok('a rejected-labelled human PR is not closed', !s.closed.includes(11) && s.closed.length === 0, JSON.stringify(s.closed));
  ok('nothing about them was commented or relabelled', !gh.rec.commented.some((c) => c.n === 11) && !gh.rec.removed.some((r) => r.n === 10 || r.n === 11));
}

console.log('\n== batch merge: tidies up branches ==');
{
  const gh = mockGh([
    pull(1, { labels: [{ name: 'approved' }] }),
    pull(2, { labels: [{ name: 'rejected' }] }),
    pull(3, { labels: [{ name: 'needs-review' }] }),
  ]);
  await runBatchMerge({ config, gh });
  ok('the merged PR\'s branch is deleted', gh.rec.branchesDeleted.includes('contribute/add-book-summaries-1'));
  ok('the closed PR\'s branch is deleted', gh.rec.branchesDeleted.includes('contribute/add-book-summaries-2'));
  ok('an undecided PR\'s branch is kept', !gh.rec.branchesDeleted.includes('contribute/add-book-summaries-3'));

  const failing = mockGh([pull(1, { labels: [{ name: 'approved' }] })]);
  failing.deleteBranch = async () => { throw new Error('Reference does not exist'); };
  const s = await runBatchMerge({ config, gh: failing });
  ok('a branch that cannot be deleted does not fail the run', s.merged.length === 1 && s.failed.length === 0, JSON.stringify(s));

  const keep = mockGh([pull(1, { labels: [{ name: 'approved' }] })]);
  keep.mergePull = async () => ({ merged: false, message: 'conflict' });
  await runBatchMerge({ config, gh: keep });
  ok('a PR that failed to merge keeps its branch', keep.rec.branchesDeleted.length === 0);
}

console.log('\n== batch merge: a failing merge is reported, not fatal ==');
{
  const gh = mockGh([pull(1, { labels: [{ name: 'approved' }] })]);
  gh.mergePull = async () => ({ merged: false, message: 'Base branch was modified' });
  const s = await runBatchMerge({ config, gh });
  ok('failure captured', s.failed.length === 1 && s.failed[0].pr === 1, JSON.stringify(s));
  ok('reason surfaced', /Base branch was modified/.test(s.failed[0].reason));
  ok('nothing reported as merged', s.merged.length === 0);
}

console.log('\n== batch merge is idempotent ==');
{
  const gh = mockGh([pull(1, { labels: [{ name: 'approved' }] })]);
  const first = await runBatchMerge({ config, gh });
  gh.rec.merged.length = 0;
  // simulate the label having been removed, as runBatchMerge does after merging
  const second = await runBatchMerge({ config, gh });
  ok('second run merges nothing', second.merged.length === 0, JSON.stringify(second));
  ok('first run merged once', first.merged.length === 1);
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
