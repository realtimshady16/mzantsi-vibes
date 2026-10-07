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
 *   --registry         BUILD A REGISTRY instead of looking for something open. Per company: one primary URL and up
 *                      to two alternates, each typed landing | programme | job-board | other, on the company's own
 *                      domain or a --portals domain, score >= 0.5, whether or not they state a date. Dropped: job
 *                      postings (/job/, /jobs/<id>, requisition ids), URLs with query-string tokens, apply
 *                      endpoints, other countries' or regions' pages (us, uk, de, mx, apac, zw ...), PDFs. Global
 *                      pages only as a flagged fallback. News, press, blog and terms pages are typed "other" and
 *                      never preferred. A company with nothing gets one retry with variant queries (early careers,
 *                      learnership, YES programme, bursary), including its portals. Output also has the cycle year
 *                      when one is visible in the title or URL. closes is left empty and no year is ever assumed.
 *                      Never opens or proposes anything; with --out it writes employers-<date>-registry-v2-N-
 *                      companies.csv, a below-0.5 file and a trace. Timeouts and rate limits are retried.
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
import { searchLabel, searchTavily, hostOf, sastDate, collect } from '../src/opportunities.js';
import { runWeeklyOpportunities } from '../src/opportunity-pr.js';
import { parseCompaniesCsv, planEmployerSearches, planDiscovery, withPortals, isAggregator } from '../src/employers.js';
import {
  planRegistrySearches, planVariantSearches, registryFallback, pickRegistry, registryCsv,
  REGISTRY_MIN_SCORE, REGISTRY_FLOOR, REGISTRY_PER_COMPANY, REGISTRY_VARIANTS,
} from '../src/registry.js';
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

