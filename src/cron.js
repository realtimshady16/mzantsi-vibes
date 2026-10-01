/**
 * Deliverable 3 — daily digest email with Approve / Reject links.
 * Deliverable 5 — 6pm batch merge of everything approved, close of the rest.
 */

import { sendDigest } from './email.js';
import { LABELS, LABEL_META, isContributionPull } from './github.js';

async function ensureLabels(config, gh) {
  for (const [name, meta] of Object.entries(LABEL_META)) {
    await gh.ensureLabel(config.owner, config.repo, name, meta.color, meta.description);
  }
}

/** Open PRs that the contribute form opened. Nothing else is ever digested, merged or closed. */
async function listContributionPulls(config, gh, opts) {
  const all = await gh.listOpenPulls(config.owner, config.repo, opts);
  return all.filter((pull) => isContributionPull(pull, config));
}

/** Best effort: a leftover branch is clutter, not a reason to fail the run. */
const tidyBranch = (config, gh, pull) =>
  gh.deleteBranch(config.owner, config.repo, pull.head.ref).catch(() => {});

/**
 * Morning run. Only surfaces PRs the contribute form opened that are still
 * undecided — anything already approved or rejected stays out of the inbox
 * until the evening job deals with it.
 */
export async function runDigest({ config, gh, fetchImpl }) {
  await ensureLabels(config, gh);

  const all = await listContributionPulls(config, gh);

  const decided = new Set([LABELS.approved, LABELS.rejected].map((l) => l.toLowerCase()));
  const pending = all.filter(
    (pull) => !(pull.labels || []).some((l) => decided.has((l.name || '').toLowerCase()))
  );

  const result = await sendDigest({ config, pulls: pending, gh, fetchImpl });

  return {
    ...result,
    openContributionPRs: all.length,
    skippedDecided: all.length - pending.length,
  };
}

/**
 * Evening run. Merges everything approved, closes everything rejected.
 *
 * Labels are stripped afterwards so a merged or closed PR is never picked up
 * again on the next run, which also makes this job safely repeatable.
 */
export async function runBatchMerge({ config, gh }) {
  await ensureLabels(config, gh);

  const { owner, repo } = config;
  const summary = { merged: [], closed: [], failed: [] };

  const approved = await listContributionPulls(config, gh, { labels: [LABELS.approved] });
  for (const pull of approved) {
    try {
      const res = await gh.mergePull(owner, repo, pull.number);
      if (res?.merged) {
        summary.merged.push(pull.number);
        await gh.removeLabel(owner, repo, pull.number, LABELS.approved).catch(() => {});
        await gh.removeLabel(owner, repo, pull.number, LABELS.pending).catch(() => {});
        await tidyBranch(config, gh, pull);
      } else {
        summary.failed.push({ pr: pull.number, reason: res?.message || 'merge was refused' });
      }
    } catch (err) {
      summary.failed.push({ pr: pull.number, reason: err.message });
    }
  }

  const rejected = await listContributionPulls(config, gh, { labels: [LABELS.rejected] });
  for (const pull of rejected) {
    try {
      await gh.commentPull(
        owner,
        repo,
        pull.number,
        'Closing this one — it was rejected during the daily review.\n\n' +
          `If you think this was a mistake, add the resource in the [contribute form](${config.baseUrl}/contribute/) again and mention the original PR.`
      ).catch(() => {});
      await gh.closePull(owner, repo, pull.number);
      summary.closed.push(pull.number);
      await gh.removeLabel(owner, repo, pull.number, LABELS.rejected).catch(() => {});
      await tidyBranch(config, gh, pull);
    } catch (err) {
      summary.failed.push({ pr: pull.number, reason: err.message });
    }
  }

  return summary;
}
