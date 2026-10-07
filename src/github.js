/**
 * Thin GitHub REST wrapper for the contribute system.
 *
 * It only ever needs to: read the README, push a branch, open a PR, label /
 * merge / close PRs, and open an issue. No database, no caching layer.
 *
 * `auth` is either a plain token (scripts and tests) or an async function that
 * returns one (the GitHub App provider in github-auth.js, which refreshes
 * itself). In the Worker it is always the App: the system runs as an app
 * installation limited to this repo, not as a user account.
 */

const API = 'https://api.github.com';
const MAX_PULL_PAGES = 5;

export class GitHubError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.details = details;
  }
}

function makeClient(auth) {
  const getToken = () => (typeof auth === 'function' ? auth() : auth);

  async function api(path, { method = 'GET', body, accept } = {}) {
    const send = async () => {
      const token = await getToken();
      return fetch(`${API}${path}`, {
        method,
        headers: {
          // No token is fine for reading a public repo (the integration test does).
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'mzantsi-vibes-contribute',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    };

    let res = await send();
    // A cached installation token can be revoked early. Fetch a fresh one, once.
    if (res.status === 401 && typeof auth === 'function' && auth.invalidate) {
      auth.invalidate();
      res = await send();
    }

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

  /** `ref` reads the file as it is on another branch (an open PR's), not on the default one. */
  async function getReadme(owner, repo, path = 'README.md', ref) {
    const data = await api(`/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
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

  /** Contribution branches live in the repo itself, so tidy them up once decided. */
  async function deleteBranch(owner, repo, branch) {
    const ref = branch.split('/').map(encodeURIComponent).join('/');
    return api(`/repos/${owner}/${repo}/git/refs/heads/${ref}`, { method: 'DELETE' });
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
  async function listOpenPulls(owner, repo, { labels } = {}) {
    // Page through the list (a page holds 100), so approved PRs past the first
    // page are still merged. Capped, to stay inside the Worker's request budget.
    let pulls = [];
    for (let page = 1; page <= MAX_PULL_PAGES; page++) {
      const params = new URLSearchParams({ state: 'open', per_page: '100', page: String(page) });
      const batch = await api(`/repos/${owner}/${repo}/pulls?${params}`);
      pulls = pulls.concat(batch);
      if (batch.length < 100) break;
    }

    if (labels && labels.length) {
      const wanted = new Set(labels.map((l) => l.toLowerCase()));
      pulls = pulls.filter((p) =>
        (p.labels || []).some((l) => wanted.has((l.name || '').toLowerCase()))
      );
    }

    return pulls;
  }

  /** `sha` pins the merge to the commit that was reviewed: GitHub refuses if the branch moved. */
  async function mergePull(owner, repo, number, sha) {
    return api(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      body: { merge_method: 'squash', ...(sha ? { sha } : {}) },
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

  /* ---------------- issues ---------------- */

  async function createIssue(owner, repo, { title, body, labels = [] }) {
    return api(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: { title, body, labels },
    });
  }

  /* ---------------- labels ---------------- */

  async function listLabels(owner, repo) {
    return api(`/repos/${owner}/${repo}/labels?per_page=100`);
  }

  /** Labels are needed for the review queue, so create them on first use. */
  let labelList = null; // one listing per client: callers ensure three labels in a row
  async function ensureLabel(owner, repo, name, color, description) {
    labelList ||= listLabels(owner, repo).catch((err) => { labelList = null; throw err; });
    const existing = (await labelList).find(
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
    createBranch,
    commitReadme,
    deleteBranch,
    createPullRequest,
    getPull,
    listOpenPulls,
    mergePull,
    closePull,
    commentPull,
    createIssue,
    listLabels,
    ensureLabel,
    addLabels,
    removeLabel,
  };
}

export function github(auth) {
  return makeClient(auth);
}

/**
 * Is this PR one the contribute form opened? A same-repo branch under the
 * configured prefix, opened by an app (GitHub marks app users as "Bot").
 *
 * The digest, the approve/reject links and the evening merge all check this
 * before touching a PR. Branches now live in this repo, so without it a label
 * on someone's own PR could get it merged by the batch job.
 */
export function isContributionPull(pull, { owner, repo, branchPrefix }) {
  return (
    pull?.user?.type === 'Bot' &&
    String(pull.head?.repo?.full_name || '').toLowerCase() === `${owner}/${repo}`.toLowerCase() &&
    String(pull.head?.ref || '').startsWith(`${branchPrefix}/`)
  );
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
