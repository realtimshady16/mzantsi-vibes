#!/usr/bin/env node
/**
 * Drive the live contribution system by hand, for testing.
 *
 *   node scripts/trigger.mjs status                       open contribution PRs and where each stands
 *   node scripts/trigger.mjs submit --section "Law" --content "[Site](https://x.co.za) - what it is"
 *   node scripts/trigger.mjs digest [--dry-run]           send the review digest email now
 *   node scripts/trigger.mjs merge  [--dry-run]           run the evening merge/close now
 *   node scripts/trigger.mjs opportunities [--dry-run]    run the opportunity digest now
 *
 * --dry-run reports what a job would do and changes nothing (no email, no merge,
 * no issue). `opportunities` still spends its ~10 Tavily credits either way.
 *
 * status and submit need no secrets. digest / merge / opportunities run on the
 * live Worker, with its real secrets, so they test exactly what the crons do. They
 * need HMAC_SECRET in .dev.vars to match the Worker's, because the command signs a
 * five-minute, single-job token with it. See CONTRIBUTE_SETUP.md.
 *
 * submit options:
 *   --section NAME        the section to add to (the pillar is found for you)
 *   --content TEXT        what to add, in markdown (rich text editors send this too)
 *   --new-section NAME    create a new section instead (needs --pillar)
 *   --pillar NAME         only needed with --new-section, or if a name is ambiguous
 *   --handle NAME         credit line (default: "trigger-script")
 *   --format F            richtext | markdown (only labels the PR; default markdown)
 *   --edit "OLD TEXT"     make it a correction: replace OLD TEXT with --content
 *
 * Global option: --url URL   defaults to BASE_URL in .dev.vars, else https://mzantsivibes.co.za
 */
import { loadEnv } from './env.mjs';
import { signAdminToken } from '../src/tokens.js';

const env = loadEnv();
const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : undefined;

const fail = (msg) => { console.error(msg); process.exit(1); };
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value.`);
  return v;
};

if (!command || flag('--help') || flag('-h')) {
  const doc = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
  console.log(doc.replace(/^#!.*\n/, '').replace(/^\/\*\*?\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(command ? 0 : 1);
}

const BASE = (value('--url') || env.BASE_URL || 'https://mzantsivibes.co.za').replace(/\/+$/, '');
const OWNER = env.REPO_OWNER || 'realtimshady16';
const REPO = env.REPO_NAME || 'mzantsi-vibes';
const PREFIX = env.BRANCH_PREFIX || 'contribute';

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  return { res, data };
}

/* ---------------- status ---------------- */
async function status() {
  const { res, data } = await getJson(`https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=open&per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mzantsi-vibes-trigger' },
  });
  if (!res.ok) fail(`GitHub said ${res.status}: ${data.message || ''}`);

  const ours = data.filter(
    (p) => p.user?.type === 'Bot' && p.head?.repo?.full_name?.toLowerCase() === `${OWNER}/${REPO}`.toLowerCase() && p.head.ref.startsWith(`${PREFIX}/`)
  );
  console.log(`${ours.length} open contribution PR${ours.length === 1 ? '' : 's'} (${data.length - ours.length} other open PR${data.length - ours.length === 1 ? '' : 's'} ignored):\n`);
  for (const p of ours) {
    const labels = p.labels.map((l) => l.name);
    const state = labels.includes('approved') ? 'approved  → merges at 18:00'
      : labels.includes('rejected') ? 'rejected  → closes at 18:00'
      : 'undecided → in the next 08:00 digest';
    console.log(`  #${p.number}  ${state}\n         ${p.title}\n         ${p.html_url}`);
  }
  if (!ours.length) console.log('  (none)');
}

/* ---------------- submit ---------------- */
async function submit() {
  const content = value('--content');
  if (!content) fail('submit needs --content "..." (and --section "..." or --new-section "...").');
  const handle = value('--handle') || 'trigger-script';
  const format = value('--format') === 'richtext' ? 'richtext' : 'markdown';
  const newSection = value('--new-section');
  const wanted = value('--section');
  let pillar = value('--pillar');

  if (!newSection && !wanted) fail('Say where it goes: --section "Before You Apply" (or --new-section "Name" --pillar "...").');

  // Find the pillar the way the form does: from the live section list.
  const { res: sres, data: sdata } = await getJson(`${BASE}/api/sections`);
  if (!sres.ok || !sdata.ok) fail(`Could not load the section list (${sres.status}). Is the Worker up? ${sdata.error || ''}`);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  if (!newSection) {
    const matches = sdata.groups.filter((g) => g.sections.some((s) => norm(s) === norm(wanted)));
    if (!matches.length) fail(`No section called "${wanted}". Sections:\n` + sdata.groups.map((g) => `  ${g.pillar}: ${g.sections.join(', ')}`).join('\n'));
    if (matches.length > 1 && !pillar) fail(`"${wanted}" exists in several places; add --pillar. Options: ${matches.map((g) => g.pillar).join(' | ')}`);
    pillar ||= matches[0].pillar;
  } else if (!pillar) {
    fail(`--new-section needs --pillar. Options:\n` + sdata.groups.map((g) => `  ${g.pillar}`).join('\n'));
  }

  const edit = value('--edit');
  const payload = {
    flow: edit ? 'edit' : 'new',
    format,
    pillar,
    section: newSection ? 'new' : wanted,
    content,
    handle,
    website: '',
    ...(newSection ? { newSectionName: newSection } : {}),
    ...(edit ? { original: edit } : {}),
  };

  const { res, data } = await getJson(`${BASE}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !data.ok) fail(`Rejected (${res.status}): ${data.error || JSON.stringify(data)}`);
  console.log(`Opened PR #${data.prNumber}: ${data.prUrl}`);
}

/* ---------------- jobs on the live Worker ---------------- */
async function runJob(job) {
  if (!env.HMAC_SECRET) {
    fail('HMAC_SECRET is not in .dev.vars. It has to match the Worker\'s HMAC_SECRET (see CONTRIBUTE_SETUP.md, "Testing by hand").');
  }
  const dryRun = flag('--dry-run');
  const token = await signAdminToken(env.HMAC_SECRET, { job, ttlMinutes: 5 });

  console.error(`${dryRun ? 'Dry run of' : 'Running'} "${job}" on ${BASE} …`);
  const { res, data } = await getJson(`${BASE}/api/admin/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ job, dryRun }),
  });

  if (res.status === 401) fail('Unauthorised. HMAC_SECRET in .dev.vars does not match the Worker\'s.');
  if (!res.ok || !data.ok) fail(`The job failed (${res.status}): ${data.error || JSON.stringify(data)}`);

  const { body, ...rest } = data.result || {};
  console.log(JSON.stringify(rest, null, 2));
  if (body) console.log(`\n--- issue body ---\n${body}`);
}

const JOBS = ['digest', 'merge', 'opportunities'];
if (command === 'status') await status();
else if (command === 'submit') await submit();
else if (JOBS.includes(command)) await runJob(command);
else fail(`Unknown command "${command}". Try: status, submit, ${JOBS.join(', ')}  (--help for details)`);
