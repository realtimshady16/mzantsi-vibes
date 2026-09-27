/**
 * Resend + the daily review digest.
 *
 * The digest is the whole review UI: one email, two signed links per PR.
 */

import { signToken } from './tokens.js';

async function sendResend({ apiKey, from, to, subject, html }, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `Resend returned ${res.status}`;
    try {
      msg = JSON.parse(text).message || msg;
    } catch {}
    throw new Error(`Email send failed: ${msg}`);
  }

  return text ? JSON.parse(text) : {};
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const shell = (inner) => `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#F7F3ED;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1208;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid rgba(107,79,58,0.15);border-radius:12px;overflow:hidden;">
    <div style="background:#1D6B4A;padding:20px 24px;color:#FFFFFF;">
      <div style="font-size:13px;opacity:0.85;letter-spacing:0.04em;text-transform:uppercase;">Mzantsi Vibes</div>
      <div style="font-size:21px;font-weight:600;margin-top:2px;">Daily contribution review</div>
    </div>
    <div style="padding:24px;">
      ${inner}
    </div>
    <div style="padding:14px 24px;background:#EDE8DF;font-size:12px;color:#5C4A38;">
      Links are signed and expire. Approving does not merge immediately — approved PRs merge at 18:00 SAST.
    </div>
  </div>
</div>
</body></html>`;

/** One line identifying a PR in the digest. */
function summarise(pull) {
  return (
    `<a href="${esc(pull.html_url)}" style="color:#1D6B4A;font-weight:600;">` +
    `#${pull.number} ${esc(pull.title)}</a>`
  );
}

/**
 * Build and send the morning digest. Returns a summary so the cron log says
 * what happened even when nothing is pending.
 */
export async function sendDigest({ config, pulls, gh, fetchImpl = fetch }) {
  if (!config.reviewerEmail) {
    throw new Error('REVIEWER_EMAIL is not set, so there is nowhere to send the digest.');
  }

  if (pulls.length === 0) {
    // Still send a short "all clear" so silence is never ambiguous.
    const html = shell(
      `<p style="margin:0 0 8px;font-size:15px;">Hi ${esc(config.reviewerName)},</p>
       <p style="margin:0;font-size:15px;">Nothing is waiting for review right now. Enjoy the quiet.</p>`
    );
    await sendResend(
      { apiKey: config.resendKey, from: config.emailFrom, to: config.reviewerEmail, subject: 'Mzantsi Vibes — nothing to review', html },
      fetchImpl
    );
    return { sent: true, pending: 0, merged: 0 };
  }

  const blocks = [];
  for (const pull of pulls) {
    const approve = await signToken(config.hmacSecret, {
      pr: pull.number,
      action: 'approve',
      ttlHours: config.tokenTtlHours,
    });
    const reject = await signToken(config.hmacSecret, {
      pr: pull.number,
      action: 'reject',
      ttlHours: config.tokenTtlHours,
    });
    const base = `${config.baseUrl}/action?token=`;

    blocks.push(`
      <div style="border:1px solid rgba(107,79,58,0.15);border-radius:10px;padding:16px;margin-bottom:14px;">
        <div style="font-size:15px;margin-bottom:6px;">${summarise(pull)}</div>
        <div style="font-size:13px;color:#5C4A38;margin-bottom:14px;">
          by ${esc(pull.user?.login || 'unknown')} · opened ${new Date(pull.created_at).toISOString().slice(0, 10)}
        </div>
        <div style="display:flex;gap:10px;">
          <a href="${base}${encodeURIComponent(approve)}"
             style="background:#1D6B4A;color:#FFFFFF;text-decoration:none;padding:9px 20px;border-radius:8px;font-size:14px;font-weight:600;">Approve</a>
          <a href="${base}${encodeURIComponent(reject)}"
             style="background:#FFFFFF;color:#b60205;text-decoration:none;padding:9px 20px;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #b60205;">Reject</a>
        </div>
      </div>`);
  }

  const html = shell(
    `<p style="margin:0 0 16px;font-size:15px;">Hi ${esc(config.reviewerName)},</p>
     <p style="margin:0 0 20px;font-size:15px;">
       ${pulls.length} contribution${pulls.length === 1 ? '' : 's'} waiting for review.
     </p>
     ${blocks.join('')}
     <p style="margin:16px 0 0;font-size:13px;color:#5C4A38;">
       Approve or reject each one. Approved PRs merge together at 18:00 SAST.
     </p>`
  );

  await sendResend(
    {
      apiKey: config.resendKey,
      from: config.emailFrom,
      to: config.reviewerEmail,
      subject: `Mzantsi Vibes — ${pulls.length} contribution${pulls.length === 1 ? '' : 's'} to review`,
      html,
    },
    fetchImpl
  );

  return { sent: true, pending: pulls.length };
}

/** Confirmation page shown after an Approve/Reject link is clicked. */
export function actionResultPage({ ok, heading, message, link }) {
  const colour = ok ? '#1D6B4A' : '#b60205';
  return shell(
    `<div style="text-align:center;padding:12px 0;">
       <div style="font-size:34px;">${ok ? '✅' : '⚠️'}</div>
       <h2 style="margin:10px 0 6px;font-size:20px;color:${colour};">${esc(heading)}</h2>
       <p style="margin:0 0 20px;font-size:15px;color:#5C4A38;">${esc(message)}</p>
       <a href="${esc(link)}" style="display:inline-block;background:#1D6B4A;color:#FFFFFF;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;">Back to the queue</a>
     </div>`
  );
}
