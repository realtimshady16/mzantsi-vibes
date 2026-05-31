/* =============================================
   MZANTSI VIBES — script.js
   Fetches README from GitHub, parses markdown,
   renders resources into the four sections.
   ============================================= */

const README_URL = 'https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/README.md';

/* Map README section headings to site sections */
const SECTION_MAP = {
  study: [
    "I'm Going to Study",
    "Before You Apply",
    "Paying for It",
    "Getting There",
    "While You're There",
    "After Your Degree"
  ],
  work: [
    "I'm Going to Work",
    "Getting Work-Ready",
    "Finding Work",
    "Starting Something",
    "Understanding Your Money"
  ],
  unsure: [
    "I Don't Know Yet",
    "Things You Can Do Right Now",
    "Community Programmes"
  ],
  everyone: [
    "For Everyone",
    "How Do I Adult?",
    "Mental Health 101",
    "Being Healthy 101",
    "Book Summaries",
    "TED Talks & Speeches"
  ]
};

/* Icon map for resource types */
function iconFor(name, url) {
  const n = name.toLowerCase();
  const u = (url || '').toLowerCase();
  if (u.includes('youtube') || u.includes('youtu.be')) return '▶';
  if (n.includes('nsfas') || n.includes('bursari') || n.includes('fund') || n.includes('invest')) return '💰';
  if (n.includes('cv') || n.includes('writing')) return '📝';
  if (n.includes('code') || n.includes('coding') || n.includes('cs50') || n.includes('python') || n.includes('docker') || n.includes('webflow') || n.includes('bubble') || n.includes('flutter')) return '💻';
  if (n.includes('design') || n.includes('figma') || n.includes('canva')) return '🎨';
  if (n.includes('tax') || n.includes('sars')) return '📋';
  if (n.includes('textbook') || n.includes('library') || n.includes('book') || n.includes('siyavula')) return '📚';
  if (n.includes('mental') || n.includes('journal') || n.includes('anxiety') || n.includes('stress')) return '🧠';
  if (n.includes('health') || n.includes('workout')) return '💪';
  if (n.includes('internship') || n.includes('graduate') || n.includes('learner') || n.includes('job')) return '🏢';
  if (n.includes('nbt') || n.includes('benchmark')) return '📐';
  return '🔗';
}

/* -----------------------------------------------
   TURNDOWN/QUILL OUTPUT QUIRKS THIS PARSER HANDLES
   ------------------------------------------------
   1. Headings with bold markers: ## **Section Name**
      Turndown wraps heading text in ** when Quill
      applies bold formatting inside a heading node.
   2. Bare URLs on their own line after a list item:
      Quill sometimes separates link text and href,
      producing "- Resource Name\nhttps://url.com"
      instead of "- [Resource Name](https://url.com)"
   3. Extra blank lines between list items from Quill's
      paragraph wrapping — handled by skipping empties.
   4. Links with trailing punctuation inside parens:
      Turndown occasionally includes a trailing ) or .
      inside the URL capture group.
   5. Anchor fragments in headings: ## Heading [#anchor]
      The GitHub README renderer appends these; strip them.
   ----------------------------------------------- */

/* Strip all markdown formatting from a string,
   leaving only plain readable text */
