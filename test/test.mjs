/**
 * Exercises the patch + token logic against the real README.
 * Run: bun run /tmp/opencode/test.mjs
 */
import {
  sectionOptions, applyNew, applyEdit, sanitizeContent, sanitizeHandle,
  assertStructureIntact, parseStructure, normalizeHeading, PatchError,
} from '../src/readme.js';
import { signToken, verifyToken } from '../src/tokens.js';

const README = await (await fetch(
  'https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/README.md'
)).text();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const expectThrow = (name, fn, re) => {
  try { fn(); fail++; console.log(`  FAIL  ${name} (no error thrown)`); }
  catch (e) {
    if (e instanceof PatchError && (!re || re.test(e.message))) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name} -> ${e.constructor.name}: ${e.message}`); }
  }
};
const sec = (t) => console.log(`\n== ${t} ==`);

/* ---------------- structure ---------------- */
sec('structure');
const opts = sectionOptions(README);
ok('4 pillars found', opts.length === 4, `got ${opts.length}: ${opts.map(o=>o.pillar)}`);
// normalizeHeading folds punctuation to spaces, so "Don't" arrives as "don t".
ok('pillars are the expected four',
  ['going to study','going to work','know yet','for everyone']
    .every((k,i) => normalizeHeading(opts[i].pillar).includes(k)),
  opts.map(o=>o.pillar).join(' | '));
ok('non-pillar ## headings excluded from targets',
  !opts.some(g => /contributing|community|where are you/i.test(g.pillar)),
  opts.map(o=>o.pillar).join(' | '));
expectThrow('"Contributing" is not a valid target',
  () => applyNew(README, { pillar:'Contributing', section:'x', content:'- a' }),
  /Could not find a section called/);
const total = opts.reduce((n,g)=>n+g.sections.length,0);
ok('sections discovered', total > 15, `got ${total}`);

/* ---------------- new: fill a coming-soon placeholder ---------------- */
sec('new → fills a "coming soon" placeholder');
{
  const r = applyNew(README, {
    pillar: "I'm Going to Study", section: 'Paying for It',
    content: '-   [Commerce Bursaries](https://example.co.za/commerce) — Money for commerce students',
  });
  ok('returned the section name', r.sectionName === 'Paying for It');
  ok('reported placeholder fill', r.filledPlaceholder === true);
  ok('placeholder line replaced', r.markdown.includes('[Commerce Bursaries](https://example.co.za/commerce)'));
  ok('old "Commerce Bursaries — _coming soon_" gone',
    !r.markdown.includes('Commerce Bursaries — _coming soon_'));
  ok('structure intact', (()=>{try{assertStructureIntact(README,r.markdown);return true}catch{return false}})());
  const after = parseStructure(r.markdown).pillars;
  ok('still 4 pillars after patch', after.length === 4, `got ${after.length}`);
}

/* ---------------- new: append to a section with no placeholder ---------------- */
sec('new → appends to a populated section with no placeholder');
{
  // "Before You Apply" has three live links and no "_coming soon_" slot.
  const r = applyNew(README, {
    pillar: "I'm Going to Study", section: 'Before You Apply',
    content: '-   [University Comparison](https://example.co.za/compare) — Compare SA universities side by side',
  });
  ok('no placeholder reported', !r.filledPlaceholder);
  ok('line added', r.markdown.includes('[University Comparison](https://example.co.za/compare)'));
  const m = README.split('\n').length, n = r.markdown.split('\n').length;
  ok('exactly one line added', n === m + 1, `${m} -> ${n}`);
  const lines = r.markdown.split('\n');
  const i = lines.findIndex(l => l.includes('[University Comparison]'));
  const before = lines.findIndex(l => /^###\s+Before You Apply/.test(l));
  const paying = lines.findIndex(l => /^###\s+Paying for It/.test(l));
  ok('lands inside "Before You Apply"', i > before && i < paying,
     `idx=${i} before=${before} paying=${paying}`);
  ok('inserted after the last existing bullet, not at the heading',
     lines[i-1].trim().startsWith('-'), `prev line: ${JSON.stringify(lines[i-1])}`);
}

sec('new → fills a placeholder further down the same section');
{
  // "Finding Work" starts with two live links then three "_coming soon_" slots.
  const r = applyNew(README, {
    pillar: "I'm Going to Work", section: 'Finding Work',
    content: '-   [PNet](https://www.pnet.co.za) — SA job portal, mostly entry-level',
  });
  ok('reported placeholder fill', r.filledPlaceholder === true);
  ok('line replaced the first placeholder, not appended',
     r.markdown.split('\n').length === README.split('\n').length);
  ok('old placeholder gone', !r.markdown.includes('Learnerships — _coming soon_'));
  ok('later placeholders untouched', r.markdown.includes('Job Portals — _coming soon_'));
  const lines = r.markdown.split('\n');
  const i = lines.findIndex(l => l.includes('[PNet]'));
  const finding = lines.findIndex(l => /^###\s+Finding Work/.test(l));
  const starting = lines.findIndex(l => /^###\s+Starting Something/.test(l));
  ok('lands inside "Finding Work"', i > finding && i < starting);
}

/* ---------------- new: create a section ---------------- */
sec('new → creates a new ### section');
{
  const r = applyNew(README, {
    pillar: "I'm Going to Work", section: 'new',
    newSectionName: 'Learnerships and SETAs', content: '-   [SETA portal](https://example.co.za) — Find your SETA',
  });
  ok('reports createdSection', r.createdSection === true);
  ok('heading created', r.markdown.includes('### Learnerships and SETAs'));
  const { pillars } = parseStructure(r.markdown);
  const work = pillars.find(p => p.name.includes('Going to Work'));
  ok('sits under the right pillar', work.sections.some(s => s.name === 'Learnerships and SETAs'));
  ok('4 pillars unchanged', pillars.length === 4);
  const secs = work.sections.map(s=>s.name);
  ok('no other section disturbed', JSON.stringify(secs) ===
     JSON.stringify(parseStructure(README).pillars.find(p=>p.name.includes('Going to Work')).sections.map(s=>s.name).concat(['Learnerships and SETAs'])),
     secs.join(' | '));
  expectThrow('duplicate section name rejected',
    () => applyNew(README, { pillar: "I'm Going to Work", section:'new', newSectionName:'Finding Work', content:'- x' }),
    /already has a section/);
}

/* ---------------- edit ---------------- */
sec('edit → exact match');
{
  const r = applyEdit(README, {
    pillar: "I'm Going to Study", section: 'Before You Apply',
    original: '-   [NBT (National Benchmark Tests)](https://www.nbt.ac.za/) — Tests that assess whether you\'re ready for university/higher education. Most universities require these alongside your matric results.',
    replacement: '-   [NBT (National Benchmark Tests)](https://www.nbt.ac.za/) — Updated wording from a contributor.',
  });
  ok('replacement landed', r.markdown.includes('Updated wording from a contributor.'));
  ok('original gone', !r.markdown.includes("Most universities require these alongside your matric results."));
}

/* ---------------- edit: sloppy whitespace ---------------- */
sec('edit → tolerates sloppy whitespace (pasted from the rendered site)');
{
  const r = applyEdit(README, {
    pillar: 'For Everyone', section: 'Book Summaries',
    original: '- [Deep Work](https://youtu.be/xJYlhhT7hyE?si=fsBDrQVuDIv3R8lz)',
    replacement: '-   [Deep Work](https://youtu.be/xJYlhhT7hyE?si=fsBDrQVuDIv3R8lz) — by Cal Newport',
  });
  ok('matched despite - vs -   and missing trailing text', r.markdown.includes('by Cal Newport'));
  ok('exactly one occurrence', (r.markdown.match(/by Cal Newport/g) || []).length === 1);
}

/* ---------------- edit: error paths ---------------- */
sec('edit → error paths');
{
  expectThrow('text not present is rejected',
    () => applyEdit(README, { pillar:'For Everyone', section:'Book Summaries',
      original:'-   [Nonexistent Thing](https://nope.example)', replacement:'- x' }),
    /Could not find that text/);

  const ambiguous = applyNew(README, {
    pillar: 'For Everyone', section: 'TED Talks & Speeches',
    content: '-   [A talk](https://x.example) — desc',
  });
  expectThrow('no-op change rejected',
    () => applyEdit(README, { pillar:'For Everyone', section:'TED Talks & Speeches',
      original:'-   [A talk](https://x.example) — desc', replacement:'-   [A talk](https://x.example) — desc' }),
    /identical to the original/);

  expectThrow('unknown section rejected',
    () => applyEdit(README, { pillar:'Nope', section:'Whatever', original:'- a', replacement:'- b' }),
    /Could not find a section called/);

  // duplicate identical text -> must refuse rather than guess
  const dup = parseStructure(README);
  const study = dup.pillars.find(p=>p.name.includes('Study'));
  const before = study.sections.find(s=>s.name==='Before You Apply');
  const after = study.sections.find(s=>s.name==='Paying for It');
  expectThrow('wrong pillar for a section is rejected',
    () => applyEdit(README, { pillar:"I'm Going to Work", section:'Before You Apply',
      original:'-   [NBT (National Benchmark Tests)](https://www.nbt.ac.za/)', replacement:'- x' }),
    /Could not find "Before You Apply"/);
}

/* ---------------- sanitising ---------------- */
sec('sanitising');
{
  expectThrow('heading injection blocked', () => sanitizeContent('## Evil Section'), /heading/i);
  expectThrow('### heading blocked', () => sanitizeContent('### Sneaky'), /heading/i);
  expectThrow('thematic break blocked', () => sanitizeContent('- a\n---\n- b'), /divider/);
  expectThrow('html comment blocked mid-line', () => sanitizeContent('- a <!-- x -->'), /HTML comment/);
  expectThrow('empty rejected', () => sanitizeContent('   '), /Please add/);
  expectThrow('over-length rejected', () => sanitizeContent('x'.repeat(4001)), /too long/);
  ok('trailing whitespace trimmed', sanitizeContent('- a   \n- b  ') === '- a\n- b');
  ok('3+ blank lines collapsed', sanitizeContent('- a\n\n\n\n\n- b') === '- a\n\n- b');
  expectThrow('handle with email rejected', () => sanitizeHandle('me@example.com'), /email address/);
  expectThrow('handle with phone number rejected', () => sanitizeHandle('Thandi 0821234567'), /phone number/);
  ok('bare @handle still allowed', sanitizeHandle('@thandi') === '@thandi');
  ok('plain handle allowed', sanitizeHandle('Thandi M.') === 'Thandi M.');
  ok('empty handle allowed', sanitizeHandle('') === '');
}

/* ---------------- structure guard ---------------- */
sec('structure guard');
{
  expectThrow('pillar rewrite rejected',
    () => assertStructureIntact(README, README.replace('## 🎓 I\'m Going to Study','## Something Else')),
    /site structure/);
  ok('legit patch passes', (()=>{try{
    assertStructureIntact(README, applyNew(README,{pillar:'For Everyone',section:'Book Summaries',content:'-   [New](https://x.example) — d'}).markdown);
    return true;}catch{return false}})());
}

/* ---------------- HMAC tokens ---------------- */
sec('HMAC tokens');
{
  const SECRET = 'test-secret-abc123';
  const tok = await signToken(SECRET, { pr: 42, action: 'approve', ttlHours: 1 });
  ok('token is url-safe', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tok), tok);

  const v = await verifyToken(SECRET, tok);
  ok('verifies with right secret', v.ok && v.payload.p === 42 && v.payload.a === 'approve');

  const bad = await verifyToken('wrong-secret', tok);
  ok('rejects wrong secret', !bad.ok && /Signature does not match/.test(bad.error));

  const tampered = tok.slice(0, -3) + 'AAA';
  ok('rejects tampered signature', !(await verifyToken(SECRET, tampered)).ok);

  const [body, sig] = tok.split('.');
  const flipped = JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/')));
  flipped.p = 999;
  const forged = btoa(JSON.stringify(flipped)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'') + '.' + sig;
  ok('rejects payload swap', !(await verifyToken(SECRET, forged)).ok);

  const expired = await signToken(SECRET, { pr: 1, action: 'reject', ttlHours: -1 });
  const ev = await verifyToken(SECRET, expired);
  ok('rejects expired', !ev.ok && /expired/i.test(ev.error), ev.error);

  ok('rejects garbage', !(await verifyToken(SECRET, 'not-a-token')).ok);
  ok('rejects empty', !(await verifyToken(SECRET, '')).ok);

  const r1 = await signToken(SECRET, { pr: 7, action:'approve', ttlHours:1 });
  const r2 = await signToken(SECRET, { pr: 7, action:'approve', ttlHours:1 });
  ok('deterministic for same payload (stable digest links)', r1 === r2);
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
