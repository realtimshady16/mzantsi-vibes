/**
 * Entry metadata: the optional `{key: value; key: value}` block at the end of a
 * resource line.
 *
 *   -   [Funza Lushaka](https://…) — Teaching bursary. {closes: 2026-11-30; tags: bursary, deadline}
 *
 * One file, two readers. The site loads it as a module (it sets
 * `globalThis.EntryMeta` for the classic script.js) and the Worker imports it
 * from src/readme.js to reject malformed blocks on submission. Keeping a single
 * parser means the site and the form can never disagree about what is valid.
 *
 * Fail closed: a block that names `closes` but gives a date we cannot read is
 * reported as an error, and the site hides that entry. A deadline we cannot
 * check is worse than a missing entry.
 */

export const META_KEYS = ['closes', 'updated', 'tags', 'source'];

const META_AT_END_RE = /\s+\{([^{}]*)\}\s*$/;
// Only a block that opens like `{key:` is metadata. Any other trailing braces
// are left in the description.
const META_OPENS_RE = /^\s*[a-z][a-z-]*\s*:/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SOURCE = 80;
const MAX_TAGS = 8;

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
export function isValidDate(s) {
  const m = DATE_RE.exec(String(s));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Split a resource line's content into its visible text and its metadata.
 * Returns `{ text, meta, errors }`: `meta` is null when there is no block,
 * `errors` lists everything wrong with a block that is there.
 */
export function splitEntryMeta(content) {
  const str = String(content ?? '');
  const hit = META_AT_END_RE.exec(str);
  if (!hit || !META_OPENS_RE.test(hit[1])) return { text: str.trim(), meta: null, errors: [] };

  const text = str.slice(0, hit.index).trim();
  const meta = {};
  const errors = [];

  for (const part of hit[1].split(';')) {
    if (!part.trim()) continue;
    const colon = part.indexOf(':');
    const key = (colon === -1 ? part : part.slice(0, colon)).trim().toLowerCase();
    const value = colon === -1 ? '' : part.slice(colon + 1).trim();

    if (!META_KEYS.includes(key)) {
      errors.push(`Unknown field "${key}". Use ${META_KEYS.join(', ')}.`);
      continue;
    }
    if (key in meta) {
      errors.push(`"${key}" appears twice.`);
      continue;
    }

    if (key === 'closes' || key === 'updated') {
      if (isValidDate(value)) meta[key] = value;
      else errors.push(`"${key}" must be a real date written YYYY-MM-DD (got "${value}").`);
    } else if (key === 'tags') {
      const tags = value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      const bad = tags.find((t) => !TAG_RE.test(t));
      if (bad) errors.push(`Tag "${bad}" must be lowercase letters, numbers and hyphens.`);
      else if (!tags.length) errors.push('"tags" is empty.');
      else if (tags.length > MAX_TAGS) errors.push(`Use at most ${MAX_TAGS} tags.`);
      else meta.tags = [...new Set(tags)];
    } else if (key === 'source') {
      if (!value) errors.push('"source" is empty.');
      else if (value.length > MAX_SOURCE) errors.push(`"source" is too long (max ${MAX_SOURCE} characters).`);
      else meta.source = value;
    }
  }

  return { text, meta, errors };
}

/** Today's date in South Africa (UTC+2, no DST) as YYYY-MM-DD. */
export function todayInSA(now = new Date()) {
  return new Date(now.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Whole days from `today` to `date`; negative once `date` has passed. */
export function daysBetween(today, date) {
  const ms = (s) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((ms(date) - ms(today)) / 86400000);
}

/**
 * Should the site hide this entry? A closing date stays visible all of that
 * day. A block that tried to give a date and failed hides the entry (see the
 * file header).
 */
export function isHidden({ meta, errors } = {}, today = todayInSA()) {
  if ((errors || []).some((e) => e.startsWith('"closes"'))) return true;
  return Boolean(meta && meta.closes && meta.closes < today);
}

globalThis.EntryMeta = { splitEntryMeta, isHidden, todayInSA, daysBetween, isValidDate, META_KEYS };
