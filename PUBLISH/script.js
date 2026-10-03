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

  /* ---- DEADLINE DISCLAIMER (shown only where a deadline is) ---- */
  notes: {
    deadlines: "Dates come from each organisation's own page and can change or be extended. Always check the official page before you apply, and don't treat this site as your only source.",
  },

  /* ---- SEARCH ---- */
  search: {
    label: 'Search the guide',
    placeholder: 'Try "bursary", "CV" or "NSFAS"',
    clear: 'Clear search',
    filtersLabel: 'Filter results',
    tagsLabel: 'Tags',
    results: (n) => `${n} result${n === 1 ? '' : 's'}`,
    capped: (n) => `Showing the first ${n}. Add a word to narrow it down.`,
    empty: 'Nothing matched. Try fewer words, or clear the filters.',
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
  const crumb = r.crumb ? `<div class="res-crumb">${escHtml(r.crumb)}</div>` : '';

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
        ${crumb}
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
  clearSearch();
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
    showDeadlineNote('deadline-note', document.querySelector('.main-content'));

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

/* =============================================
   SEARCH — over /api/index.json (see src/content-index.js)
   The box stays hidden if the index cannot be loaded.
   ============================================= */

const searchState = { entries: [], pillar: null, tags: new Set(), timer: null };
const PILLAR_KEYS = ['study', 'work', 'unsure', 'everyone'];

/* The disclaimer only appears next to a deadline, so a page with none stays clean. */
function showDeadlineNote(id, scope) {
  const note = document.getElementById(id);
  if (!note) return;
  note.textContent = CONTENT.notes.deadlines;
  note.classList.toggle('hidden', !(scope && scope.querySelector('.res-deadline')));
}

function pillarLabel(key) {
  return CONTENT.paths[key].heading;
}

function chip(label, attrs, pressed) {
  return `<button type="button" class="chip" ${attrs} aria-pressed="${pressed}">${escHtml(label)}</button>`;
}

function renderChips(tags) {
  const c = CONTENT.search;
  const pillars = PILLAR_KEYS.map(k => chip(pillarLabel(k), `data-pillar="${k}"`, searchState.pillar === k)).join('');
  const tagChips = tags.length
    ? `<span class="chip-group-label">${escHtml(c.tagsLabel)}</span>` +
      tags.map(t => chip(t.tag, `data-tag="${escHtml(t.tag)}"`, searchState.tags.has(t.tag))).join('')
    : '';
  document.getElementById('search-chips').innerHTML = pillars + tagChips;
}

function runSearch() {
  const query = document.getElementById('search-input').value;
  const { pillar, tags } = searchState;
  const active = query.trim() || pillar || tags.size;
  const main = document.querySelector('.main-content');
  const out = document.getElementById('search-results');
  const status = document.getElementById('search-status');
  document.getElementById('search-clear').classList.toggle('hidden', !active);

  if (!active) {
    out.innerHTML = '';
    status.textContent = '';
    main.classList.remove('hidden');
    showDeadlineNote('search-deadline-note', null);
    return;
  }

  const hits = SearchCore.search(searchState.entries, { query, pillar, tags: [...tags] });
  const c = CONTENT.search;
  main.classList.add('hidden');
  status.textContent = hits.length ? c.results(hits.length) + (hits.length >= SearchCore.MAX_RESULTS ? '. ' + c.capped(SearchCore.MAX_RESULTS) : '') : '';
  out.innerHTML = hits.length
    ? `<section class="res-card tone-butter"><div class="res-rows">${hits.map(e => renderRow({
        name: e.name, url: e.url, desc: e.desc,
        meta: e.closes ? { closes: e.closes } : null,
        crumb: `${pillarLabel(e.pillar)} › ${e.section}`,
      })).join('')}</div></section>`
    : `<p class="res-empty">${escHtml(c.empty)}</p>`;
  showDeadlineNote('search-deadline-note', out);
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.value = '';
  searchState.pillar = null;
  searchState.tags.clear();
  if (searchState.entries.length) {
    document.querySelectorAll('#search-chips .chip').forEach(b => b.setAttribute('aria-pressed', 'false'));
    runSearch();
  }
}

async function initSearch() {
  const c = CONTENT.search;
  try {
    const res = await fetch('/api/index.json', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`index ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.entries)) throw new Error('bad index');
    searchState.entries = data.entries;

    set('search-label', c.label);
    attr('search-input', 'placeholder', c.placeholder);
    attr('search-clear', 'aria-label', c.clear);
    set('search-clear', c.clear);
    attr('search-chips', 'aria-label', c.filtersLabel);
    renderChips(data.tags || []);

    document.getElementById('search-input').addEventListener('input', () => {
      clearTimeout(searchState.timer);
      searchState.timer = setTimeout(runSearch, 120);
    });
    document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });
    document.getElementById('search-form').addEventListener('submit', e => { e.preventDefault(); runSearch(); });
    document.getElementById('search-clear').addEventListener('click', clearSearch);
    document.getElementById('search-chips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      if (b.dataset.pillar) searchState.pillar = searchState.pillar === b.dataset.pillar ? null : b.dataset.pillar;
      else if (searchState.tags.has(b.dataset.tag)) searchState.tags.delete(b.dataset.tag);
      else searchState.tags.add(b.dataset.tag);
      renderChips(data.tags || []);
      runSearch();
    });

    document.getElementById('search').classList.remove('hidden');
  } catch (err) {
    console.warn('Mzantsi Vibes: search unavailable:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => { init().then(initSearch); });
