/**
 * Integration test: real GitHub reads, mocked mutations.
 * Verifies the submit path end to end without creating anything on the repo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { github } from '../src/github.js';
import { handleSubmit } from '../src/submit.js';
import { sectionOptions, parseStructure } from '../src/readme.js';

/* Token from the environment, or fall back to the git credential store.
 *
 * NOTE: the read helpers here hit the real GitHub API, and ensureFork() will
 * create a fork of the repo for the bot account if one does not exist yet —
 * that is a real write, and it is the same thing the Worker does on a real
 * submission, so it is expected rather than accidental. Everything that would
 * otherwise create a branch, commit or PR is mocked.
 */
function resolveToken() {
  if (process.env.BOT_GITHUB_PAT) return process.env.BOT_GITHUB_PAT;
  const file = `${homedir()}/.git-credentials`;
  if (existsSync(file)) {
    const m = readFileSync(file, 'utf8').match(/https:\/\/[^:]+:([^@]+)@github\.com/);
    if (m) return m[1];
  }
  return null;
}

const token = resolveToken();
if (!token) {
  console.log('\n  SKIPPED — no GitHub token. Set BOT_GITHUB_PAT to run this suite.\n');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${e}`)); };

const real = github(token);
const config = {
  token, owner: 'realtimshady16', repo: 'mzantsi-vibes',
  branchPrefix: 'contribute', hmacSecret: 'x', resendKey: 'x',
  reviewerEmail: 'x@example.com', reviewerName: 'Tim',
  baseUrl: 'https://example.test', emailFrom: 'a@b.c', tokenTtlHours: 72,
  rateLimit: { windowMs: 3600000, max: 5 },
};

/* Real reads, recorded mutations. */
const calls = [];
const gh = {
  ...real,
  botLogin: () => real.botLogin(),
  ensureFork: (o, r) => real.ensureFork(o, r),
  getDefaultBranchSha: (o, r) => real.getDefaultBranchSha(o, r),
  getReadme: (o, r, p) => real.getReadme(o, r, p),
  createBranch: async (fo, fn, branch, sha) => {
    calls.push({ op: 'createBranch', branch, sha });
  },
  commitReadme: async (fo, fn, branch, args) => {
    calls.push({ op: 'commitReadme', branch, sha: args.sha, content: args.content });
  },
  createPullRequest: async (o, r, pr) => {
    calls.push({ op: 'createPullRequest', title: pr.title, head: pr.head, body: pr.body });
    return { number: 999, html_url: 'https://github.com/realtimshady16/mzantsi-vibes/pull/999' };
  },
  ensureLabel: async (o, r, name) => { calls.push({ op: 'ensureLabel', name }); return { name }; },
  addLabels: async (o, r, n, labels) => { calls.push({ op: 'addLabels', n, labels }); },
};

const post = (body) => ({ json: async () => body, clone: () => ({ text: async () => JSON.stringify(body) }) });

console.log('\n== live reads ==');
const readme = await real.getReadme(config.owner, config.repo);
ok('README fetched from GitHub', readme.content.length > 5000, `${readme.content.length} chars`);
ok('blob sha present', /^[0-9a-f]{40}$/.test(readme.sha), readme.sha);
const groups = sectionOptions(readme.content);
ok('section list built', groups.length === 4, `${groups.length} groups`);

console.log('\n== login / fork ==');
const login = await real.botLogin();
ok('bot login resolves', !!login, login);
const fork = await real.ensureFork(config.owner, config.repo);
ok('bot fork exists and is usable', !!fork.owner, JSON.stringify(fork));
const baseSha = await real.getDefaultBranchSha(config.owner, config.repo);
ok('upstream main sha resolves', /^[0-9a-f]{40}$/.test(baseSha), baseSha);

console.log('\n== submit: new resource ==');
let res = await handleSubmit({
  request: post({ flow: 'new', pillar: "I'm Going to Work", section: 'Finding Work',
    content: '-   [INTEGRATION TEST](https://example.co.za/test) — should never be committed', handle: 'Test Runner' }),
  config, gh,
});
ok('returns a PR number', res.prNumber === 999);
ok('branch is namespaced + unique', /^contribute\/new-finding-work-[a-z0-9]+-[0-9a-f]{8}$/.test(calls[0].branch), calls[0].branch);
ok('branch starts from upstream main', calls[0].sha === baseSha);
ok('commit uses upstream blob sha', calls[1].sha === readme.sha);
ok('PR head points at the bot fork', calls[2].head === `${fork.owner}:${calls[0].branch}`, calls[2].head);
ok('PR body records the handle', calls[2].body.includes('Test Runner'));
ok('PR body includes raw submitted content', calls[2].body.includes('INTEGRATION TEST'));
ok('PR body records the flow', /New resource/.test(calls[2].body));
ok('PR body records the section', /Finding Work/.test(calls[2].body));
ok('needs-review label applied', calls.some(c => c.op === 'addLabels' && c.labels.includes('needs-review')));
ok('all three labels ensured', ['needs-review','approved','rejected']
  .every(n => calls.some(c => c.op === 'ensureLabel' && c.name === n)));

const committed = calls[1].content;
ok('committed file has the resource', committed.includes('[INTEGRATION TEST]'));
ok('committed file is the README (plus one line)',
  committed.split('\n').length === readme.content.split('\n').length,
  `${readme.content.split('\n').length} -> ${committed.split('\n').length}`);
ok('committed file keeps 4 pillars', parseStructure(committed).pillars.length === 4);

console.log('\n== submit: anonymous, no handle ==');
calls.length = 0;
res = await handleSubmit({
  request: post({ flow: 'new', pillar: 'For Everyone', section: 'Book Summaries',
    content: '-   [Anon Test](https://example.co.za/anon) — desc' }),
  config, gh,
});
ok('works with no handle', res.prNumber === 999);
ok('PR body says anonymous', /_anonymous/.test(calls[2].body));
ok('PR title has no handle suffix', !calls[2].title.includes('from'), calls[2].title);

console.log('\n== submit: correction ==');
calls.length = 0;
res = await handleSubmit({
  request: post({ flow: 'edit', pillar: 'For Everyone', section: 'Mental Health 101',
    original: '-   [Mental hygiene routine](https://youtu.be/JSOJDVugIQ0?si=9e9YelkLnKUQKvS2)',
    content: '-   [Mental hygiene routine](https://youtu.be/JSOJDVugIQ0?si=9e9YelkLnKUQKvS2) — a 10 minute daily habit',
    handle: 'Fixer' }),
  config, gh,
});
ok('correction PR created', res.prNumber === 999);
ok('PR body quotes the replaced text', calls[2].body.includes('Text that was replaced'));
ok('PR body shows the new text', calls[2].body.includes('10 minute daily habit'));
ok('title says Correct', /^contribute: Correct: /.test(calls[2].title), calls[2].title);
ok('committed README has the fix', calls[1].content.includes('10 minute daily habit'));

console.log('\n== submit: validation errors surface cleanly ==');
calls.length = 0;
for (const [name, body, re] of [
  ['no section chosen', { flow:'new', pillar:"I'm Going to Work", section:'', content:'- a' }, /choose the section/i],
  ['bad pillar', { flow:'new', pillar:'Nonsense', section:'Finding Work', content:'- a' }, /Could not find a section called/],
  ['heading injection', { flow:'new', pillar:'For Everyone', section:'Book Summaries', content:'## Evil' }, /heading/i],
  ['email in handle', { flow:'new', pillar:'For Everyone', section:'Book Summaries', content:'- a', handle:'a@b.com' }, /email address/],
  ['text not found', { flow:'edit', pillar:'For Everyone', section:'Book Summaries', original:'- [Nope](https://z.example)', content:'- b' }, /Could not find that text/],
]) {
  try {
    await handleSubmit({ request: post(body), config, gh });
    fail++; console.log(`  FAIL  ${name} (accepted!)`);
  } catch (e) {
    ok(`rejects: ${name}`, e.name === 'PatchError' && re.test(e.message), `-> ${e.message}`);
  }
}
ok('no PR was created by any rejected submission', !calls.some(c => c.op === 'createPullRequest'));

console.log('\n== handle safety in PR body ==');
// sanitizeHandle runs first, so a table-breaking character can never reach the
// PR body. escMd is belt-and-braces behind it.
for (const [name, handle] of [
  ['pipe', 'Name | Injected'],
  ['angle bracket', 'Name <script>'],
  ['backtick', 'Name `x`'],
  ['hash', 'Name #1'],
]) {
  try {
    await handleSubmit({
      request: post({ flow:'new', pillar:'For Everyone', section:'Book Summaries',
        content:'-   [X](https://x.example) — desc', handle }),
      config, gh,
    });
    fail++; console.log(`  FAIL  handle with ${name} accepted (accepted!)`);
  } catch (e) {
    ok(`handle with ${name} rejected before reaching the PR`, e.name === 'PatchError', `-> ${e.message}`);
  }
}
calls.length = 0;
await handleSubmit({
  request: post({ flow:'new', pillar:'For Everyone', section:'Book Summaries',
    content:'-   [Safe Test](https://x.example) — desc', handle: "O'Brien-Smith Jr." }),
  config, gh,
});
ok('realistic punctuation handle accepted', res !== null);
ok('PR body markdown table stays intact',
  calls[2].body.split('\n').filter(l => l.startsWith('|')).every(l => l.split('|').length === 4),
  'a table row lost a cell');
ok('handle appears once, unescaped-safe', calls[2].body.includes("O'Brien-Smith Jr."));

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
