/**
 * Run a job by hand: the review digest, the evening merge, or the opportunity
 * digest. For testing, and for not waiting until 08:00 / 18:00 / Monday.
 *
 *   POST /api/admin/run
 *   Authorization: Bearer <run token>
 *   { "job": "digest" | "merge" | "opportunities", "dryRun": true | false }
 *
 * There is no login. The token is an HMAC signed with HMAC_SECRET (the same
 * secret that guards the Approve/Reject links), bound to one job, and valid for
 * five minutes. `scripts/trigger.mjs` mints one from your .dev.vars. Without the
 * secret there is no way in, and the endpoint says only "unauthorised".
 *
 * dryRun reports what the job would do and changes nothing.
 */

import { verifyAdminToken } from './tokens.js';
import { runDigest, runBatchMerge } from './cron.js';
import { runWeeklyOpportunities } from './opportunity-pr.js';

export const JOBS = {
  digest: ({ config, gh, dryRun }) => runDigest({ config, gh, dryRun }),
  merge: ({ config, gh, dryRun }) => runBatchMerge({ config, gh, dryRun }),
  opportunities: ({ config, gh, dryRun }) => runWeeklyOpportunities({ config, gh, dryRun }),
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function handleAdminRun({ request, config, gh, jobs = JOBS }) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Send a JSON body: {"job": "...", "dryRun": true}.' }, 400);
  }

  // Authenticate before saying anything about what exists. The token is bound
  // to a job, so a token for "digest" cannot start "merge".
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const verdict = await verifyAdminToken(config.hmacSecret, token, String(body?.job));
  if (!verdict.ok) return json({ ok: false, error: 'Unauthorised.' }, 401);

  const run = Object.hasOwn(jobs, body.job) ? jobs[body.job] : null;
  if (!run) return json({ ok: false, error: `Unknown job. Use one of: ${Object.keys(jobs).join(', ')}.` }, 400);

  const dryRun = body.dryRun === true;
  try {
    const result = await run({ config, gh, dryRun });
    console.log(`admin run: ${body.job}${dryRun ? ' (dry run)' : ''}`);
    return json({ ok: true, job: body.job, dryRun, result });
  } catch (err) {
    console.error(`admin run failed: ${body.job}:`, err?.stack || err);
    return json({ ok: false, job: body.job, dryRun, error: err?.message || 'The job failed.' }, 500);
  }
}
