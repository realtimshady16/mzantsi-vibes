/**
 * The markdown parser, shared by the site (script.js) and the Worker's search
 * index (src/content-index.js), so what is searchable can never differ from what
 * is shown. Loaded as a module; it sets `globalThis.ContentParse` for the classic
 * script.js.
 *
 * Auto-discovers pillars and subsections from ## and ### headings. New sections
 * in the README appear automatically.
 */

import { splitEntryMeta, isHidden, todayInSA } from './entry-meta.js';

/* PILLAR_MARKERS — maps each site pillar to keywords that identify
   its ## heading in the README. Case-insensitive partial match.
   If you rename a pillar heading in the README, update the keyword here. */
export const PILLAR_MARKERS = {
  study:    ["going to study"],
  work:     ["going to work"],
  unsure:   ["don't know", "dont know"],
  everyone: ["for everyone"],
};

/* STOP_HEADINGS — ## headings that are NOT pillars and should be skipped */
export const STOP_HEADINGS = ["where are you", "contributing", "community", "contact"];


export function stripMarkdown(str) {
  return str
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\[#[^\]]*\]/g, '')
    .trim();
}

function cleanUrl(url) {
  return url.replace(/[.)]+$/, '').trim();
}

function isBareUrl(str) {
  return /^https?:\/\/\S+/.test(str.trim());
}

function identifyPillar(headingText) {
  const lower = headingText.toLowerCase();
  for (const [pillar, markers] of Object.entries(PILLAR_MARKERS)) {
    if (markers.some(m => lower.includes(m))) return pillar;
  }
  return null;
}

function isStopHeading(headingText) {
  const lower = headingText.toLowerCase();
  return STOP_HEADINGS.some(s => lower.includes(s));
}

export function parseReadme(markdown, today = todayInSA()) {
  const lines = markdown.split('\n');

  /* pillars holds ordered subsections per pillar.
     Each pillar is an object: { sectionName: [items] }
     We also keep an ordered list of section names so render order matches README order. */
  const pillars = { study: {}, work: {}, unsure: {}, everyone: {} };
  const pillarOrder = { study: [], work: [], unsure: [], everyone: [] };

  let currentPillar = null;
  let parentSection = null; // the ### heading (resets bold sub-label back to)
  let currentSection = null; // active bucket key

  const ensureSection = (pillar, key) => {
    if (!pillars[pillar][key]) {
      pillars[pillar][key] = [];
      pillarOrder[pillar].push(key);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed === '---') continue;

    /* ## heading — identifies a pillar or stops parsing */
    if (/^##\s/.test(trimmed)) {
      const heading = stripMarkdown(trimmed.replace(/^##\s*/, ''));
      if (isStopHeading(heading)) {
        currentPillar = null; parentSection = null; currentSection = null;
        continue;
      }
      const pillar = identifyPillar(heading);
      currentPillar = pillar || null;
      parentSection = null;
      currentSection = null;
      continue;
    }

    /* ### heading — subsection within the current pillar */
    if (/^###\s/.test(trimmed) && currentPillar) {
      const heading = stripMarkdown(trimmed.replace(/^###\s*/, ''));
      parentSection = heading;
      currentSection = heading;
      ensureSection(currentPillar, currentSection);
      continue;
    }

    /* **Bold label** on its own line — sub-group within the current ### section.
       Resets to parentSection so labels don't nest into each other. */
    if (/^\*\*[^*]+\*\*$/.test(trimmed) && currentPillar && parentSection) {
      const label = trimmed.replace(/\*\*/g, '').trim();
      currentSection = `${parentSection} — ${label}`;
      ensureSection(currentPillar, currentSection);
      continue;
    }

    if (!currentPillar || !currentSection) continue;
    const bucket = pillars[currentPillar][currentSection];

    /* List item with a link */
    if (/^[-*]\s/.test(trimmed) && trimmed.includes('[')) {
      /* Optional trailing {closes: …; tags: …} block — see entry-meta.js */
      const split = splitEntryMeta(trimmed.replace(/^[-*]\s+/, '').trim());
      const content = split.text;
      const meta = split.meta;
      if (isHidden(split, today)) {
        if (split.errors.length) console.warn('Mzantsi Vibes: hiding entry with bad metadata:', content, split.errors);
        continue;
      }
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      const links = [];
      while ((match = linkRegex.exec(content)) !== null) {
        links.push({ name: match[1].trim(), url: cleanUrl(match[2]) });
      }

      if (links.length > 0) {
        /* Name: replace link syntax with link text, then take everything before the — */
        const withText = content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        const namePart = withText.split(/\s[—–]\s/)[0].trim();
        const name = stripMarkdown(namePart) || links[0].name;

        /* Desc: everything after the — dash */
        const descMatch = content.match(/\s[—–]\s(.+)$/);
        const desc = descMatch ? stripMarkdown(descMatch[1]).trim() : '';

        bucket.push({ name, url: links[0].url, desc, meta });
      } else if (/coming soon/i.test(content)) {
        const name = stripMarkdown(
          content.replace(/\*?coming soon\*?/i, '').replace(/\s*[—–-].*/, '').trim()
        );
        bucket.push({ name: name || 'Coming soon', url: null, desc: 'Coming soon' });
      }
      continue;
    }

    /* List item without a link — coming soon entries */
    if (/^[-*]\s/.test(trimmed)) {
      const content = trimmed.replace(/^[-*]\s+/, '').trim();
      if (/coming soon/i.test(content)) {
        const name = stripMarkdown(
          content.replace(/\*?coming soon\*?/i, '').replace(/\s*[—–-].*/, '').trim()
        );
        bucket.push({ name: name || 'Coming soon', url: null, desc: 'Coming soon' });
      }
    }
  }

  return { pillars, pillarOrder };
}

/* Fold `extra` into `base`. A section with the same name joins that section
   (after the evergreen entries); a new name is added at the end of its pillar. */
export function mergeParsed(base, extra) {
  for (const pillar of Object.keys(extra.pillars)) {
    for (const name of extra.pillarOrder[pillar]) {
      if (!base.pillars[pillar][name]) {
        base.pillars[pillar][name] = [];
        base.pillarOrder[pillar].push(name);
      }
      base.pillars[pillar][name].push(...extra.pillars[pillar][name]);
    }
  }
}

globalThis.ContentParse = { parseReadme, mergeParsed, stripMarkdown, PILLAR_MARKERS, STOP_HEADINGS };
