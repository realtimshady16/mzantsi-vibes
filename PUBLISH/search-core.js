/**
 * Search over the index from /api/index.json. Pure functions, no DOM, so the
 * ranking can be tested in Node. Sets `globalThis.SearchCore` for script.js.
 *
 * Every word typed has to match somewhere (name, description, section, tags or
 * source); a word in the name counts most. Entries whose `closes` date has
 * passed are dropped here as well as in the index, because a cached copy or a
 * tab left open can outlive a deadline.
 */

import { todayInSA } from './entry-meta.js';

export const MAX_RESULTS = 60;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

function scoreEntry(e, words) {
  const name = norm(e.name), section = norm(e.section), desc = norm(e.desc);
  const tags = (e.tags || []).map(norm), source = norm(e.source);
  let score = 0;
  for (const w of words) {
    let s = 0;
    if (name.startsWith(w)) s = 5;
    else if (name.includes(w)) s = 4;
    else if (tags.includes(w)) s = 3;
    else if (section.includes(w) || tags.some((t) => t.includes(w))) s = 2;
    else if (desc.includes(w) || source.includes(w)) s = 1;
    if (!s) return 0; // every word must match
    score += s;
  }
  return score;
}

/**
 * @param entries the index's `entries`
 * @param opts    { query, pillar, tags } — all optional; `tags` must ALL match
 * @returns matching entries, best first, at most MAX_RESULTS
 */
export function search(entries, { query = '', pillar = null, tags = [] } = {}, today = todayInSA()) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const wantTags = tags.map(norm);
  const out = [];

  entries.forEach((e, index) => {
    if (e.closes && e.closes < today) return;
    if (pillar && e.pillar !== pillar) return;
    if (wantTags.length) {
      const have = (e.tags || []).map(norm);
      if (!wantTags.every((t) => have.includes(t))) return;
    }
    const score = words.length ? scoreEntry(e, words) : 1;
    if (score) out.push({ e, score, index });
  });

  out.sort((a, b) =>
    b.score - a.score ||
    // Time-sensitive first, soonest deadline first.
    (b.e.kind === 'current') - (a.e.kind === 'current') ||
    (a.e.closes || '9999').localeCompare(b.e.closes || '9999') ||
    a.index - b.index
  );
  return out.slice(0, MAX_RESULTS).map((x) => x.e);
}

globalThis.SearchCore = { search, MAX_RESULTS };
