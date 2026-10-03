/**
 * The search index and the search itself: building the index from the two
 * files, the /api/index.json route (cache, upstream failures), and ranking.
 * Fully faked: no network. Run: node test/test-index.mjs
 */
import { readFileSync } from 'node:fs';
import { buildIndex, fetchSources, handleIndex, INDEX_TTL_SECONDS } from '../src/content-index.js';
import { parseReadme } from '../PUBLISH/content-parse.js';
import { search, MAX_RESULTS } from '../PUBLISH/search-core.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
const sec = (t) => console.log(`\n== ${t} ==`);

const TODAY = '2026-11-30';
const README = `# T

## 🎓 I'm Going to Study

### Paying for It

-   [NSFAS](https://my.nsfas.org.za/) — Financial aid for undergraduate students.
-   Commerce Bursaries — _coming soon_

### Before You Apply

-   [NBT](https://www.nbt.ac.za/) — Tests that assess readiness for university.

## 💼 I'm Going to Work

### Jobs

-   [Learnerships](https://l.org) — Free learnership databases. {tags: learnership}

## Contributing

-   [Not content](https://x.org) — after a stop heading.
`;
const OPPS = `# O

## 🎓 I'm Going to Study

### Paying for It

-   [Funza Lushaka](https://f.org) — Teaching bursary. {closes: 2026-12-15; tags: bursary, deadline; source: zabursaries.co.za}
-   [Old Bursary](https://o.org) — Gone. {closes: 2026-11-29; tags: bursary}
-   [Sasol Bursary](https://s.org) — Engineering bursary. {closes: 2026-12-01; tags: bursary, deadline, engineering}
`;

sec('buildIndex');
const idx = buildIndex({ readme: README, opportunities: OPPS }, TODAY, new Date('2026-11-30T10:00:00Z'));
eq('generatedAt is the build time', idx.generatedAt, '2026-11-30T10:00:00.000Z');
eq('names, in display order (time-sensitive first, placeholders and stop-heading items out)',
  idx.entries.map((e) => e.name), ['Funza Lushaka', 'Sasol Bursary', 'NSFAS', 'NBT', 'Learnerships']);
eq('an entry carries its pillar, section and kind',
  [idx.entries[0].pillar, idx.entries[0].section, idx.entries[0].kind, idx.entries[2].kind], ['study', 'Paying for It', 'current', 'evergreen']);
eq('metadata is flattened onto the entry', [idx.entries[0].closes, idx.entries[0].tags, idx.entries[0].source], ['2026-12-15', ['bursary', 'deadline'], 'zabursaries.co.za']);
ok('an entry without metadata has no metadata keys', !('closes' in idx.entries[2]) && !('tags' in idx.entries[2]));
ok('the expired entry is dropped', !idx.entries.some((e) => e.name === 'Old Bursary'));
eq('tags are counted, most used first', idx.tags, [
  { tag: 'bursary', count: 2 }, { tag: 'deadline', count: 2 }, { tag: 'engineering', count: 1 }, { tag: 'learnership', count: 1 }]);
eq('no opportunities file → README only', buildIndex({ readme: README }, TODAY).entries.map((e) => e.name), ['NSFAS', 'NBT', 'Learnerships']);

sec('the index matches what the site renders');
const real = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const parsed = parseReadme(real, TODAY);
const shown = [];
for (const p of ['study', 'work', 'unsure', 'everyone']) for (const s of parsed.pillarOrder[p]) for (const e of parsed.pillars[p][s]) if (e.url) shown.push(`${p}|${s}|${e.name}|${e.url}`);
const indexed = buildIndex({ readme: real }, TODAY).entries.map((e) => `${e.pillar}|${e.section}|${e.name}|${e.url}`);
ok('the real README has linked entries to compare', shown.length > 20, String(shown.length));
eq('every rendered link is indexed, in the same order', indexed, shown);

sec('fetchSources and the route');
const files = { 'README.md': README, 'OPPORTUNITIES.md': OPPS };
const fakeFetch = (overrides = {}, log = []) => async (url) => {
  log.push(url);
  const file = url.split('/main/')[1];
  const o = overrides[file];
  if (o) return new Response(o.body ?? '', { status: o.status });
  return new Response(files[file], { status: 200 });
};
const log = [];
const src = await fetchSources({ owner: 'o', repo: 'r' }, fakeFetch({}, log));
ok('reads both public raw files from main, no auth', log.length === 2 && log.every((u) => u.startsWith('https://raw.githubusercontent.com/o/r/main/')));
eq('returns both texts', [src.readme === README, src.opportunities === OPPS], [true, true]);
eq('a missing opportunities file is fine', (await fetchSources({ owner: 'o', repo: 'r' }, fakeFetch({ 'OPPORTUNITIES.md': { status: 404 } }))).opportunities, '');
try { await fetchSources({ owner: 'o', repo: 'r' }, fakeFetch({ 'README.md': { status: 500 } })); fail++; console.log('  FAIL  README failure should throw'); }
catch { ok('a README failure throws', true); }
try { await fetchSources({ owner: 'o', repo: 'r' }, fakeFetch({ 'OPPORTUNITIES.md': { status: 503 } })); fail++; console.log('  FAIL  opportunities 503 should throw'); }
catch { ok('an opportunities failure other than 404 throws (never serve a half index)', true); }

