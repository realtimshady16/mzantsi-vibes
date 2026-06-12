/* =============================================
   MZANTSI VIBES — mzantsi-vibes-script.js

   ✏️  CONTENT CONFIG
   All website copy lives in the CONTENT object
   below. Change any text here and it updates
   across the whole site automatically.
   No need to touch index.html or style.css.
   ============================================= */

const CONTENT = {

  /* ---- SITE-WIDE ---- */
  site: {
    name: 'Mzantsi Vibes',
    flag: '🇿🇦',
    githubUrl: 'https://github.com/realtimshady16/mzantsi-vibes',
    instagramUrl: 'https://www.instagram.com/mzantsivibes/',
    linkedinUrl: 'https://www.linkedin.com/company/mzantsi-vibes/',
    footerTagline: 'Built with ❤️ for South African youth. MIT licensed. Free forever.',
  },

  /* ---- HEADER ---- */
  header: {
    tasksLabel: 'Tasks',
    tasksUrl: '/tasks',
    allStarsLabel: 'All Stars',
    allStarsUrl: '/allstars',
    githubLabel: 'GitHub',
    contributeLabel: 'Contribute',
    contributeUrl: '/contribute',
  },

  /* ---- HERO ---- */
  hero: {
    eyebrow: 'Open source · Free · SA-built',
    titleLine1: 'The years after matric',
    titleEmphasis: 'nobody prepares you for.',
    subtitle: 'Resources for South African youth aged 18–25 — studying, working, or still figuring it out. No Western assumptions. No paywalls.',
  },

  /* ---- PATH SELECTOR ---- */
  paths: {
    label: 'Where are you right now?',
    study: {
      icon: '🎓',
      heading: "I'm going to study",
      description: 'University, bursaries, NSFAS, textbooks, life after your degree',
    },
    work: {
      icon: '💼',
      heading: "I'm going to work",
      description: 'CVs, learnerships, skills, starting something, your money',
    },
    unsure: {
      icon: '🤷',
      heading: "I don't know yet",
      description: "That's okay. Start here to understand your options",
    },
    everyone: {
      icon: '📋',
      heading: 'For everyone',
      description: 'Adulting, mental health, books, talks, staying healthy',
    },
  },

  /* ---- "I DON'T KNOW YET" SECTION ---- */
  unsure: {
    callout: "That's okay. Most people won't tell you that \"I don't know\" is the most honest answer a lot of 18-year-olds have — and it doesn't mean you're behind.",
    assessHeading: 'Three questions to help you decide',
    questions: [
      {
        text: 'Do you need to earn money soon, or do you have some time?',
        options: ['I need income soon', 'I have a few months', 'Not sure yet'],
      },
      {
        text: 'Do you have your matric certificate?',
        options: ['Yes', 'No', 'Writing this year'],
      },
      {
        text: 'Do you prefer working with people, things, or ideas?',
        options: ['People', 'Things / hands-on', 'Ideas / thinking', 'Honestly no idea'],
      },
    ],
    optionsHeading: 'Understanding your options',
    options: [
      {
        title: 'Studying',
        body: '3–4+ years committed to a qualification. Opens certain doors but costs time and money. University is not the only path to a good career.',
      },
      {
        title: 'Learnerships',
        body: 'Earn a stipend while learning on the job and come out with a qualification. Underused and underrated in South Africa.',
      },
      {
        title: 'Short courses',
        body: 'A few months to learn a skill — coding, design, bookkeeping — and start earning without committing to a 4-year degree.',
      },
      {
        title: 'Intentional gap time',
        body: 'Volunteering, building something, or getting work experience can be more valuable than rushing into a decision you\'re not ready for.',
      },
    ],
  },

  /* ---- CONTRIBUTE BANNER ---- */
  contribute: {
    heading: 'Know something that should be here?',
    body: "This is an open-source project. If you've found a resource that helped you, add it. No technical experience needed — we built a tool that makes it easy.",
    cta: 'Add a resource →',
    url: '/contribute',
  },

  /* ---- LOADING / ERROR STATES ---- */
  states: {
    loading: 'Loading resources...',
    errorMessage: "⚠️ Couldn't load resources right now.",
    errorLinkLabel: 'View them on GitHub instead',
    emptySection: 'Resources coming soon —',
    emptySectionLinkLabel: 'want to contribute?',
    emptySectionUrl: 'https://github.com/realtimshady16/mzantsi-vibes/blob/main/CONTRIBUTING.md',
    fallbackMessage: "Couldn't load resources.",
    fallbackLinkLabel: 'View on GitHub →',
  },

};

