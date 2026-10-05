/**
 * Fixes from the 2026-10-05 audit: unsafe links, PR-body injection, bad input
 * types, the review-queue cap, GitHub paging, caching and the config that
 * decides which requests run the Worker. No network, nothing sent.
 *
 * Run: node test/test-hardening.mjs
 */
import fs from 'node:fs';
import { handleSubmit } from '../src/submit.js';
import { applyNew, sanitizeHandle, PatchError } from '../src/readme.js';
import { parseReadme } from '../PUBLISH/content-parse.js';
import { github } from '../src/github.js';
import { handleSections } from '../src/worker.js';
import { handleIndex } from '../src/content-index.js';
import { CRON_OPPS } from '../src/config.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sec = (t) => console.log(`\n== ${t} ==`);
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const md = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const PILLAR = "I'm Going to Study";
const SECTION = Object.keys(parseReadme(md).pillars.study)[0];
const GOOD = '[Example](https://example.org) — a fine resource';

const config = { owner: 'o', repo: 'r', branchPrefix: 'contribute', maxOpenContributions: 3 };
const ours = (n) => ({ number: n, user: { type: 'Bot' }, head: { ref: `contribute/x-${n}`, repo: { full_name: 'o/r' } } });
function fakeGh(open = []) {
  const calls = [];
  return {
    calls,
    getReadme: async () => ({ content: md, sha: 's' }),
    getDefaultBranchSha: async () => 'base',
    listOpenPulls: async () => open,
    createBranch: async () => calls.push('branch'),
    commitReadme: async (o, r, b, p) => calls.push('commit'),
    createPullRequest: async (o, r, p) => { calls.push('pr'); calls.pr = p; return { number: 9, html_url: 'u' }; },
    ensureLabel: async () => {}, addLabels: async () => {},
  };
}
const submit = (body, gh = fakeGh()) => handleSubmit({ request: { json: async () => body }, config, gh });
const base = { pillar: PILLAR, section: SECTION, content: GOOD };

sec('links: only http(s) reach the README or the page');
for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', ' javascript:x']) {
  const e = await rejects(() => applyNew(md, { pillar: PILLAR, section: SECTION, content: `[x](${bad}) — y` }));
  ok(`form rejects ${bad}`, e instanceof PatchError && /http/.test(e.message), String(e?.message));
}
ok('a normal https link is accepted', !(await rejects(() => applyNew(md, { pillar: PILLAR, section: SECTION, content: GOOD }))));
const page = parseReadme(`## 🎓 I'm Going to Study\n### X\n-   [Evil](javascript:alert(1)) — d\n-   [Ok](https://a.org) — d\n`);
ok('the parser drops a javascript: entry even if it is already in the README', page.pillars.study.X.length === 1 && page.pillars.study.X[0].name === 'Ok');
const wiki = parseReadme(`## 🎓 I'm Going to Study\n### X\n-   [Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) — about foo\n`).pillars.study.X[0];
ok('a URL with parentheses keeps them', wiki.url === 'https://en.wikipedia.org/wiki/Foo_(bar)' && wiki.name === 'Wiki' && wiki.desc === 'about foo', JSON.stringify(wiki));
const ordinary = parseReadme(`## 🎓 I'm Going to Study\n### X\n-   [A](https://a.org). — d\n`).pillars.study.X[0];
ok('a trailing full stop is still trimmed', ordinary.url === 'https://a.org', ordinary.url);

sec('raw HTML is refused');
for (const bad of ['<script>x</script>', '<img src=x onerror=alert(1)>', '</div>', '<!-- hi -->']) {
  const e = await rejects(() => applyNew(md, { pillar: PILLAR, section: SECTION, content: `[a](https://a.org) — ${bad}` }));
  ok(`rejects ${bad}`, e instanceof PatchError, String(e?.message));
}
ok('a less-than sign in plain text is fine', !(await rejects(() => applyNew(md, { pillar: PILLAR, section: SECTION, content: '[a](https://a.org) — under <18 or 5 < 6' }))));

sec('new section names');
for (const [name, label] of [['Nice\n## Hijack', 'newline'], ['Nice\r## Hijack', 'carriage return'], ['🔥', 'emoji only'], ['   ', 'blank']]) {
  const e = await rejects(() => applyNew(md, { pillar: PILLAR, section: 'new', newSectionName: name, content: GOOD }));
  ok(`rejects ${label}`, e instanceof PatchError, String(e?.message));
}

sec('wrong types are a 400, not a crash');
for (const [label, body] of [
  ['null body', null], ['array body', []], ['pillar number', { ...base, pillar: 5 }], ['section number', { ...base, section: 5 }],
  ['section array', { ...base, section: ['x'] }], ['content object', { ...base, content: { a: 1 } }],
  ['newSectionName number', { ...base, section: 'new', newSectionName: 5 }], ['handle object', { ...base, handle: { a: 1 } }],
  ['original object', { ...base, flow: 'edit', original: { a: 1 } }],
]) {
  const e = await rejects(() => submit(body));
  ok(`${label} -> PatchError 400`, e instanceof PatchError && e.status === 400, `${e?.constructor?.name} ${e?.status} ${e?.message}`);
}
ok('a handle of the wrong type is a PatchError', (await rejects(() => sanitizeHandle(5))) instanceof PatchError);

