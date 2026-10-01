/**
 * Mzantsi Vibes — Worker entry.
 *
 * One Worker does three jobs:
 *   1. serves the static site out of PUBLISH
 *   2. exposes the contribute API (/api/sections, /api/submit) and the signed
 *      review endpoint (/action)
 *   3. runs three crons: morning digest, evening batch merge, and the weekly
 *      opportunity digest (a GitHub issue of leads — see opportunities.js)
 */

import { readConfig, rateLimit, CRON_DIGEST, CRON_MERGE, CRON_OPPS } from './config.js';
import { github } from './github.js';
import { sectionOptions, PatchError } from './readme.js';
import { handleSubmit } from './submit.js';
import { handleAction } from './action.js';
import { runDigest, runBatchMerge } from './cron.js';
import { runOpportunityDigest } from './opportunities.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Best-effort client IP for the rate limiter. */
function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/* ------------------------------------------------------------------ *
 * Deliverable 1 support — the form needs to know the real section list
 * so its dropdown can never drift from the README.
 * ------------------------------------------------------------------ */
async function handleSections({ config, gh }) {
  const readme = await gh.getReadme(config.owner, config.repo);
  return json({ ok: true, groups: sectionOptions(readme.content) });
}

/* ------------------------------------------------------------------ *
 * Deliverable 2 — the POST endpoint
 * ------------------------------------------------------------------ */
async function handleSubmitRequest({ request, config, gh }) {
  const limit = rateLimit(clientKey(request), config.rateLimit);
  if (!limit.ok) {
    return json(
      {
        ok: false,
        error:
          `That's a few submissions in a short time. ` +
          `Please try again in ${limit.retryAfterMin} minute${limit.retryAfterMin === 1 ? '' : 's'}.`,
      },
      429
    );
  }

  // Honeypot. Real users never see this field, so anything in it is a bot.
  // Answer as if it worked so the bot gets no signal.
  const raw = await request.clone().text().catch(() => '');
  if (/"website"\s*:\s*"[^"]+"/.test(raw)) {
    return json({ ok: true, prUrl: null, prNumber: null });
  }

  try {
    const result = await handleSubmit({ request, config, gh });
    return json(result, 201);
  } catch (err) {
    if (err instanceof PatchError) {
      return json({ ok: false, error: err.message }, err.status || 400);
    }
    // Anything unexpected: log it for the Worker tail, keep the message generic.
    console.error('submit failed:', err?.stack || err);
    return json(
      { ok: false, error: 'Something went wrong on our side. Please try again shortly.' },
      502
    );
  }
}

/* ------------------------------------------------------------------ *
 * Request routing
 * ------------------------------------------------------------------ */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API + action are same-origin (the form is served from here), so no CORS
    // headers are needed and none are added.
    if (url.pathname === '/api/sections' && request.method === 'GET') {
      try {
        const config = readConfig(env);
        return await handleSections({ config, gh: github(config.githubAuth) });
      } catch (err) {
        console.error('sections failed:', err?.stack || err);
        return json({ ok: false, error: 'Could not load the section list.' }, 502);
      }
    }

    if (url.pathname === '/api/submit') {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Use POST.' }, 405);
      }
      try {
        const config = readConfig(env);
        return await handleSubmitRequest({ request, config, gh: github(config.githubAuth) });
      } catch (err) {
        console.error('submit config failed:', err?.stack || err);
        return json({ ok: false, error: 'The contribute form is not configured yet.' }, 500);
      }
    }

    if (url.pathname === '/action') {
      try {
        const config = readConfig(env);
        return await handleAction({ request, config, gh: github(config.githubAuth), url });
      } catch (err) {
        console.error('action failed:', err?.stack || err);
        return new Response('Something went wrong.', { status: 500 });
      }
    }

    // Health check that never touches secrets.
    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'mzantsi-vibes' });
    }

    // Everything else is the static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Not found', { status: 404 });
  },

  /**
   * Three crons, distinguished by their schedule string. Each one is allowed to
   * fail loudly in the tail — that log is the only place a broken digest shows
   * up, so swallow nothing.
   */
  async scheduled(event, env, ctx) {
    const config = readConfig(env);
    const gh = github(config.githubAuth);

    if (event.cron === CRON_DIGEST) {
      ctx.waitUntil(
        runDigest({ config, gh })
          .then((r) => console.log('digest:', JSON.stringify(r)))
          .catch((e) => console.error('digest failed:', e?.stack || e))
      );
      return;
    }

    if (event.cron === CRON_MERGE) {
      ctx.waitUntil(
        runBatchMerge({ config, gh })
          .then((r) => console.log('batch merge:', JSON.stringify(r)))
          .catch((e) => console.error('batch merge failed:', e?.stack || e))
      );
      return;
    }

    if (event.cron === CRON_OPPS) {
      ctx.waitUntil(
        runOpportunityDigest({ config, gh })
          .then((r) => console.log('opportunity digest:', JSON.stringify({ ...r, body: undefined })))
          .catch((e) => console.error('opportunity digest failed:', e?.stack || e))
      );
      return;
    }

    console.warn('unrecognised cron trigger:', event.cron);
  },
};
