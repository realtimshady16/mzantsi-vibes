/**
 * Thin GitHub REST wrapper for the bot account.
 *
 * The bot only ever needs: read the README, push a branch to its own fork,
 * open a PR upstream, and label/merge/close PRs. No database, no caching layer
 * beyond a per-isolate memo of the bot's login and fork.
 */

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.details = details;
  }
}

function makeClient(token) {
  async function api(path, { method = 'GET', body, accept } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mzantsi-vibes-contribute',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 300) };
      }
    }

    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const msg =
        res.status === 403 && remaining === '0'
          ? 'GitHub API rate limit exhausted. Try again later.'
          : data?.message || `GitHub returned ${res.status}`;
      throw new GitHubError(msg, res.status, data);
    }

    return data;
  }

  /* ---------------- repo / file reads ---------------- */

  async function getReadme(owner, repo, path = 'README.md') {
    const data = await api(`/repos/${owner}/${repo}/contents/${path}`);
    const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return {
      content: new TextDecoder().decode(bytes),
      sha: data.sha,
    };
  }

  async function getDefaultBranchSha(owner, repo) {
    const ref = await api(`/repos/${owner}/${repo}/git/ref/heads/main`);
    return ref.object.sha;
  }

  /* ---------------- bot identity + fork ---------------- */

  let loginCache = null;
  async function botLogin() {
    if (!loginCache) loginCache = (await api('/user')).login;
    return loginCache;
  }

  let forkCache = null;

  /**
   * The bot needs a fork to push a branch to. Creating one is asynchronous on
   * GitHub's side, so poll briefly and give a clear message if it isn't ready.
   */
  async function ensureFork(owner, repo) {
    if (forkCache) return forkCache;
    const login = await botLogin();

    const existing = await api(`/repos/${login}/${repo}`).catch(() => null);
    if (existing && existing.fork) {
      forkCache = { owner: login, name: repo };
      return forkCache;
    }

    await api(`/repos/${owner}/${repo}/forks`, { method: 'POST' });

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const fork = await api(`/repos/${login}/${repo}`).catch(() => null);
      if (fork && fork.fork) {
        forkCache = { owner: login, name: repo };
        return forkCache;
      }
    }

    throw new GitHubError(
      `The bot account @${login} could not create a fork of ${owner}/${repo} in time. ` +
        `Fork it manually at https://github.com/${owner}/${repo}/fork and try again.`,
      503
    );
  }

  /* ---------------- branch + commit ---------------- */

  async function createBranch(forkOwner, repo, branch, sha) {
    await api(`/repos/${forkOwner}/${repo}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha },
    });
  }

  /**
   * Branch from upstream's HEAD so the PR diff contains only the submitted
   * change, not any drift between the fork and upstream.
   */
  async function commitReadme(forkOwner, repo, branch, { path, content, sha }) {
    return api(`/repos/${forkOwner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: {
        message: `contribute: update ${path}`,
        content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
        sha,
        branch,
      },
    });
  }

  /* ---------------- pull requests ---------------- */

  async function createPullRequest(owner, repo, { title, head, base, body }) {
    return api(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: { title, head, base, body },
    });
  }

  async function getPull(owner, repo, number) {
    return api(`/repos/${owner}/${repo}/pulls/${number}`);
  }

  /**
   * Open PRs, optionally narrowed to one author. GitHub's `head` filter takes
   * a branch (`user:branch`), not a login, so author filtering happens here.
   */
  async function listOpenPulls(owner, repo, { authorLogin, labels } = {}) {
    const params = new URLSearchParams({ state: 'open', per_page: '100' });
    let pulls = await api(`/repos/${owner}/${repo}/pulls?${params}`);

    if (authorLogin) {
      const want = authorLogin.toLowerCase();
      pulls = pulls.filter((p) => (p.user?.login || '').toLowerCase() === want);
    }

    if (labels && labels.length) {
      const wanted = new Set(labels.map((l) => l.toLowerCase()));
      pulls = pulls.filter((p) =>
        (p.labels || []).some((l) => wanted.has((l.name || '').toLowerCase()))
      );
    }

    return pulls;
  }

  async function mergePull(owner, repo, number) {
    return api(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      body: { merge_method: 'squash' },
    });
  }

  async function closePull(owner, repo, number) {
    return api(`/repos/${owner}/${repo}/pulls/${number}`, {
      method: 'PATCH',
      body: { state: 'closed' },
    });
  }

  async function commentPull(owner, repo, number, body) {
    return api(`/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      body: { body },
    });
  }

  /* ---------------- labels ---------------- */

  async function listLabels(owner, repo) {
    return api(`/repos/${owner}/${repo}/labels?per_page=100`);
  }

  /** Labels are needed for the review queue, so create them on first use. */
  async function ensureLabel(owner, repo, name, color, description) {
    const existing = (await listLabels(owner, repo)).find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing;

    return api(`/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      body: { name, color, description },
    }).catch((err) => {
      // 422 means it already exists, which is fine.
      if (err.status === 422) return null;
      throw err;
    });
  }

  async function addLabels(owner, repo, number, names) {
    return api(`/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'POST',
      body: { labels: names },
    });
  }

  async function removeLabel(owner, repo, number, name) {
    return api(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  return {
    api,
    getReadme,
    getDefaultBranchSha,
    botLogin,
    ensureFork,
    createBranch,
    commitReadme,
    createPullRequest,
    getPull,
    listOpenPulls,
    mergePull,
    closePull,
    commentPull,
    listLabels,
    ensureLabel,
    addLabels,
    removeLabel,
  };
}

export function github(token) {
  return makeClient(token);
}

/* Label names, kept in one place so the cron jobs and the form agree. */
export const LABELS = {
  pending: 'needs-review',
  approved: 'approved',
  rejected: 'rejected',
};

export const LABEL_META = {
  [LABELS.pending]: { color: 'fbca04', description: 'Submitted via the contribute form, awaiting review' },
  [LABELS.approved]: { color: '0e8a16', description: 'Approved in the daily digest, queued for batch merge' },
  [LABELS.rejected]: { color: 'b60205', description: 'Rejected in the daily digest' },
};
