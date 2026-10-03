/**
 * Entry metadata ({closes: …; tags: …}) — the shared parser, the site's real
 * parseReadme/mergeParsed (loaded from PUBLISH/script.js), and the form's
 * validation. No network and no dependencies.
 *
 * Run: node test/test-entry-meta.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { splitEntryMeta, isHidden, isValidDate, todayInSA, daysBetween } from '../PUBLISH/entry-meta.js';
import { applyNew, applyEdit, normalizeMarkdown, PatchError } from '../src/readme.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
const sec = (t) => console.log(`\n== ${t} ==`);
const throws = (name, fn, re) => {
  try { fn(); fail++; console.log(`  FAIL  ${name} (did not throw)`); }
  catch (e) { ok(name, e instanceof PatchError && (!re || re.test(e.message)), e.message); }
};

sec('splitEntryMeta');
const L = '[Funza](https://f.org) — Teaching bursary.';
eq('no block → text unchanged, meta null', splitEntryMeta(L), { text: L, meta: null, errors: [] });
eq('full block', splitEntryMeta(`${L} {closes: 2026-11-30; updated: 2026-10-03; tags: Bursary, deadline; source: zabursaries.co.za}`),
  { text: L, meta: { closes: '2026-11-30', updated: '2026-10-03', tags: ['bursary', 'deadline'], source: 'zabursaries.co.za' }, errors: [] });
eq('source may contain a colon', splitEntryMeta(`${L} {source: https://x.org/a}`).meta, { source: 'https://x.org/a' });
eq('duplicate tags collapse', splitEntryMeta(`${L} {tags: a, a, b}`).meta, { tags: ['a', 'b'] });
eq('trailing braces that are not metadata stay in the text',
  splitEntryMeta('[A](https://a.org) — uses {curly} words').text, '[A](https://a.org) — uses {curly} words');
eq('braces mid-line are not metadata', splitEntryMeta('[A](https://a.org) — {closes: 2026-11-30} then more').meta, null);
ok('impossible date rejected', splitEntryMeta(`${L} {closes: 2026-02-30}`).errors.length === 1);
ok('wrong date format rejected', splitEntryMeta(`${L} {closes: 30/11/2026}`).errors.length === 1);
ok('unknown field rejected', /Unknown field "deadline"/.test(splitEntryMeta(`${L} {deadline: 2026-11-30}`).errors[0]));
ok('duplicate field rejected', splitEntryMeta(`${L} {closes: 2026-11-30; closes: 2026-12-01}`).errors.length === 1);
ok('bad tag rejected', splitEntryMeta(`${L} {tags: Not A Tag!}`).errors.length === 1);
ok('too many tags rejected', splitEntryMeta(`${L} {tags: a,b,c,d,e,f,g,h,i}`).errors.length === 1);
ok('isValidDate accepts a leap day', isValidDate('2028-02-29'));
ok('isValidDate rejects 2027-02-29', !isValidDate('2027-02-29'));

sec('dates and expiry');
eq('todayInSA rolls over at 22:00 UTC', todayInSA(new Date('2026-10-03T22:30:00Z')), '2026-10-04');
eq('todayInSA before rollover', todayInSA(new Date('2026-10-03T21:30:00Z')), '2026-10-03');
eq('daysBetween', daysBetween('2026-10-03', '2026-10-13'), 10);
eq('daysBetween across a month end', daysBetween('2026-10-30', '2026-11-02'), 3);
const hid = (line, today = '2026-11-30') => isHidden(splitEntryMeta(line), today);
ok('visible on the closing day', !hid('[A](https://a.org) — x {closes: 2026-11-30}'));
ok('hidden the day after', hid('[A](https://a.org) — x {closes: 2026-11-29}'));
ok('no closes → never hidden', !hid('[A](https://a.org) — x {tags: evergreen}', '2099-01-01'));
ok('no block → never hidden', !hid('[A](https://a.org) — x', '2099-01-01'));
ok('unreadable closes fails closed (hidden)', hid('[A](https://a.org) — x {closes: soon}'));
ok('a bad tag alone does not hide the entry', !hid('[A](https://a.org) — x {tags: BAD TAG}'));

sec('the site parser (PUBLISH/script.js)');
const src = readFileSync(new URL('../PUBLISH/script.js', import.meta.url), 'utf8');
const ctx = {
  console, EntryMeta: globalThis.EntryMeta,
  location: { hostname: 'example.org' },
  document: { addEventListener() {}, getElementById: () => null },
};
vm.createContext(ctx);
vm.runInContext(src + '\nthis.parseReadme = parseReadme; this.mergeParsed = mergeParsed;', ctx);
const warn = console.warn; console.warn = () => {};

const README = `# T

## 🎓 I'm Going to Study

### Paying for It

-   [NSFAS](https://my.nsfas.org.za/) — Financial aid.
-   Commerce Bursaries — _coming soon_

## 💼 I'm Going to Work

### Jobs

-   [Jobs](https://jobs.org) — Listings.
`;
const OPPS = `# O

## Format

-   [Not a real entry](https://x.org) — prose under a non-pillar heading is ignored.

## 🎓 I'm Going to Study

### Paying for It

-   [Open](https://o.org) — Still open. {closes: 2026-11-30; tags: bursary}
-   [Gone](https://g.org) — Expired. {closes: 2026-11-29}
-   [Broken](https://b.org) — Bad date. {closes: 30/11/2026}

### Brand New

-   [Fresh](https://n.org) — New section.

## 💼 I'm Going to Work
`;
const base = ctx.parseReadme(README, '2026-11-30');
eq('README entries are unchanged by the metadata work',
  base.pillars.study['Paying for It'].map((r) => [r.name, r.url, r.desc, r.meta ?? null]),
  [['NSFAS', 'https://my.nsfas.org.za/', 'Financial aid.', null], ['Commerce Bursaries', null, 'Coming soon', null]]);

const extra = ctx.parseReadme(OPPS, '2026-11-30');
eq('expired and unreadable-date entries are dropped, open one kept',
  extra.pillars.study['Paying for It'].map((r) => r.name), ['Open']);
eq('meta is attached and stripped from the description',
  extra.pillars.study['Paying for It'][0], { name: 'Open', url: 'https://o.org', desc: 'Still open.', meta: { closes: '2026-11-30', tags: ['bursary'] } });
ok('prose under a non-pillar heading is ignored', !JSON.stringify(extra).includes('Not a real entry'));

ctx.mergeParsed(base, extra);
eq('same-named section: time-sensitive entries come first',
  base.pillars.study['Paying for It'].map((r) => r.name), ['Open', 'NSFAS', 'Commerce Bursaries']);
eq('new section goes at the start of the pillar', base.pillarOrder.study, ['Brand New', 'Paying for It']);
eq('untouched pillar is unchanged', base.pillarOrder.work, ['Jobs']);
console.warn = warn;

sec('submission validation (src/readme.js)');
const MD = `## 🎓 I'm Going to Study\n\n### Paying for It\n\n-   [NSFAS](https://my.nsfas.org.za/) — Financial aid.\n`;
const good = applyNew(MD, { pillar: "I'm Going to Study", section: 'Paying for It', content: '[Funza](https://f.org) — Teaching bursary. {closes: 2026-11-30; tags: bursary}' });
ok('a valid block is written to the README untouched', good.markdown.includes('{closes: 2026-11-30; tags: bursary}'));
throws('a bad date is rejected with the example', () =>
  applyNew(MD, { pillar: "I'm Going to Study", section: 'Paying for It', content: '[F](https://f.org) — x {closes: 30/11/2026}' }), /YYYY-MM-DD[\s\S]*Example/);
throws('an unknown field is rejected', () =>
  applyNew(MD, { pillar: "I'm Going to Study", section: 'Paying for It', content: '[F](https://f.org) — x {deadline: 2026-11-30}' }), /Unknown field/);
throws('a bad block in a correction is rejected', () =>
  applyEdit(MD, { pillar: "I'm Going to Study", section: 'Paying for It',
    original: '-   [NSFAS](https://my.nsfas.org.za/) — Financial aid.', replacement: '[NSFAS](https://my.nsfas.org.za/) — Aid. {closes: never}' }), /not valid/);
eq('normalizeMarkdown leaves the block intact',
  normalizeMarkdown('- [A](https://a.org) - x {closes: 2026-11-30; tags: a, b}'), '-   [A](https://a.org) — x {closes: 2026-11-30; tags: a, b}');

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
