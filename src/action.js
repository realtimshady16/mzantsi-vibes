/**
 * Deliverable 4 — the Approve / Reject endpoint behind the digest links.
 *
 * Verifies the signed token, then labels the PR. It deliberately does NOT
 * merge: merging is the evening batch job's job, so a mis-click in an email
 * client can't land straight on main.
 */

import { verifyToken } from './tokens.js';
import { actionResultPage } from './email.js';
import { LABELS, LABEL_META } from './github.js';

const APPROVED = LABELS.approved;
const REJECTED = LABELS.rejected;

function html(status, body) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleAction({ request, config, gh, url }) {
  const backLink = `${config.baseUrl}/tasks`;

  const token = url.searchParams.get('token');
  if (!token) {
    return html(400, actionResultPage({
      ok: false,
      heading: 'No token',
      message: 'This link is missing its token. Use the links in the digest email.',
      link: backLink,
    }));
  }

  const verdict = await verifyToken(config.hmacSecret, token);
  if (!verdict.ok) {
    return html(400, actionResultPage({
      ok: false,
      heading: 'Link not valid',
      message: verdict.error,
      link: backLink,
    }));
  }

  const { p: prNumber, a: action } = verdict.payload;
  const { owner, repo } = config;

  // Make sure the PR still exists and is still open before labelling it.
  const pull = await gh.getPull(owner, repo, prNumber).catch(() => null);
  if (!pull) {
    return html(404, actionResultPage({
      ok: false,
      heading: 'PR not found',
      message: `#${prNumber} no longer exists.`,
      link: backLink,
    }));
  }
  if (pull.state !== 'open') {
    return html(409, actionResultPage({
      ok: true,
      heading: `PR #${prNumber} is already ${pull.state}`,
      message: 'Nothing to do — it was already dealt with.',
      link: pull.html_url || backLink,
    }));
  }

  for (const [name, meta] of Object.entries(LABEL_META)) {
    await gh.ensureLabel(owner, repo, name, meta.color, meta.description);
  }

  if (action === 'approve') {
    // Approving supersedes a previous reject and vice versa, so the last click
    // wins and a duplicate click is a no-op.
    await gh.removeLabel(owner, repo, prNumber, REJECTED).catch(() => {});
    await gh.removeLabel(owner, repo, prNumber, LABELS.pending).catch(() => {});
    await gh.addLabels(owner, repo, prNumber, [APPROVED]);

    return html(200, actionResultPage({
      ok: true,
      heading: `PR #${prNumber} approved`,
      message: 'It will merge with the batch at 18:00 SAST.',
      link: `${config.baseUrl}/tasks`,
    }));
  }

  await gh.removeLabel(owner, repo, prNumber, APPROVED).catch(() => {});
  await gh.removeLabel(owner, repo, prNumber, LABELS.pending).catch(() => {});
  await gh.addLabels(owner, repo, prNumber, [REJECTED]);

  return html(200, actionResultPage({
    ok: true,
    heading: `PR #${prNumber} rejected`,
    message: 'It will be closed with a note, and you will not get a merge.',
    link: `${config.baseUrl}/tasks`,
  }));
}
