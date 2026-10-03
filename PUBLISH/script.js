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
    flag: '',
    githubUrl: 'https://github.com/realtimshady16/mzantsi-vibes',
    instagramUrl: 'https://www.instagram.com/mzantsivibes/',
    linkedinUrl: 'https://www.linkedin.com/company/mzantsi-vibes/',
    footerTagline: 'Built for South African youth. MIT licensed. Free forever.',
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

const RAW_BASE = 'https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/';
const README_URL = RAW_BASE + 'README.md';
/* Time-sensitive entries (bursary deadlines, vac work) live in their own file
   so a stale one can be dropped by date. Same ##/### structure as the README. */
const OPPORTUNITIES_URL = RAW_BASE + 'OPPORTUNITIES.md';

/* Under scripts/preview.mjs (127.0.0.1) read the working copy instead of
   GitHub, so a content or parser change can be seen before it is merged. */
const LOCAL_DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
const sourceUrl = (githubUrl, file) => (LOCAL_DEV ? `/__content/${file}` : githubUrl);

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
   RENDERER — structured data → HTML
   ============================================= */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SOON_DAYS = 14;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* "Closes 30 Nov 2026", or "Closes today"; peach once it is within two weeks. */
function deadlineBadge(meta) {
  if (!meta || !meta.closes) return '';
  const days = EntryMeta.daysBetween(EntryMeta.todayInSA(), meta.closes);
  const [y, m, d] = meta.closes.split('-').map(Number);
  const label = days === 0 ? 'Closes today' : `Closes ${d} ${MONTHS[m - 1]} ${y}`;
  return `<span class="res-deadline${days <= SOON_DAYS ? ' soon' : ''}">${escHtml(label)}</span>`;
}

/* Each README ### section becomes a pastel card. The order below is the design's:
   lilac, peach, butter, sage, blush, then round again. */
const SECTION_TONES = ['lilac', 'peach', 'butter', 'sage', 'blush'];

function renderRow(r) {
  const desc = r.desc ? `<div class="res-desc">${escHtml(r.desc)}</div>` : '';

  /* No link yet: a "coming soon" placeholder, shown dimmed and not clickable. */
  if (!r.url) {
    return `
      <div class="res-row soon">
        <div>
          <div class="res-name">${escHtml(r.name)}</div>
          ${desc || '<div class="res-desc">Coming soon</div>'}
        </div>
        <div class="res-arrow" aria-hidden="true">↗</div>
      </div>`;
  }

  return `
    <a class="res-row" href="${escHtml(r.url)}" target="_blank" rel="noopener">
      <div>
        <div class="res-name">${escHtml(r.name)}</div>
        ${desc}
        ${deadlineBadge(r.meta)}
      </div>
      <div class="res-arrow" aria-hidden="true">↗</div>
    </a>`;
}

function renderSection(targetId, pillarKey, parsedData) {
  const container = document.getElementById(targetId);
  if (!container) return;

  const { pillars, pillarOrder } = parsedData;
  const sections = pillars[pillarKey];
  const order = pillarOrder[pillarKey];
  const s = CONTENT.states;

  const cards = [];
  order.forEach(sectionName => {
    const resources = sections[sectionName];
    if (!resources || resources.length === 0) return;
    const tone = SECTION_TONES[cards.length % SECTION_TONES.length];
    cards.push(`
      <section class="res-card tone-${tone}">
        <h3>${escHtml(sectionName)}</h3>
        <div class="res-rows">${resources.map(renderRow).join('')}</div>
      </section>`);
  });

  container.innerHTML = cards.length
    ? `<div class="res-grid">${cards.join('')}</div>`
    : `<p class="res-empty">${escHtml(s.emptySection)} <a href="${escHtml(s.emptySectionUrl)}" target="_blank" rel="noopener">${escHtml(s.emptySectionLinkLabel)}</a></p>`;
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
    const res = await fetch(sourceUrl(README_URL, 'README.md'), {
      headers: { 'Accept': 'text/plain, */*' },
      cache: 'no-cache',
    });
    if (!res.ok) throw new Error('Failed to fetch README');
    const parsed = ContentParse.parseReadme(await res.text());

    /* The opportunities file is optional: if it is missing or down, the
       evergreen content still renders. */
    try {
      const opp = await fetch(sourceUrl(OPPORTUNITIES_URL, 'OPPORTUNITIES.md'), {
        headers: { 'Accept': 'text/plain, */*' },
        cache: 'no-cache',
      });
      if (opp.ok) ContentParse.mergeParsed(parsed, ContentParse.parseReadme(await opp.text()));
    } catch (err) {
      console.warn('Mzantsi Vibes: could not load OPPORTUNITIES.md:', err);
    }

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
      if (el) el.innerHTML = `<p class="res-empty">${escHtml(s.fallbackMessage)} <a href="${escHtml(CONTENT.site.githubUrl)}" target="_blank" rel="noopener">${escHtml(s.fallbackLinkLabel)}</a></p>`;
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
