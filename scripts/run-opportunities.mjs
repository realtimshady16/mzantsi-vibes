#!/usr/bin/env node
/**
 * Run the opportunity digest on demand, outside the Worker, and tune it.
 *
 * It uses the same code as the weekly cron, so what you see here is what the
 * cron will post. By default it is a DRY RUN: it searches and prints the issue,
 * and creates nothing on GitHub.
 *
 *   node scripts/run-opportunities.mjs                     full dry run of the weekly digest (10 credits)
 *   node scripts/run-opportunities.mjs --with-broad        ...plus the broader whole-web pass (15 credits)
 *   node scripts/run-opportunities.mjs --list              show the plan, spend nothing
 *   node scripts/run-opportunities.mjs --explain           also show every result and why it was kept or dropped
 *   node scripts/run-opportunities.mjs --only job          just the searches matching "job" (Job openings)
 *   node scripts/run-opportunities.mjs --post              full run, then open the real issue
 *
 * Tuning flags (all dry-run only):
 *   --with-broad          also run the broader whole-web pass, which the weekly digest
 *                         leaves out (it was mostly noise); --only broad does the same
 *   --only a,b            keep searches whose pass (scoped|broad), category or
 *                         faculty contains any of these, e.g. "learnership,law"
 *                         (add "closing" to include the closing-soon pages)
 *   --query "text"        replace the query text of the searches --only selects
 *   --time-range X        day | week | month | year | none (applies to every selected search)
 *   --max-results N       results per search
 *   --min-score X         drop results Tavily scored below X (0 to 1); --explain shows the scores
 *   --explain             print each search's results with KEEP / DROP and the reason
 *   --save FILE           also write the issue text to FILE
 *
 * Reads TAVILY_API_KEY (and BOT_GITHUB_PAT for --post) from .dev.vars or the
 * environment. Every search is 1 Tavily credit, dry run or not.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runOpportunityDigest, planSearches, includesClosing, searchLabel } from '../src/opportunities.js';
import { github } from '../src/github.js';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} needs a value.`);
  return v;
};
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const KNOWN = ['--post', '--list', '--explain', '--with-broad', '--help', '-h', '--only', '--query', '--time-range', '--max-results', '--min-score', '--save'];
const unknown = argv.filter((a) => a.startsWith('-') && !KNOWN.includes(a));
if (unknown.length) fail(`Unknown option: ${unknown.join(' ')}  (try --help)`);

if (flag('--help') || flag('-h')) {
  const doc = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
  console.log(doc.replace(/^#!.*\n/, '').replace(/^\/\*\*?\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const only = value('--only')?.split(',');
const query = value('--query');
const timeRange = value('--time-range');
const maxResults = value('--max-results') ? Number(value('--max-results')) : undefined;
const minScore = value('--min-score') ? Number(value('--min-score')) : undefined;
const savePath = value('--save');
const post = flag('--post');
const explain = flag('--explain');
const withBroadFlag = flag('--with-broad');

if (timeRange && !['day', 'week', 'month', 'year', 'none'].includes(timeRange)) {
  fail('--time-range must be day, week, month, year or none.');
}
if (maxResults !== undefined && !(maxResults >= 1 && maxResults <= 20)) fail('--max-results must be 1 to 20.');
if (minScore !== undefined && !(minScore > 0 && minScore <= 1)) fail('--min-score must be above 0 and at most 1.');
if (query && !only) fail('--query replaces the query text, so say which searches with --only (e.g. --only job).');

const tuned = Boolean(only || query || timeRange || maxResults || minScore || withBroadFlag);
if (post && tuned) {
  fail('--post opens the full weekly digest. Remove --only/--query/--time-range/--max-results/--min-score/--with-broad, or drop --post to keep experimenting.');
}

/* ---------------- environment ---------------- */

function loadDevVars() {
  const file = fileURLToPath(new URL('../.dev.vars', import.meta.url));
  if (!existsSync(file)) return {};
  const vars = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

const env = { ...loadDevVars(), ...process.env };

/* ---------------- the plan ---------------- */

const searches = planSearches({ only, query, timeRange, maxResults, minScore, broad: withBroadFlag });
const withClosing = includesClosing(only);

if (!searches.length && !withClosing) {
  fail(`Nothing matches --only ${only.join(',')}. Try --list to see the available searches.`);
}

function describe(s) {
  const bits = [];
  if (s.include) bits.push(`only ${s.include.join(' + ')}`);
  if (s.exclude) bits.push(`excluding ${s.exclude.length} domains`);
  bits.push(s.timeRange ? `last ${s.timeRange}` : 'any date');
  bits.push(`max ${s.maxResults}`);
  if (s.minScore) bits.push(`score ≥ ${s.minScore}`);
  return `${searchLabel(s).padEnd(34)} "${s.query}"  [${bits.join(', ')}]`;
}

if (flag('--list')) {
  console.log(`${searches.length} searches (~${searches.length} Tavily credits)${withClosing ? ' + the closing-soon pages (free)' : ''}:\n`);
  searches.forEach((s) => console.log('  ' + describe(s)));
  process.exit(0);
}

if (!env.TAVILY_API_KEY) fail('TAVILY_API_KEY is not set. Put it in .dev.vars (see .dev.vars.example).');
if (post && !env.BOT_GITHUB_PAT) fail('--post needs BOT_GITHUB_PAT in .dev.vars or the environment.');

/* ---------------- run ---------------- */

console.error(`Running ${searches.length} searches (~${searches.length} Tavily credits)${post ? ', then opening the real issue' : ' — dry run'}…`);

// --explain collects every decision, grouped under the search that produced it.
const trace = new Map();
const onResult = explain
  ? (e) => {
      if (!trace.has(e.search)) trace.set(e.search, []);
      trace.get(e.search).push(e);
    }
  : undefined;

const config = {
  tavilyKey: env.TAVILY_API_KEY,
  owner: env.REPO_OWNER || 'realtimshady16',
  repo: env.REPO_NAME || 'mzantsi-vibes',
};

const result = await runOpportunityDigest({
  config,
  gh: post ? github(env.BOT_GITHUB_PAT) : null,
  dryRun: !post,
  searches,
  skipClosing: !withClosing,
  onResult,
});

if (explain) {
  console.error('\n=== why each result was kept or dropped ===');
  for (const s of searches) {
    console.error(`\n${describe(s)}`);
    const events = trace.get(s) || [];
    if (!events.length) console.error('  (no results)');
    for (const e of events) {
      if (e.error) console.error(`  ERROR  ${e.error}`);
      else if (e.kept) console.error(`  KEEP   ${e.result.score?.toFixed(2) ?? '    '}  ${e.result.url}`);
      else console.error(`  DROP   ${e.result.score?.toFixed(2) ?? '    '}  ${e.result.url}\n         ↳ ${e.reason}`);
    }
  }
  console.error('');
}

if (post) {
  console.log(`Opened ${result.issueUrl} — ${result.findings} links, ~${result.credits} credits, ${result.failures} failed searches.`);
} else {
  const text = `# ${result.title}\n\n${result.body}`;
  console.log(text);
  if (savePath) {
    writeFileSync(savePath, text);
    console.error(`Saved to ${savePath}`);
  }
  console.error(
    `\n[dry run] ${result.findings} links, ${result.searches} searches (~${result.credits} Tavily credits), ` +
      `${result.failures} failed. Nothing was posted.${tuned ? '' : ' Use --post to open the issue.'}`
  );
}
