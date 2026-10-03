/**
 * The weekly digest's second output: a pull request adding the leads that have a
 * closing date to OPPORTUNITIES.md.
 *
 * It goes through the same door as a form submission: a `contribute/…` branch in
 * this repo, opened by the GitHub App, labelled needs-review. So it shows up in
 * the 08:00 digest email with Approve and Reject links, and only an approved one
 * is merged by the 18:00 job. Nothing is merged from here, and nothing is
 * pushed to main.
 *
 * Safety limits: one such PR open at a time, at most MAX_ENTRIES entries, and
 * nothing already listed in README.md or OPPORTUNITIES.md is added again.
 */

import { parseReadme } from '../PUBLISH/content-parse.js';
import { todayInSA } from '../PUBLISH/entry-meta.js';
import { LABELS, LABEL_META } from './github.js';
import { insertEntries, linkTargets } from './opportunities-file.js';
import { entryLine, destinationOf, sourceOf, urlKey, sastDate, inert, runOpportunityDigest } from './opportunities.js';

export const OPPS_PATH = 'OPPORTUNITIES.md';
export const MAX_ENTRIES = 15;
const BRANCH_STEM = 'opps';

/** Branch name for a digest PR; the open-PR guard recognises PRs by this stem. */
function branchName(config, now) {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${config.branchPrefix || 'contribute'}/${BRANCH_STEM}-${sastDate(now)}-${rand}`;
}

/** Read both files: through the App when there is one, else the public raw files (a preview needs no login). */
async function readSources({ config, gh, fetchImpl = fetch }) {
  if (gh) {
    const [opps, readme] = await Promise.all([
      gh.getReadme(config.owner, config.repo, OPPS_PATH),
      gh.getReadme(config.owner, config.repo, 'README.md'),
    ]);
    return { opps: opps.content, oppsSha: opps.sha, readme: readme.content };
  }
  const base = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/main/`;
  const [o, r] = await Promise.all([fetchImpl(base + OPPS_PATH), fetchImpl(base + 'README.md')]);
  if (!o.ok || !r.ok) throw new Error(`could not read the content files (${o.status}/${r.status})`);
  return { opps: await o.text(), oppsSha: null, readme: await r.text() };
}

/** An open PR this job opened earlier, if any. Needs the App; a preview without one cannot check. */
async function openDigestPull(config, gh) {
  if (!gh) return null;
  const prefix = `${config.branchPrefix || 'contribute'}/${BRANCH_STEM}-`;
  const pulls = await gh.listOpenPulls(config.owner, config.repo);
  return pulls.find((p) => p.user?.type === 'Bot' && String(p.head?.ref || '').startsWith(prefix)) || null;
}

/**
 * Work out what the PR would add, without changing anything.
 * Returns { skipped } or { entries, markdown, sha, skippedDuplicates }.
 */
export async function planOpportunityPr({ config, gh, findings, now = new Date(), fetchImpl }) {
  const open = await openDigestPull(config, gh);
  if (open) return { skipped: `PR #${open.number} from an earlier run is still open. Approve or reject it first.` };

  const today = todayInSA(now);
  const src = await readSources({ config, gh, fetchImpl });
  const listed = new Set([...linkTargets(src.opps), ...linkTargets(src.readme)].map(urlKey));

  // Trusted sites only, with a closing date that has not passed, soonest first.
  const dated = findings
    .filter((f) => f.pass !== 'broad' && f.closes && f.closes >= today && sourceOf(f.url) !== 'broader search' && entryLine(f))
    .sort((a, b) => a.closes.localeCompare(b.closes));
  const fresh = dated.filter((f) => !listed.has(urlKey(f.url)));
  const skippedDuplicates = dated.length - fresh.length;
  if (!fresh.length) {
    return { skipped: dated.length ? `all ${dated.length} dated leads are already listed.` : 'no lead this week had a closing date.', skippedDuplicates };
  }

  const picked = fresh.slice(0, MAX_ENTRIES);
  const additions = picked.map((f) => ({ ...destinationOf(f), line: entryLine(f) }));
  const markdown = insertEntries(src.opps, additions);

  // Read it back the way the site will. If an entry did not come out with the
  // right link and date, the PR would be wrong, so stop here.
  const parsed = parseReadme(markdown, today);
  const shown = new Map();
  for (const pillar of Object.values(parsed.pillars)) for (const list of Object.values(pillar)) for (const e of list) shown.set(urlKey(e.url), e);
  for (const f of picked) {
    const e = shown.get(urlKey(f.url));
    if (!e || e.meta?.closes !== f.closes) throw new Error(`"${f.title}" would not read back from OPPORTUNITIES.md with its closing date; no PR opened.`);
  }

  return { entries: picked, additions, markdown, sha: src.oppsSha, skippedDuplicates, hiddenByCap: fresh.length - picked.length };
}