/* =============================================
   CONFIG — edit these if the repo moves
   ============================================= */

const README_URL = 'https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/README.md';

/* PILLAR_MARKERS — maps each site pillar to keywords that identify
   its ## heading in the README. Case-insensitive partial match.
   If you rename a pillar heading in the README, update the keyword here. */
const PILLAR_MARKERS = {
  study:    ["going to study"],
  work:     ["going to work"],
  unsure:   ["don't know", "dont know"],
  everyone: ["for everyone"],
};

/* STOP_HEADINGS — ## headings that are NOT pillars and should be skipped */
const STOP_HEADINGS = ["where are you", "contributing", "community", "contact"];

/* =============================================
   POPULATE — writes CONTENT into the HTML
   ============================================= */

function populateContent() {
  const c = CONTENT;

  /* Site name instances */
  document.querySelectorAll('[data-content="site.name"]').forEach(el => el.textContent = c.site.name);
  document.querySelectorAll('[data-content="site.flag"]').forEach(el => el.textContent = c.site.flag);

  /* Header */
  set('header-tasks-label', c.header.tasksLabel);
  attr('header-tasks-link', 'href', c.header.tasksUrl);
  set('header-allstars-label', c.header.allStarsLabel);
  attr('header-allstars-link', 'href', c.header.allStarsUrl);
  set('header-github-label', c.header.githubLabel);
  set('header-contribute-label', c.header.contributeLabel);
  attr('header-contribute-link', 'href', c.header.contributeUrl);
  attr('header-github-link', 'href', c.site.githubUrl);

  /* Hero */
  set('hero-eyebrow', c.hero.eyebrow);
  set('hero-title-line1', c.hero.titleLine1);
  set('hero-title-emphasis', c.hero.titleEmphasis);
  set('hero-subtitle', c.hero.subtitle);

  /* Path selector label */
  set('path-label', c.paths.label);

  /* Path cards */
  ['study', 'work', 'unsure', 'everyone'].forEach(key => {
    set(`path-icon-${key}`, c.paths[key].icon);
    set(`path-heading-${key}`, c.paths[key].heading);
    set(`path-desc-${key}`, c.paths[key].description);
  });

  /* "I don't know yet" section */
  set('unsure-callout', c.unsure.callout);
  set('unsure-assess-heading', c.unsure.assessHeading);

  /* Self-assessment questions */
  const questionsContainer = document.getElementById('unsure-questions');
  if (questionsContainer) {
    questionsContainer.innerHTML = c.unsure.questions.map(q => `
      <div class="question-group">
        <p class="question-text">${escHtml(q.text)}</p>
        <div class="pill-group">
          ${q.options.map(o => `<button class="pill" onclick="togglePill(this)">${escHtml(o)}</button>`).join('')}
        </div>
      </div>
    `).join('');
  }

  /* Options cards */
  set('unsure-options-heading', c.unsure.optionsHeading);
  const optionsContainer = document.getElementById('unsure-options');
  if (optionsContainer) {
    optionsContainer.innerHTML = c.unsure.options.map(o => `
      <div class="option-card">
        <div class="option-title">${escHtml(o.title)}</div>
        <p>${escHtml(o.body)}</p>
      </div>
    `).join('');
  }

  /* Contribute banner */
  set('contribute-heading', c.contribute.heading);
  set('contribute-body', c.contribute.body);
  set('contribute-cta', c.contribute.cta);
  attr('contribute-cta-link', 'href', c.contribute.url);

  /* Footer */
  document.querySelectorAll('[data-content="site.flag"]').forEach(el => el.textContent = c.site.flag);
  set('footer-tagline', c.site.footerTagline);
  attr('footer-github-link', 'href', c.site.githubUrl);
  attr('footer-instagram-link', 'href', c.site.instagramUrl);
  attr('footer-linkedin-link', 'href', c.site.linkedinUrl);
}

