/**
 * Markdown normalisation — the step that makes hand-written markdown and
 * rich-text-converted markdown land in the README identically.
 * No network and no dependencies.
 *
 * Run: node test/test-normalize.mjs
 */
import { normalizeMarkdown, applyNew, applyEdit, PatchError } from '../src/readme.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const eq = (name, got, want) => ok(name, got === want, `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
const sec = (t) => console.log(`\n== ${t} ==`);

const LINE = '-   [Learnerships](https://example.org/l) — Free learnership databases';

sec('bullet style');
eq('already canonical is untouched', normalizeMarkdown(LINE, { bulletize: true }), LINE);
eq('single-space dash bullet gets the README spacing',
  normalizeMarkdown('- [Learnerships](https://example.org/l) — Free learnership databases'), LINE);
eq('* bullet becomes -', normalizeMarkdown('* [Learnerships](https://example.org/l) — Free learnership databases'), LINE);
eq('+ bullet becomes -', normalizeMarkdown('+ [Learnerships](https://example.org/l) — Free learnership databases'), LINE);
eq('numbered list becomes bullets',
  normalizeMarkdown('1. [A](https://a.org) — one\n2. [B](https://b.org) — two'),
  '-   [A](https://a.org) — one\n-   [B](https://b.org) — two');
eq('bold at line start is not mistaken for a bullet', normalizeMarkdown('**Note** — careful'), '**Note** — careful');
eq('italic at line start is not mistaken for a bullet', normalizeMarkdown('*Note* careful'), '*Note* careful');

sec('bulletize (new resources)');
eq('bare line becomes a bullet',
  normalizeMarkdown('[Learnerships](https://example.org/l) — Free learnership databases', { bulletize: true }), LINE);
eq('bare paragraphs become one contiguous list',
  normalizeMarkdown('[A](https://a.org) — one\n\n[B](https://b.org) — two', { bulletize: true }),
  '-   [A](https://a.org) — one\n-   [B](https://b.org) — two');
eq('blockquote marker is dropped', normalizeMarkdown('> [A](https://a.org) — one', { bulletize: true }), '-   [A](https://a.org) — one');
eq('without bulletize a bare line stays bare',
  normalizeMarkdown('[A](https://a.org) — one'), '[A](https://a.org) — one');

sec('the dash the site parser needs');
eq('hyphen after a link becomes an em dash',
  normalizeMarkdown('-   [A](https://a.org) - free stuff'), '-   [A](https://a.org) — free stuff');
eq('double hyphen becomes an em dash',
  normalizeMarkdown('[A](https://a.org) -- free stuff', { bulletize: true }), '-   [A](https://a.org) — free stuff');
eq('en dash becomes an em dash',
  normalizeMarkdown('[A](https://a.org) – free stuff', { bulletize: true }), '-   [A](https://a.org) — free stuff');
eq('hyphens inside the description are left alone',
  normalizeMarkdown('[A](https://a.org) — free, step-by-step - really', { bulletize: true }),
  '-   [A](https://a.org) — free, step-by-step - really');
eq('hyphenated link text is left alone',
  normalizeMarkdown('[Co-op](https://a.org) — x', { bulletize: true }), '-   [Co-op](https://a.org) — x');

sec('hygiene');
eq('CRLF and trailing spaces', normalizeMarkdown('[A](https://a.org) — one   \r\n', { bulletize: true }), '-   [A](https://a.org) — one');
eq('empty input', normalizeMarkdown('   '), '');
eq('idempotent', normalizeMarkdown(normalizeMarkdown('* [A](https://a.org) - x'), { bulletize: true }),
  normalizeMarkdown('* [A](https://a.org) - x'));

sec('end to end through applyNew / applyEdit');
const README = [
  '# Mzantsi Vibes', '',
  '## 🎓 I\'m Going to Study', '',
  '### Before You Apply', '',
  '-   [NBT](https://www.nbt.ac.za/) — Tests', '',
  '### Paying for It', '',
  '-   [NSFAS](https://my.nsfas.org.za/) — Financial aid', '',
].join('\n');

const viaMarkdown = applyNew(README, {
  pillar: "I'm Going to Study", section: 'Before You Apply',
  content: '- [Learnerships](https://example.org/l) - Free learnership databases',
}).markdown;
const viaRichText = applyNew(README, {
  pillar: "I'm Going to Study", section: 'Before You Apply',
  // what Turndown emits for a pasted, un-bulleted line
  content: '[Learnerships](https://example.org/l) — Free learnership databases',
}).markdown;
ok('markdown and rich text give byte-identical READMEs', viaMarkdown === viaRichText);
ok('the new line is in the canonical shape', viaMarkdown.includes('\n' + LINE + '\n'));

const edited = applyEdit(README, {
  pillar: "I'm Going to Study", section: 'Paying for It',
  original: '-   [NSFAS](https://my.nsfas.org.za/) — Financial aid',
  replacement: '[NSFAS](https://my.nsfas.org.za/) - Financial aid for those who need it',
}).markdown;
ok('a correction to a bullet stays a bullet, with the right dash',
  edited.includes('-   [NSFAS](https://my.nsfas.org.za/) — Financial aid for those who need it'));

try {
  applyEdit(README, {
    pillar: "I'm Going to Study", section: 'Paying for It',
    original: '-   [NSFAS](https://my.nsfas.org.za/) — Financial aid',
    replacement: '- [NSFAS](https://my.nsfas.org.za/) — Financial aid',
  });
  fail++; console.log('  FAIL  spacing-only edit should be rejected as no change');
} catch (e) {
  ok('a spacing-only "correction" is rejected as no change', e instanceof PatchError);
}

console.log(`\n==============================================\n  ${pass} passed, ${fail} failed\n==============================================`);
process.exit(fail ? 1 : 0);