function prBody(entries, { skippedDuplicates, hiddenByCap }, now) {
  const items = entries.map((f) => {
    const { pillar, section } = destinationOf(f);
    return `- **[${f.title.replace(/[\[\]]/g, '')}](${f.url})**: closes **${f.closes}** · ${pillar} › ${section} · _${sourceOf(f.url)}_`;
  });
  return [
    '### Weekly opportunity digest: closing dates',
    '',
    `Opened by the weekly digest on ${sastDate(now)}. Each lead below had a closing date, read from its page or search result. **Check each date against the page before approving**: a wrong date hides a live opportunity, or keeps a closed one showing.`,
    '',
    ...items,
    '',
    ...(hiddenByCap ? [`${hiddenByCap} more dated lead${hiddenByCap === 1 ? '' : 's'} left for next week (at most ${MAX_ENTRIES} per PR).`, ''] : []),
    ...(skippedDuplicates ? [`${skippedDuplicates} already listed, skipped.`, ''] : []),
    'Each entry hides itself on its closing date, so nothing here needs removing later. Merge is handled by the daily batch job after review.',
    '',
    '---',
    'Opened automatically by the weekly opportunity digest.',
  ].join('\n');
}

/** Open the PR for a plan from planOpportunityPr. Returns { number, url }. */
export async function openOpportunityPr({ config, gh, plan, now = new Date() }) {
  const base = await gh.getDefaultBranchSha(config.owner, config.repo);
  const branch = branchName(config, now);
  await gh.createBranch(config.owner, config.repo, branch, base);
  await gh.commitReadme(config.owner, config.repo, branch, { path: OPPS_PATH, content: plan.markdown, sha: plan.sha });

  const n = plan.entries.length;
  const pr = await gh.createPullRequest(config.owner, config.repo, {
    title: `contribute: Add ${n} opportunit${n === 1 ? 'y' : 'ies'} with closing dates (weekly digest)`,
    head: branch,
    base: 'main',
    body: prBody(plan.entries, plan, now),
  });

  for (const [name, meta] of Object.entries(LABEL_META)) await gh.ensureLabel(config.owner, config.repo, name, meta.color, meta.description);
  await gh.addLabels(config.owner, config.repo, pr.number, [LABELS.pending]).catch(() => {});
  return { number: pr.number, url: pr.html_url };
}

/**
 * The weekly job: the digest issue, plus (unless `openPr` is false) the PR of
 * dated leads. The PR is a bonus: if it cannot be prepared or opened, the issue
 * still goes out and says so. `fetchContent` is for tests.
 */
export async function runWeeklyOpportunities({ openPr = true, fetchContent, ...opts }) {
  const onFindings = openPr
    ? async ({ findings, now, dryRun }) => {
        const { config, gh } = opts;
        try {
          const plan = await planOpportunityPr({ config, gh, findings, now, fetchImpl: fetchContent });
          if (plan.skipped) return { lines: [`📬 No PR this week: ${plan.skipped}`, ''], result: { pr: null, prSkipped: plan.skipped } };

          const n = plan.entries.length;
          if (dryRun) {
            return {
              lines: [`📬 **Preview:** the real run would open a PR adding ${n} dated lead${n === 1 ? '' : 's'} to OPPORTUNITIES.md.`, ''],
              result: { pr: null, prPreview: { entries: plan.additions, count: n, skippedDuplicates: plan.skippedDuplicates, hiddenByCap: plan.hiddenByCap } },
            };
          }
          const pr = await openOpportunityPr({ config, gh, plan, now });
          return {
            lines: [`📬 Opened PR #${pr.number} adding ${n} dated lead${n === 1 ? '' : 's'} to OPPORTUNITIES.md. It is in the review digest like any contribution: check each date, then Approve.`, ''],
            result: { pr: { ...pr, entries: n } },
          };
        } catch (err) {
          console.error('opportunity PR failed:', err?.stack || err);
          return { lines: [`⚠️ Could not open the PR (the leads below are unaffected): ${inert(err?.message || err)}`, ''], result: { pr: null, prError: String(err?.message || err) } };
        }
      }
    : undefined;
  return runOpportunityDigest({ ...opts, onFindings });
}
