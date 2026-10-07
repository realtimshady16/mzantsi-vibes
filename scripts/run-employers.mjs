#!/usr/bin/env node
/**
 * Preview the employer pass: search a few companies' own websites for dated bursary,
 * graduate-programme and internship pages, and show the issue and PR it would produce.
 *
 * DRY RUN ONLY. It opens nothing on GitHub. Every company is one Tavily credit.
 *
 *   node scripts/run-employers.mjs --companies ~/leads.csv --only Absa,Eskom --explain
 *   node scripts/run-employers.mjs --companies ~/leads.csv --limit 10
 *   node scripts/run-employers.mjs --companies ~/leads.csv --list     show the plan, spend nothing
 *
 *   --companies FILE   CSV with "Company" and "Company website" columns. Keep it OUT of the repo: it
 *                      is a lead list, not content. Other columns are never read.
 *   --only a,b         these companies. Exact name (any case); a term with no exact match falls back to
 *                      names containing it
 *   --portals FILE     JSON { "Company": ["careers-site.example"] }: extra domains a human has checked are the
 *                      company's own. Keep it OUT of the repo. Aggregators are refused.
 *   --discover         instead of searching for opportunities, suggest portal domains for these companies
 *                      (1 credit each). Prints hosts only; nothing is added until you put it in --portals.
 *   --limit N          at most N companies (default 10, up to 200: this runs on your machine, so the
 *                      Worker's 50-request limit does not apply. The cron will run a slice at a time.)
 *   --out DIR          store the results in DIR (outside the repo): the issue text, the full trace of every
 *                      result with the reason it was kept or dropped, a tally of those reasons and the PR
 *                      preview, in files named employers-<date>-… (implies --explain)
 *   --explain          every result, with KEEP / DROP and the reason
 *   --save FILE        also write the issue text to FILE
 *
 * Reads TAVILY_API_KEY from .dev.vars or the environment.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { searchLabel, searchTavily, hostOf, sastDate } from '../src/opportunities.js';
import { runWeeklyOpportunities } from '../src/opportunity-pr.js';
import { parseCompaniesCsv, planEmployerSearches, planDiscovery, withPortals, isAggregator } from '../src/employers.js';
import { loadEnv } from './env.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const value = (n) => {
  const i = argv.indexOf(n);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${n} needs a value.`);
  return v;
};

const KNOWN = ['--companies', '--only', '--limit', '--explain', '--save', '--out', '--list', '--portals', '--discover', '--help', '-h'];
const unknown = argv.filter((a) => a.startsWith('-') && !KNOWN.includes(a));
if (unknown.length) fail(`Unknown option: ${unknown.join(' ')}  (try --help)`);

if (flag('--help') || flag('-h')) {
  const doc = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
  console.log(doc.replace(/^#!.*\n/, '').replace(/^\/\*\*?\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const file = value('--companies');
if (!file) fail('--companies FILE is required (a CSV with "Company" and "Company website" columns, kept outside the repo).');
const only = value('--only')?.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
const limit = value('--limit') ? Number(value('--limit')) : 10;
if (!(limit >= 1 && limit <= 200)) fail('--limit must be 1 to 200.');
const outDir = value('--out');
const explain = flag('--explain') || Boolean(outDir);

let companies;
try {
  companies = parseCompaniesCsv(readFileSync(file, 'utf8'));
} catch (err) {
  fail(`Could not read ${file}: ${err.message}`);
}
if (only?.length) {
  const picked = new Map();
  for (const w of only) {
    const exact = companies.filter((c) => c.name.toLowerCase() === w);
    const found = exact.length ? exact : companies.filter((c) => c.name.toLowerCase().includes(w));
    if (!found.length) console.error(`No company matches "${w}".`);
    for (const c of found) picked.set(c.name, c);
  }
  companies = [...picked.values()];
}
companies = companies.slice(0, limit);
if (!companies.length) fail('No companies match.');

const portalsFile = value('--portals');
if (portalsFile) {
  try {
    companies = withPortals(companies, JSON.parse(readFileSync(portalsFile, 'utf8')));
  } catch (err) {
    fail(`Could not use ${portalsFile}: ${err.message}`);
  }
}

if (flag('--discover')) {
  const env0 = loadEnv();
  if (!env0.TAVILY_API_KEY) fail('TAVILY_API_KEY is not set. Put it in .dev.vars (see .dev.vars.example).');
  console.error(`Looking for portal domains for ${companies.length} companies (~${companies.length} Tavily credits)…\n`);
  for (const s of planDiscovery(companies)) {
    const hosts = new Map();
    try {
      for (const r of await searchTavily({ key: env0.TAVILY_API_KEY, search: s })) {
        const h = hostOf(r.url);
        if (h && !isAggregator(h)) hosts.set(h, [...(hosts.get(h) || []), new URL(r.url).pathname]);
      }
    } catch (err) {
      console.log(`${s.company}: search failed (${err.message})`);
      continue;
    }
    console.log(`${s.company}  (own site: ${companies.find((c) => c.name === s.company).domain})`);
    if (!hosts.size) console.log('  (no other site found)');
    for (const [h, paths] of hosts) console.log(`  ${h}  e.g. ${paths[0]}${paths.length > 1 ? `  (+${paths.length - 1})` : ''}`);
  }
  console.log('\nOpen each site yourself. If it is the company\'s own, add it to the --portals file. Nothing was added.');
  process.exit(0);
}

const searches = planEmployerSearches(companies);

if (flag('--list')) {
  console.log(`${searches.length} searches (~${searches.length} Tavily credits):\n`);
  for (const s of searches) console.log(`  ${searchLabel(s).padEnd(34)} only ${s.domains.join(' + ')}`);
  process.exit(0);
}

const env = loadEnv();
if (!env.TAVILY_API_KEY) fail('TAVILY_API_KEY is not set. Put it in .dev.vars (see .dev.vars.example).');

console.error(`Running ${searches.length} searches (~${searches.length} Tavily credits) — dry run…`);

const trace = new Map();
const onResult = explain
  ? (e) => {
      if (!trace.has(e.search)) trace.set(e.search, []);
      trace.get(e.search).push(e);
    }
  : undefined;

const result = await runWeeklyOpportunities({
  openPr: true,
  config: { tavilyKey: env.TAVILY_API_KEY, owner: env.REPO_OWNER || 'realtimshady16', repo: env.REPO_NAME || 'mzantsi-vibes' },
  gh: null,
  dryRun: true,
  searches,
  skipClosing: true,
  concurrency: 8, // 144 at once would risk Tavily rate limits
  onResult,
});

// What we print, and, with --out, what we store: the trace, a tally of reasons, the PR preview.
const report = [];
if (explain) {
  report.push('=== why each result was kept or dropped ===');
  const reasons = new Map();
  for (const s of searches) {
    report.push(`\n${searchLabel(s)}  (only ${s.domains.join(' + ')})`);
    const events = trace.get(s) || [];
    if (!events.length) report.push('  (no results)');
    for (const e of events) {
      if (e.error) report.push(`  ERROR  ${e.error}`);
      else if (e.kept) report.push(`  KEEP   ${e.result.score?.toFixed(2) ?? '    '}  ${e.result.url}  → closes ${e.finding.closes}${e.finding.yearAssumed ? ' (year assumed)' : ''}`);
      else {
        report.push(`  DROP   ${e.result.score?.toFixed(2) ?? '    '}  ${e.result.url}\n         ↳ ${e.reason}`);
        const key = e.reason.replace(/closing date \d{4}-\d\d-\d\d has already passed/, 'closing date has already passed')
          .replace(/the next one \(\d{4}-\d\d-\d\d\)/, 'the next one').replace(/^not on .*, so not the company's own page$/, 'not on the company\'s own domains');
        reasons.set(key, (reasons.get(key) || 0) + 1);
      }
    }
  }
  report.push('\n=== tally of why results were dropped ===');
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) report.push(`  ${String(n).padStart(4)}  ${r}`);
}
if (result.prPreview) {
  report.push(`\n=== PR preview: ${result.prPreview.count} line(s) the real run would add to OPPORTUNITIES.md (nothing was opened) ===\n`);
  for (const a of result.prPreview.entries) report.push(`  ${a.pillar} › ${a.section}\n    ${a.line}\n`);
} else if (result.prSkipped) report.push(`\nNo PR would be opened: ${result.prSkipped}`);
else if (result.prError) report.push(`\nPR step failed: ${result.prError}`);
const summary = `[dry run] ${result.findings} leads, ${result.searches} searches (~${result.credits} Tavily credits), ${result.failures} failed. Nothing was posted.`;
report.push(`\n${summary}`);

const text = `# ${result.title}\n\n${result.body}`;
console.log(text);
console.error(report.join('\n'));
if (flag('--save')) {
  writeFileSync(value('--save'), text);
  console.error(`Saved to ${value('--save')}`);
}
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const stem = `${outDir.replace(/\/$/, '')}/employers-${sastDate()}-${searches.length}-companies`;
  writeFileSync(`${stem}-issue.md`, text + '\n');
  writeFileSync(`${stem}-trace.txt`, `${summary}\nCompanies: ${companies.map((c) => c.name).join(', ')}\n\n${report.join('\n')}\n`);
  console.error(`Stored ${stem}-issue.md and ${stem}-trace.txt`);
}