function stripMarkdown(str) {
  return str
    .replace(/\*\*([^*]+)\*\*/g, '$1')   /* **bold** */
    .replace(/\*([^*]+)\*/g, '$1')        /* *italic* */
    .replace(/__([^_]+)__/g, '$1')        /* __bold__ */
    .replace(/_([^_]+)_/g, '$1')          /* _italic_ */
    .replace(/`([^`]+)`/g, '$1')          /* `code` */
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') /* [text](url) → text */
    .replace(/\s*\[#[^\]]*\]/g, '')       /* [#anchor] fragments */
    .trim();
}

/* Clean a URL — remove trailing punctuation that Turndown
   sometimes captures inside the parens */
function cleanUrl(url) {
  return url.replace(/[.)]+$/, '').trim();
}

/* Check whether a string looks like a bare URL */
function isBareUrl(str) {
  return /^https?:\/\/\S+/.test(str.trim());
}

/* Parse all markdown links from a line: [text](url) */
function parseLinks(line) {
  const results = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    results.push({ name: match[1].trim(), url: cleanUrl(match[2]) });
  }
  return results;
}

/* Parse README markdown into a structured object:
   { sectionName: [ { name, url, desc } ] }

   Handles both hand-written markdown and Turndown output
   from the GitTool contributor interface. */
function parseReadme(markdown) {
  const lines = markdown.split('\n');
  const sections = {};
  let currentSection = null;
  let lastResourceKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    /* Skip empty lines — Quill/Turndown adds extra blanks */
    if (!trimmed) {
      continue;
    }

    /* ---- HEADINGS (## and ###) ----
       Handle both clean headings and Turndown's bold-wrapped variant:
         ## Section Name          (hand-written)
         ## **Section Name**      (Turndown from Quill bold heading)
         ## Section Name [#anchor] (GitHub README anchor suffix) */
    if (/^#{2,4}\s/.test(trimmed)) {
      let heading = trimmed
        .replace(/^#+\s*/, '')           /* strip leading # chars */
        .replace(/\s*\[#[^\]]*\]/g, '') /* strip [#anchor] */
        .trim();
      heading = stripMarkdown(heading);  /* strip **bold** etc */

      if (heading) {
        currentSection = heading;
        if (!sections[currentSection]) sections[currentSection] = [];
        lastResourceKey = null;
      }
      continue;
    }

    if (!currentSection) continue;

    /* ---- LIST ITEMS with markdown links ----
       Standard: - [Name](url) — description
       Turndown: - [Name](url)\n  description on next line */
    if (/^[-*]\s/.test(trimmed) && trimmed.includes('[')) {
      const content = trimmed.replace(/^[-*]\s+/, '').trim();
      const links = parseLinks(content);

      if (links.length > 0) {
        /* Build display name from full line, stripping link syntax */
        const rawName = content
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') /* keep link text */
          .replace(/\s*[-–—]\s*/g, ' ')             /* clean separators */
          .trim();
        const name = stripMarkdown(rawName) || links[0].name;

        const item = { name, url: links[0].url, desc: '' };
        sections[currentSection].push(item);
        lastResourceKey = sections[currentSection].length - 1;

        /* Look ahead for a description on the very next non-empty line
           (Turndown indented continuation or plain paragraph) */
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          const next = lines[j].trim();
          if (!next) continue; /* skip blanks */
          /* Stop if it's another list item, heading, or link */
          if (/^[-*#]/.test(next) || isBareUrl(next) || next.includes('](')) break;
          /* It's a description */
          item.desc = stripMarkdown(next);
          i = j;
          break;
        }
      } else if (/coming soon/i.test(trimmed)) {
        /* Placeholder item with no link yet */
        const name = stripMarkdown(content.replace(/^[-*]\s*/, '').replace(/\*coming soon\*/i, '').trim());
        sections[currentSection].push({ name, url: null, desc: 'Coming soon' });
        lastResourceKey = null;
      }
      continue;
    }

    /* ---- BARE URL on its own line (Turndown quirk) ----
       When Quill separates link text and URL, Turndown outputs:
         - Resource Name
         https://example.com
       We attach the URL to the last resource that has no URL yet. */
    if (isBareUrl(trimmed) && lastResourceKey !== null) {
      const lastItem = sections[currentSection][lastResourceKey];
      if (lastItem && !lastItem.url) {
        lastItem.url = cleanUrl(trimmed);
      }
      continue;
    }

    /* ---- INLINE DESCRIPTION (#### Description pattern) ----
       Old README format — keep supporting it for backwards compat */
    if (/^#{4,5}\s*Description/i.test(trimmed)) {
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const descLine = lines[j].trim();
        if (descLine && !descLine.startsWith('#')) {
          if (lastResourceKey !== null && sections[currentSection][lastResourceKey]) {
            sections[currentSection][lastResourceKey].desc = stripMarkdown(descLine);
          }
          i = j;
          break;
        }
      }
      continue;
    }

    /* ---- PLAIN LIST ITEM with no link (e.g. "- Coming soon") ---- */
    if (/^[-*]\s/.test(trimmed) && !trimmed.includes('[')) {
      const content = trimmed.replace(/^[-*]\s+/, '').trim();
      if (/coming soon/i.test(content)) {
        sections[currentSection].push({
          name: stripMarkdown(content.replace(/\*?coming soon\*?/i, '').trim()) || 'Coming soon',
          url: null,
          desc: 'Coming soon'
        });
        lastResourceKey = null;
      }
      /* Other plain list items (sub-headings, notes) are skipped */
    }
  }

  return sections;
}

/* Render a list of resources as HTML */
function renderResourceList(resources, sectionTitle) {
  if (!resources || resources.length === 0) return '';

  const items = resources.map(r => {
    const icon = iconFor(r.name, r.url);
    const descHtml = r.desc ? `<div class="resource-desc">${escHtml(r.desc)}</div>` : '';

    if (!r.url || r.url === null) {
      return `
        <div class="resource-item coming-soon">
          <div class="resource-icon">${icon}</div>
          <div class="resource-text">
            <div class="resource-name">${escHtml(r.name)}</div>
            ${descHtml || '<div class="resource-desc">Coming soon</div>'}
          </div>
        </div>`;
    }

    return `
      <a class="resource-item" href="${escHtml(r.url)}" target="_blank" rel="noopener">
        <div class="resource-icon">${icon}</div>
        <div class="resource-text">
          <div class="resource-name">${escHtml(r.name)}</div>
          ${descHtml}
        </div>
        <div class="resource-arrow">↗</div>
      </a>`;
  }).join('');

  return `<div class="resource-list">${items}</div>`;
}

/* Escape HTML special chars */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Render a full section from parsed data */
function renderSection(targetId, headingKeys, parsedData) {
  const container = document.getElementById(targetId);
  if (!container) return;

  let html = '';
  let hasContent = false;

  headingKeys.forEach(key => {
    /* Try exact match first, then case-insensitive */
    let resources = parsedData[key];
    if (!resources) {
      const lkey = key.toLowerCase();
      const found = Object.keys(parsedData).find(k => k.toLowerCase() === lkey);
      if (found) resources = parsedData[found];
    }
    if (!resources || resources.length === 0) return;

    hasContent = true;
    html += `<div class="subsection-label">${escHtml(key)}</div>`;
    html += renderResourceList(resources, key);
  });

  container.innerHTML = hasContent
    ? html
    : '<p style="color: var(--text-muted); font-size: 0.9rem;">Resources coming soon — <a href="https://github.com/realtimshady16/mzantsi-vibes/blob/main/CONTRIBUTING.md" target="_blank">want to contribute?</a></p>';
}

/* Switch visible section */
function switchSection(sectionId, btn) {
  document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.path-card').forEach(el => el.classList.remove('active'));

  const target = document.getElementById('section-' + sectionId);
  if (target) target.classList.remove('hidden');
  if (btn) btn.classList.add('active');
}

/* Toggle pill selection */
function togglePill(el) {
  el.classList.toggle('selected');
}

/* Main init */
async function init() {
  const loadingEl = document.getElementById('loading-state');
  const errorEl = document.getElementById('error-state');

  try {
    const res = await fetch(README_URL);
    if (!res.ok) throw new Error('Failed to fetch README');
    const markdown = await res.text();
    const parsed = parseReadme(markdown);

    /* Render each section */
    renderSection('study-content', SECTION_MAP.study, parsed);
    renderSection('work-content', SECTION_MAP.work, parsed);
    renderSection('unsure-content', SECTION_MAP.unsure, parsed);
    renderSection('everyone-content', SECTION_MAP.everyone, parsed);

    /* Hide loader, show first section */
    loadingEl.classList.add('hidden');
    document.getElementById('section-study').classList.remove('hidden');

  } catch (err) {
    console.error('Mzantsi Vibes: could not load README:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');

    /* Still show sections with fallback empty state */
    document.getElementById('section-study').classList.remove('hidden');
    ['study-content', 'work-content', 'unsure-content', 'everyone-content'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Couldn\'t load resources. <a href="https://github.com/realtimshady16/mzantsi-vibes" target="_blank">View on GitHub →</a></p>';
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
