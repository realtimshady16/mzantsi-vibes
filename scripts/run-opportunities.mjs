#!/usr/bin/env node
/**
 * Run the opportunity digest on demand, outside the Worker.
 *
 *   node scripts/run-opportunities.mjs          dry run: search and print the
 *                                               issue, create nothing
 *   node scripts/run-opportunities.mjs --post   same, then open the real issue
 *
 * Reads TAVILY_API_KEY (and BOT_GITHUB_PAT for --post) from .dev.vars or the
 * environment. Uses the same code as the weekly cron, so what you see here is
 * what the cron will post. A dry run costs the same Tavily credits as a real one.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runOpportunityDigest } from '../src/opportunities.js';
import { github } from '../src/github.js';

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
const post = process.argv.includes('--post');

if (!env.TAVILY_API_KEY) {
  console.error('TAVILY_API_KEY is not set. Put it in .dev.vars (see .dev.vars.example).');
  process.exit(1);
}
if (post && !env.BOT_GITHUB_PAT) {
  console.error('--post needs BOT_GITHUB_PAT in .dev.vars or the environment.');
  process.exit(1);
}

const config = {
  tavilyKey: env.TAVILY_API_KEY,
  owner: env.REPO_OWNER || 'realtimshady16',
  repo: env.REPO_NAME || 'mzantsi-vibes',
};

const result = await runOpportunityDigest({
  config,
  gh: post ? github(env.BOT_GITHUB_PAT) : null,
  dryRun: !post,
});

if (!post) {
  console.log(`# ${result.title}\n\n${result.body}`);
  console.error(`\n[dry run] ${result.findings} links, ${result.searches} searches (~${result.credits} Tavily credits), ${result.failures} failed. Nothing was posted. Use --post to open the issue.`);
} else {
  console.log(`Opened ${result.issueUrl} — ${result.findings} links, ~${result.credits} credits, ${result.failures} failed searches.`);
}