const KNOWN = ['--companies', '--only', '--limit', '--explain', '--save', '--out', '--list', '--portals', '--discover', '--registry', '--help', '-h'];
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
const portalsFile = value('--portals');
if (portalsFile) {
  try {
    companies = withPortals(companies, JSON.parse(readFileSync(portalsFile, 'utf8')));
  } catch (err) {
    fail(`Could not use ${portalsFile}: ${err.message}`);
  }
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

if (flag('--registry')) {
  const envR = loadEnv();
  if (!envR.TAVILY_API_KEY) fail('TAVILY_API_KEY is not set. Put it in .dev.vars (see .dev.vars.example).');
  const regSearches = planRegistrySearches(companies);
  if (flag('--list')) {
    console.log(`${regSearches.length} registry searches (~${regSearches.length} Tavily credits), plus up to ${REGISTRY_VARIANTS.length} variant searches for each company that finds nothing`);
    process.exit(0);
  }
  console.error(`Registry: ${regSearches.length} searches (~${regSearches.length} Tavily credits); then variant queries for companies with nothing. Timeouts and rate limits are retried, pausing longer each time…`);
  const events = [];
  const onResultR = (e) => events.push(e);
  const retry = { concurrency: 4, retries: 3, retryDelayMs: 5000 };

  const first = await collect({ key: envR.TAVILY_API_KEY, searches: regSearches, onResult: onResultR, ...retry });
  const hasPage = (list, name) => list.some((f) => f.company === name && !f.lowScore);
  const missing = companies.filter((c) => !hasPage(first.findings, c.name));
  console.error(`First pass: ${companies.length - missing.length} of ${companies.length} companies have a page at score ≥ ${REGISTRY_MIN_SCORE}. Retrying ${missing.length} with variant queries (${REGISTRY_VARIANTS.map((v) => v[0]).join(', ')})…`);
  const second = await registryFallback({ key: envR.TAVILY_API_KEY, companies: missing, onResult: onResultR, ...retry });

  // Merge, one entry per page (a variant can find what the first query also found).
  const seenUrls = new Set();
  const findings = [...first.findings, ...second.findings].filter((f) => (seenUrls.has(f.url) ? false : seenUrls.add(f.url)));
  const failures = [...first.failures, ...second.failures];
  const fallbackSearches = second.tried.reduce((n, t) => n + t.queries, 0);

  // Main output: score >= 0.5 only, one primary and up to two alternates, typed. Below that (down to the floor) goes in
  // a separate file, for companies with fewer than three, so the threshold can be judged from what it leaves out.
  const rows = pickRegistry(findings.filter((f) => !f.lowScore), companies);
  const spare = companies.flatMap((c) =>
    pickRegistry(findings.filter((f) => f.lowScore && f.company === c.name), [c], REGISTRY_PER_COMPANY - rows.filter((r) => r.company === c.name).length)
      .map((r) => ({ ...r, role: 'candidate', flag: [r.flag, `score below ${REGISTRY_MIN_SCORE}`].filter(Boolean).join('; ') })));

  const lines = [`${'company'.padEnd(30)} ${'role'.padEnd(9)} ${'type'.padEnd(9)} score  year  url`];
  for (const r of rows) lines.push(`${r.company.slice(0, 29).padEnd(30)} ${r.role.padEnd(9)} ${r.type.padEnd(9)} ${r.score.toFixed(2)}  ${String(r.cycleYear ?? '').padEnd(4)}  ${r.url}${r.flag ? `  [${r.flag}]` : ''}`);
  const have = new Set(rows.map((r) => r.company));
  const none = companies.filter((c) => !have.has(c.name)).map((c) => c.name);
  const byType = Object.entries(rows.reduce((m, r) => ({ ...m, [r.type]: (m[r.type] || 0) + 1 }), {})).map(([t, n]) => `${n} ${t}`).join(', ');
  const rescued = second.tried.filter((t) => t.found).length;
  const summary = `[registry] ${rows.length} URLs for ${have.size} of ${companies.length} companies ` +
    `(${rows.filter((r) => r.role === 'primary').length} primary, ${rows.filter((r) => r.role === 'alternate').length} alternates; ${byType}; ${rows.filter((r) => r.flag).length} flagged as a global fallback). ` +
    `The variant retry covered ${missing.length} companies with ${fallbackSearches} extra searches and found a page for ${rescued}. ` +
    `${first.retried.length + second.retried.length} transient retries; ${failures.length} failed${failures.length ? `: ${failures.join('; ')}` : ''}. ` +
    `${spare.length} more candidates scored ${REGISTRY_FLOOR}–${REGISTRY_MIN_SCORE} (listed apart, with --out). closes left empty, no year assumed. Nothing was posted or committed.`;
  console.log(lines.join('\n'));
  console.error(`\nNo qualifying URL (${none.length}): ${none.join(', ') || '(none)'}\n\n${summary}`);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const stem = `${outDir.replace(/\/$/, '')}/employers-${sastDate()}-registry-v2-${companies.length}-companies`;
    const trace = [`${summary}\n`, `No qualifying URL (${none.length}): ${none.join(', ')}\n`, 'Variant retry (the companies the first pass found nothing for):'];
    for (const t of second.tried) trace.push(`  ${t.company}: ${t.found ? 'found a page' : 'nothing'} after ${t.queries} variant search${t.queries === 1 ? '' : 'es'}`);
    const bySearch = new Map();
    for (const e of events) bySearch.set(e.search, [...(bySearch.get(e.search) || []), e]);
    const show = (s, evs) => {
      trace.push(`\n${searchLabel(s)}  (only ${s.domains.join(' + ')})  "${s.query}"`);
      if (!evs.length) trace.push('  (no results)');
      for (const e of evs) {
        if (e.error) trace.push(`  ERROR  ${e.error}`);
        else if (e.kept) trace.push(`  KEEP   ${e.result.score?.toFixed(2)}  ${e.finding.type.padEnd(9)} ${e.finding.locale.padEnd(7)} ${e.finding.url}`);
        else trace.push(`  DROP   ${e.result.score?.toFixed(2) ?? '    '}  ${e.result.url}\n         ↳ ${e.reason}`);
      }
    };
    for (const s of regSearches) show(s, bySearch.get(s) || []);
    for (const [s, evs] of bySearch) if (!regSearches.includes(s)) show(s, evs); // variant searches that returned something
    writeFileSync(`${stem}.csv`, registryCsv(rows));
    writeFileSync(`${stem}-below-${REGISTRY_MIN_SCORE}.csv`, registryCsv(spare));
    writeFileSync(`${stem}-trace.txt`, trace.join('\n') + '\n');
    console.error(`Stored ${stem}.csv, ${stem}-below-${REGISTRY_MIN_SCORE}.csv and ${stem}-trace.txt`);
  }
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
