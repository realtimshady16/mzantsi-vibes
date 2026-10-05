/**
 * Central config + env access. Secrets are never declared in wrangler.jsonc,
 * they come from `wrangler secret put` and land on env at runtime.
 */

import { appTokenProvider } from './github-auth.js';

// GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY identify the GitHub App the system
// runs as (see CONTRIBUTE_SETUP.md). There is no bot user account any more.
const REQUIRED_SECRETS = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'HMAC_SECRET', 'RESEND_API_KEY'];

const CRON_DIGEST = '0 6 * * *'; // 08:00 SAST (UTC+2, no DST in SA)
const CRON_MERGE = '0 16 * * *'; // 18:00 SAST
// Cloudflare numbers weekdays 1-7 from SUNDAY (not cron's 0-6 from Sunday with 1 = Monday), so a bare
// "1" fired this job on Sundays. Use the name.
const CRON_OPPS = '0 5 * * MON'; // Monday 07:00 SAST, before the morning digest

export { CRON_DIGEST, CRON_MERGE, CRON_OPPS };

export function readConfig(env) {
  const missing = REQUIRED_SECRETS.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(
      `Missing Worker secrets: ${missing.join(', ')}. ` +
        `Set them with: wrangler secret put <NAME>`
    );
  }

  const owner = env.REPO_OWNER || 'realtimshady16';
  const repo = env.REPO_NAME || 'mzantsi-vibes';

  return {
    // Hand this to github(): an async function returning a fresh installation token.
    githubAuth: appTokenProvider({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      owner,
      repo,
    }),
    hmacSecret: env.HMAC_SECRET,
    resendKey: env.RESEND_API_KEY,

    // Only the weekly opportunity digest uses this, so it is not in
    // REQUIRED_SECRETS: a missing key must not take down the contribute form.
    tavilyKey: env.TAVILY_API_KEY || '',

    owner,
    repo,

    reviewerName: env.REVIEWER_NAME || 'there',
    reviewerEmail: env.REVIEWER_EMAIL,
    emailFrom: env.EMAIL_FROM || 'Mzantsi Vibes <onboarding@resend.dev>',

    // Cron has no request context, so the digest needs the public origin to
    // build approve/reject links.
    baseUrl: (env.BASE_URL || 'https://mzantsi-vibes.pages.dev').replace(/\/+$/, ''),

    branchPrefix: env.BRANCH_PREFIX || 'contribute',

    // Submissions are refused once this many contribution PRs are open. Kept
    // well under the 100 a single page of the PR list returns.
    maxOpenContributions: Number(env.MAX_OPEN_CONTRIBUTIONS || 40),

    // Digest links are only useful for a few days; expire them generously
    // enough to survive a weekend, short enough that a leaked inbox link dies.
    tokenTtlHours: Number(env.TOKEN_TTL_HOURS || 72),

    // Best-effort abuse guard for the public endpoint. In-memory only, so it
    // resets when an isolate recycles. Not a real security boundary.
    rateLimit: {
      windowMs: 60 * 60 * 1000,
      max: Number(env.RATE_LIMIT_MAX || 5),
    },
  };
}

/* ---------------------------------------------------------------- *
 * Best-effort in-memory rate limiting. A Worker isolate can hold this
 * Map, but it is not shared across isolates and dies on eviction, so
 * treat it as a spam speed bump, never as a guarantee.
 * ---------------------------------------------------------------- */
const hits = new Map();

export function rateLimit(key, { windowMs, max }) {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }

  entry.count += 1;

  // Opportunistic cleanup so the Map cannot grow without bound.
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }

  return {
    ok: entry.count <= max,
    remaining: Math.max(0, max - entry.count),
    retryAfterMin: Math.max(1, Math.ceil((entry.resetAt - now) / 60000)),
  };
}
