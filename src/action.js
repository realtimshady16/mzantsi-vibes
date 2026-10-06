/**
 * Deliverable 4 — the Approve / Reject endpoint behind the digest links.
 *
 * Verifies the signed token, then labels the PR. It deliberately does NOT
 * merge: merging is the evening batch job's job, so a mis-click in an email
 * client can't land straight on main.
 */

import { verifyToken } from './tokens.js';
import { actionResultPage, actionConfirmPage } from './email.js';
import { LABELS, LABEL_META, isContributionPull } from './github.js';

const APPROVED = LABELS.approved;
const REJECTED = LABELS.rejected;

function html(status, body) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    },
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
  // A signed link only ever names a contribution PR, but check anyway: this
  // endpoint must not be able to label (and so get merged) someone's own PR.
  if (!isContributionPull(pull, config)) {
    return html(403, actionResultPage({
      ok: false,
      heading: 'Not a contribution',
      message: `#${prNumber} was not opened by the contribute form, so this link cannot act on it.`,
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

  // A GET changes nothing. Mail scanners and link previews fetch every link in an
  // email, so an Approve or Reject that acted on GET could fire without a human.
  // The page shows what is about to happen and asks for a click (a POST).
  if (request.method !== 'POST') {
    return html(200, actionConfirmPage({ action, number: prNumber, title: pull.title, prUrl: pull.html_url }));
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