const memCache = () => { const m = new Map(); return { match: async (k) => m.get(k.url)?.clone(), put: async (k, r) => { m.set(k.url, r); }, size: () => m.size }; };
const ctx = { waitUntil: (p) => p };
const req = (method = 'GET') => new Request('https://mzantsivibes.co.za/api/index.json', { method });
const cache = memCache(); const calls = [];
const r1 = await handleIndex(req(), {}, ctx, { cache, fetchFn: fakeFetch({}, calls) });
const j1 = await r1.json();
ok('200 with the index', r1.status === 200 && j1.ok === true && j1.entries.length >= 5);
ok('cacheable for five minutes', r1.headers.get('Cache-Control') === `public, max-age=${INDEX_TTL_SECONDS}` && INDEX_TTL_SECONDS === 300);
const before = calls.length;
const r2 = await handleIndex(req(), {}, ctx, { cache, fetchFn: fakeFetch({}, calls) });
ok('a second request is served from cache without touching GitHub', calls.length === before && (await r2.json()).ok === true);
const rBad = await handleIndex(req(), {}, ctx, { cache: memCache(), fetchFn: fakeFetch({ 'README.md': { status: 500 } }) });
ok('GitHub down → 502 JSON error, not cached', rBad.status === 502 && (await rBad.json()).ok === false);
const rPost = await handleIndex(req('POST'), {}, ctx, { cache: memCache(), fetchFn: fakeFetch() });
ok('POST → 405', rPost.status === 405);
const ghEnv = []; await handleIndex(req(), { REPO_OWNER: 'acme', REPO_NAME: 'guide' }, ctx, { cache: memCache(), fetchFn: fakeFetch({}, ghEnv) });
ok('repo comes from REPO_OWNER / REPO_NAME', ghEnv[0].includes('/acme/guide/main/'));
const rNoSecrets = await handleIndex(req(), {}, ctx, { cache: null, fetchFn: fakeFetch() });
ok('needs no secrets and works with no cache available', rNoSecrets.status === 200);

sec('search');
const E = idx.entries;
const names = (o) => search(E, o, TODAY).map((e) => e.name);
eq('no query, no filter → everything, time-sensitive first, soonest deadline first', names({}), ['Sasol Bursary', 'Funza Lushaka', 'NSFAS', 'NBT', 'Learnerships']);
eq('a word in the name beats a word only in the description',
  search([{ name: 'Other', desc: 'a grant', pillar: 'study', section: 'S', kind: 'evergreen' }, { name: 'Grant Hub', desc: '', pillar: 'study', section: 'S', kind: 'evergreen' }], { query: 'grant' }, TODAY).map((e) => e.name), ['Grant Hub', 'Other']);
eq('"bursary" finds the bursaries (name or description)', new Set(names({ query: 'bursary' })), new Set(['Sasol Bursary', 'Funza Lushaka']));
eq('prefix of a name ranks first', names({ query: 'nsf' })[0], 'NSFAS');
eq('every word must match', names({ query: 'teaching bursary' }), ['Funza Lushaka']);
eq('a missing word excludes the entry', names({ query: 'teaching engineering' }), []);
eq('case and accents are ignored', names({ query: 'NSFÁS' }), ['NSFAS']);
eq('description text is searchable', names({ query: 'readiness' }), ['NBT']);
eq('source is searchable', names({ query: 'zabursaries' }), ['Funza Lushaka']);
eq('tag filter', names({ tags: ['engineering'] }), ['Sasol Bursary']);
eq('several tags must all match', names({ tags: ['bursary', 'engineering'] }), ['Sasol Bursary']);
eq('pillar filter', names({ pillar: 'work' }), ['Learnerships']);
eq('query + pillar + tag combine', names({ query: 'bursary', pillar: 'study', tags: ['deadline'] }).length, 2);
eq('an expired entry is never returned, even from an old index', search(E, {}, '2026-12-02').map((e) => e.name), ['Funza Lushaka', 'NSFAS', 'NBT', 'Learnerships']);
eq('the closing day is still visible', search(E, { query: 'sasol' }, '2026-12-01').length, 1);
eq('punctuation-only query matches nothing', names({ query: '???' }), []);
const many = Array.from({ length: 200 }, (_, i) => ({ name: `Thing ${i}`, url: 'https://x.org', desc: '', pillar: 'study', section: 'S', kind: 'evergreen' }));
eq('results are capped', search(many, { query: 'thing' }, TODAY).length, MAX_RESULTS);

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
