/**
 * Adding entries to OPPORTUNITIES.md.
 *
 * The file's pillars start empty, so readme.js's applyNew (which only knows a
 * pillar that already owns a `###` section) cannot be used. This inserts lines
 * under a pillar and section by name, creating the `###` section when it is not
 * there yet, and touches nothing else in the file.
 */

import { normalizeHeading, PatchError } from './readme.js';

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;

/** First index at or after `from` holding a heading of `level` or shallower. */
function endOfBlock(lines, from, level) {
  for (let i = from; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m && m[1].length <= level) return i;
  }
  return lines.length;
}

function findHeading(lines, level, name, from = 0, to = lines.length) {
  const key = normalizeHeading(name);
  for (let i = from; i < to; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m && m[1].length === level && normalizeHeading(m[2]) === key) return i;
  }
  return -1;
}

/** Index just after the last line with content in [from, to). */
function afterLastContent(lines, from, to) {
  let at = from;
  for (let i = from; i < to; i++) if (lines[i].trim() !== '') at = i + 1;
  return at;
}

/**
 * @param md        OPPORTUNITIES.md
 * @param additions [{ pillar, section, line }], in the order they should appear
 * @returns the new file text
 */
export function insertEntries(md, additions) {
  const lines = md.split('\n');
  const groups = new Map();
  for (const a of additions) {
    const key = `${a.pillar}\u0000${a.section}`;
    groups.set(key, { pillar: a.pillar, section: a.section, lines: [...(groups.get(key)?.lines || []), a.line] });
  }

  for (const { pillar, section, lines: add } of groups.values()) {
    const p = findHeading(lines, 2, pillar);
    if (p === -1) throw new PatchError(`OPPORTUNITIES.md has no "## ${pillar}" heading.`, 422);
    const pEnd = endOfBlock(lines, p + 1, 2);

    const s = findHeading(lines, 3, section, p + 1, pEnd);
    let at, block;
    if (s === -1) {
      at = afterLastContent(lines, p + 1, pEnd);
      block = ['', `### ${section}`, '', ...add];
    } else {
      at = afterLastContent(lines, s + 1, endOfBlock(lines, s + 1, 3));
      block = at === s + 1 ? ['', ...add] : add; // an empty section needs a blank line after its heading
    }
    lines.splice(at, 0, ...block);
    // Keep a blank line between what was added and whatever heading follows.
    const next = at + block.length;
    if (next < lines.length && lines[next].trim() !== '') lines.splice(next, 0, '');
  }

  return lines.join('\n');
}

/** Every link target in a markdown file, for spotting what is already listed. */
export function linkTargets(md) {
  return [...String(md).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}