/* Helpers */
function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function attr(id, attribute, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute(attribute, value);
}
/* =============================================
   PARSER — README markdown → structured data
   Auto-discovers pillars and subsections from
   ## and ### headings. No hardcoded section list.
   New sections in the README appear automatically.
   ============================================= */

function stripMarkdown(str) {
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

function parseReadme(markdown) {
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
      const content = trimmed.replace(/^[-*]\s+/, '').trim();
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

        bucket.push({ name, url: links[0].url, desc });
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

/* =============================================
   RENDERER — structured data → HTML
   ============================================= */

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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderResourceList(resources) {
  if (!resources || resources.length === 0) return '';
  const items = resources.map(r => {
    const icon = iconFor(r.name, r.url);
    const descHtml = r.desc ? `<div class="resource-desc">${escHtml(r.desc)}</div>` : '';
    if (!r.url) {
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

function renderSection(targetId, pillarKey, parsedData) {
  const container = document.getElementById(targetId);
  if (!container) return;

  const { pillars, pillarOrder } = parsedData;
  const sections = pillars[pillarKey];
  const order = pillarOrder[pillarKey];
  const s = CONTENT.states;

  let html = '';
  let hasContent = false;

  order.forEach(sectionName => {
    const resources = sections[sectionName];
    if (!resources || resources.length === 0) return;
    hasContent = true;
    html += `<div class="subsection-label">${escHtml(sectionName)}</div>`;
    html += renderResourceList(resources);
  });

  container.innerHTML = hasContent
    ? html
    : `<p style="color: var(--text-muted); font-size: 0.9rem;">${escHtml(s.emptySection)} <a href="${s.emptySectionUrl}" target="_blank">${escHtml(s.emptySectionLinkLabel)}</a></p>`;
}

/* =============================================
   INTERACTIONS
   ============================================= */

function switchSection(sectionId, btn) {
  document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.path-card').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('section-' + sectionId);
  if (target) target.classList.remove('hidden');
  if (btn) btn.classList.add('active');
}

function togglePill(el) {
  el.classList.toggle('selected');
}

/* =============================================
   INIT
   ============================================= */

async function init() {
  populateContent();

  const loadingEl = document.getElementById('loading-state');
  const errorEl = document.getElementById('error-state');
  const s = CONTENT.states;

  try {
    const res = await fetch(README_URL, {
      headers: { 'Accept': 'text/plain, */*' },
      cache: 'no-cache',
    });
    if (!res.ok) throw new Error('Failed to fetch README');
    const markdown = await res.text();
    const parsed = parseReadme(markdown);

    renderSection('study-content',   'study',    parsed);
    renderSection('work-content',    'work',     parsed);
    renderSection('unsure-content',  'unsure',   parsed);
    renderSection('everyone-content','everyone', parsed);

    loadingEl.classList.add('hidden');
    document.getElementById('section-study').classList.remove('hidden');

  } catch (err) {
    console.error('Mzantsi Vibes: could not load README:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');

    document.getElementById('section-study').classList.remove('hidden');
    ['study-content', 'work-content', 'unsure-content', 'everyone-content'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">${escHtml(s.fallbackMessage)} <a href="${escHtml(CONTENT.site.githubUrl)}" target="_blank">${escHtml(s.fallbackLinkLabel)}</a></p>`;
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