sec('the PR body cannot be written into by the submission');
{
  const gh = fakeGh();
  await submit({ ...base, handle: '@torvalds', content: `${GOOD}\n\`\`\`\n**APPROVED** @octocat ![x](https://evil.example/p.png)` }, gh);
  const body = gh.calls.pr.body;
  const fence = /^(`{4,})markdown\n[\s\S]*?\n\1$/m.exec(body.split('Raw submitted content')[1]);
  ok('the content sits inside a longer fence', !!fence && /APPROVED/.test(fence[0]));
  ok('nothing of it lands outside the fence', !body.replace(fence[0], '').includes('APPROVED'));
  ok('the handle is a code span, so @someone pings nobody', /\| `@torvalds` \|/.test(body));
}

sec('the review queue is capped');
{
  const full = fakeGh([ours(1), ours(2), ours(3)]);
  const e = await rejects(() => submit(base, full));
  ok('refused with 503 when the queue is full', e instanceof PatchError && e.status === 503, `${e?.status}`);
  ok('and nothing was written to GitHub', !full.calls.includes('branch') && !full.calls.includes('pr'));
  const mixed = fakeGh([ours(1), ours(2), { number: 5, user: { type: 'User' }, head: { ref: 'feature/a', repo: { full_name: 'o/r' } } }]);
  ok('PRs that are not contributions do not count', !(await rejects(() => submit(base, mixed))) && mixed.calls.includes('pr'));
}

sec('GitHub client');
{
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const u = new URL(url);
    if (u.pathname.endsWith('/pulls')) {
      const page = Number(u.searchParams.get('page'));
      const n = page < 3 ? 100 : 7;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: page * 1000 + i, labels: [] }))));
    }
    if (u.pathname.endsWith('/labels')) return new Response(JSON.stringify([{ name: 'approved' }, { name: 'rejected' }, { name: 'needs-review' }]));
    return new Response('{"merged":true}');
  };
  try {
    const gh = github('tok');
    const all = await gh.listOpenPulls('o', 'r');
    ok('open PRs are paged until a short page', all.length === 207 && seen.filter((s) => /\/pulls\?/.test(s.url)).length === 3, String(all.length));
    seen.length = 0;
    for (const n of ['needs-review', 'approved', 'rejected']) await gh.ensureLabel('o', 'r', n, 'fff', 'd');
    ok('labels are listed once for three ensureLabel calls', seen.length === 1, String(seen.length));
    await gh.mergePull('o', 'r', 4, 'deadbeef');
    ok('merge sends the reviewed sha', JSON.parse(seen.at(-1).init.body).sha === 'deadbeef');
  } finally { globalThis.fetch = realFetch; }
}

sec('caching');
{
  const store = new Map();
  const cache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, v) => void store.set(k.url, v) };
  const ctx = { waitUntil: (p) => p };
  let reads = 0;
  const gh = { getReadme: async () => { reads++; return { content: md }; } };
  const cfg = { baseUrl: 'https://mz.example', owner: 'o', repo: 'r' };
  const first = await handleSections({ config: cfg, gh, ctx, cache });
  await new Promise((r) => setTimeout(r));
  await handleSections({ config: cfg, gh, ctx, cache });
  await handleSections({ config: cfg, gh, ctx, cache });
  ok('/api/sections reads GitHub once for three loads', reads === 1, String(reads));
  ok('and says how long it may be cached', /max-age=300/.test(first.headers.get('Cache-Control')));
  const head = await handleIndex(new Request('https://mz.example/api/index.json', { method: 'HEAD' }), {}, ctx, { cache: null, fetchFn: async () => new Response('x') });
  ok('HEAD on the index is allowed', head.status !== 405, String(head.status));
  ok('the index tells the edge and browsers the same TTL', /s-maxage=300/.test((await handleIndex(new Request('https://mz.example/api/index.json'), {}, ctx, { cache: null, fetchFn: async () => new Response(md) })).headers.get('Cache-Control')));
}

sec('deploy config');
{
  const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  ok('the weekly cron is MON, because Cloudflare counts 1 as Sunday', CRON_OPPS === '0 5 * * MON' && wrangler.includes('"0 5 * * MON"'));
  ok('the Worker only runs first for the API and review links', /"run_worker_first":\s*\["\/api\/\*",\s*"\/action"\]/.test(wrangler));
  const headers = fs.readFileSync(new URL('../PUBLISH/_headers', import.meta.url), 'utf8');
  for (const h of ['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Strict-Transport-Security', 'Content-Security-Policy', 'Referrer-Policy']) ok(`_headers sets ${h.split(':')[0]}`, headers.includes(h));
  ok('no script-src limit yet (pages still use inline onclick)', !/script-src/.test(headers));
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
