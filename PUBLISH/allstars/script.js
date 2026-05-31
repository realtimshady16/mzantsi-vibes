/* =============================================
   MZANTSI VIBES — allstars-script.js
   Fetches GitHub contributors via API and
   community contributors from ALL-STARS.md
   ============================================= */

const GITHUB_API_URL   = 'https://api.github.com/repos/realtimshady16/mzantsi-vibes/contributors';
const ALL_STARS_URL    = 'https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/ALL-STARS.md';
const GITHUB_REPO_URL  = 'https://github.com/realtimshady16/mzantsi-vibes';

/* ---- GITHUB CONTRIBUTORS ---- */

async function loadGithubContributors() {
  const loadingEl = document.getElementById('github-loading');
  const errorEl   = document.getElementById('github-error');
  const gridEl    = document.getElementById('github-contributors');

  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error('GitHub API error');
    const contributors = await res.json();

    /* Filter out bots */
    const humans = contributors.filter(c => c.type !== 'Bot' && !c.login.includes('[bot]'));

    if (humans.length === 0) {
      loadingEl.classList.add('hidden');
      gridEl.innerHTML = `<p class="empty-note">No contributors yet — <a href="/contribute">be the first</a>.</p>`;
      return;
    }

    const cards = humans.map(c => `
      <a class="contributor-card" href="${escHtml(c.html_url)}" target="_blank" rel="noopener">
        <div class="contributor-avatar-wrap">
          <img
            class="contributor-avatar"
            src="${escHtml(c.avatar_url)}&s=80"
            alt="${escHtml(c.login)}"
            width="56" height="56"
            loading="lazy"
          />
        </div>
        <div class="contributor-info">
          <div class="contributor-username">@${escHtml(c.login)}</div>
          <div class="contributor-commits">${c.contributions} contribution${c.contributions !== 1 ? 's' : ''}</div>
        </div>
      </a>
    `).join('');

    loadingEl.classList.add('hidden');
    gridEl.innerHTML = cards;

  } catch (err) {
    console.error('Could not load GitHub contributors:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
  }
}

/* ---- COMMUNITY CONTRIBUTORS (ALL-STARS.md) ---- */

function parseCommunityContributors(markdown) {
  const lines = markdown.split('\n');
  const contributors = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    /* Find the Community Contributors heading */
    if (/^##\s+Community Contributors/i.test(trimmed)) {
      inSection = true;
      continue;
    }

    /* Stop at the next ## heading */
    if (inSection && /^##\s/.test(trimmed)) break;

    if (!inSection) continue;

    /* Parse list items: - **Name** | Role | Location */
    if (/^[-*]\s+\*\*/.test(trimmed)) {
      const content = trimmed.replace(/^[-*]\s+/, '').trim();
      const parts = content.split('|').map(p =>
        p.replace(/\*\*/g, '').trim()
      );
      if (parts[0]) {
        contributors.push({
          name:     parts[0] || '',
          role:     parts[1] || '',
          location: parts[2] || '',
        });
      }
    }
  }
  return contributors;
}

async function loadCommunityContributors() {
  const loadingEl = document.getElementById('community-loading');
  const errorEl   = document.getElementById('community-error');
  const container = document.getElementById('community-contributors');

  try {
    const res = await fetch(ALL_STARS_URL);
    if (!res.ok) throw new Error('Failed to fetch ALL-STARS.md');
    const markdown = await res.text();
    const contributors = parseCommunityContributors(markdown);

    loadingEl.classList.add('hidden');

    if (contributors.length === 0) {
      container.innerHTML = `
        <p class="empty-note">
          No community contributors listed yet.
          Know someone who should be here? Reach out via
          <a href="https://www.instagram.com/mzantsivibes/" target="_blank" rel="noopener">Instagram</a> or
          <a href="https://www.linkedin.com/company/mzantsi-vibes/" target="_blank" rel="noopener">LinkedIn</a>.
        </p>`;
      return;
    }

    const cards = contributors.map(c => `
      <div class="community-card">
        <div class="community-avatar">${escHtml(c.name.charAt(0).toUpperCase())}</div>
        <div class="contributor-info">
          <div class="contributor-name">${escHtml(c.name)}</div>
          ${c.role     ? `<div class="contributor-role">${escHtml(c.role)}</div>` : ''}
          ${c.location ? `<div class="contributor-location">📍 ${escHtml(c.location)}</div>` : ''}
        </div>
      </div>
    `).join('');

    container.innerHTML = `<div class="contributor-grid">${cards}</div>`;

  } catch (err) {
    console.error('Could not load ALL-STARS.md:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
  }
}

/* ---- UTILS ---- */

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---- INIT ---- */

document.addEventListener('DOMContentLoaded', () => {
  loadGithubContributors();
  loadCommunityContributors();
});
