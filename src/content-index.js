/**
 * The search index: every linked resource from README.md and OPPORTUNITIES.md as
 * one JSON document, served at /api/index.json.
 *
 * It is built with the same parser the site renders from (PUBLISH/content-parse.js),
 * so a result can never differ from what the cards show. Expired entries are
 * dropped here, and the page checks `closes` again on every search, because a
 * cached copy (5 minutes) or an open tab can outlive a deadline.
 *
 * Reads the public raw files, not the GitHub API: no secrets, no App token and no
 * API rate limit, so the index keeps working if the contribute system is down.
 */

import { parseReadme, mergeParsed } from '../PUBLISH/content-parse.js';
import { todayInSA } from '../PUBLISH/entry-meta.js';

export const INDEX_TTL_SECONDS = 300;

const PILLARS = ['study', 'work', 'unsure', 'everyone'];

function tagged(parsed, kind) {
  for (const pillar of PILLARS) {
    for (const list of Object.values(parsed.pillars[pillar])) list.forEach((e) => (e.kind = kind));
  }
  return parsed;
}

/** Build the index from the two files' text. `opportunities` may be empty. */
export function buildIndex({ readme, opportunities = '' }, today = todayInSA(), now = new Date()) {
  const parsed = tagged(parseReadme(readme, today), 'evergreen');
  if (opportunities) mergeParsed(parsed, tagged(parseReadme(opportunities, today), 'current'));

  const entries = [];
  for (const pillar of PILLARS) {
    for (const section of parsed.pillarOrder[pillar]) {
      for (const e of parsed.pillars[pillar][section]) {
        if (!e.url) continue; // "coming soon" placeholders are not results
        const m = e.meta || {};
        entries.push({
          name: e.name,
          url: e.url,
          desc: e.desc,
          pillar,
          section,
          kind: e.kind,
          ...(m.closes && { closes: m.closes }),
          ...(m.updated && { updated: m.updated }),
          ...(m.tags && { tags: m.tags }),
          ...(m.source && { source: m.source }),
        });
      }
    }
  }

  const counts = new Map();
  for (const e of entries) for (const t of e.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return { generatedAt: now.toISOString(), entries, tags };
}

/** Fetch both files from `main`. The opportunities file is optional (404 = none yet). */
export async function fetchSources({ owner, repo }, fetchFn = fetch) {
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/main/`;
  const get = (file) => fetchFn(base + file, { headers: { Accept: 'text/plain' } });

  const [r, o] = await Promise.all([get('README.md'), get('OPPORTUNITIES.md')]);
  if (!r.ok) throw new Error(`README.md: GitHub returned ${r.status}`);
  if (!o.ok && o.status !== 404) throw new Error(`OPPORTUNITIES.md: GitHub returned ${o.status}`);
  return { readme: await r.text(), opportunities: o.ok ? await o.text() : '' };
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * GET /api/index.json. Cached for INDEX_TTL_SECONDS in the edge cache, so GitHub
 * is read at most about once every five minutes however busy the site is.
 * `cache` and `fetchFn` are injectable for the tests.
 */
export async function handleIndex(request, env, ctx, { cache = globalThis.caches?.default, fetchFn = fetch } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(JSON.stringify({ ok: false, error: 'Use GET or HEAD.' }), { status: 405, headers: JSON_HEADERS });

  const key = new Request(new URL(request.url).origin + '/api/index.json');
  const hit = cache && (await cache.match(key));
  if (hit) return hit;

  try {
    const sources = await fetchSources({ owner: env.REPO_OWNER || 'realtimshady16', repo: env.REPO_NAME || 'mzantsi-vibes' }, fetchFn);
    const res = new Response(JSON.stringify({ ok: true, ...buildIndex(sources) }), {
      headers: { ...JSON_HEADERS, 'Cache-Control': `public, max-age=${INDEX_TTL_SECONDS}, s-maxage=${INDEX_TTL_SECONDS}` },
    });
    if (cache) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (err) {
    console.error('index failed:', err?.stack || err);
    return new Response(JSON.stringify({ ok: false, error: 'Could not build the search index.' }), { status: 502, headers: JSON_HEADERS });
  }
}
