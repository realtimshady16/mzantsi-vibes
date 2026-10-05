/**
 * Deliverable 2 — form submission to an open pull request.
 *
 * The submission is turned into a single-file diff against README.md, pushed
 * to its own branch in this repo (the GitHub App has write access here, so no
 * fork is needed), and opened as a PR against main. Review happens later via
 * the digest; nothing is merged from here.
 */

import { applyEdit, applyNew, sanitizeHandle, assertStructureIntact, PatchError } from './readme.js';
import { LABELS, LABEL_META, isContributionPull } from './github.js';

const README_PATH = 'README.md';

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'submission';
}

function randomSuffix() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A code fence longer than any run of backticks inside the text, so submitted
 * text can never close the fence and write live markdown (fake "approved"
 * notes, images, @mentions that notify real people) into the PR.
 */
function fenced(text, lang = 'markdown') {
  const longest = Math.max(0, ...(String(text).match(/`+/g) || []).map((r) => r.length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return [ticks + lang, text, ticks];
}

/** PR body carries enough context that a reviewer never has to open the diff. */
function buildPrBody({ flow, pillar, sectionName, handle, format, content, original, createdSection, filledPlaceholder }) {
  const lines = [];

  lines.push('### Submitted from the contribute form');
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Flow** | ${flow === 'edit' ? 'Correction to existing content' : 'New resource / written piece'} |`);
  lines.push(`| **Section** | ${sectionName} |`);
  if (flow !== 'edit') lines.push(`| **Part of** | ${pillar} |`);
  // In a code span, so "@someone" credits the contributor without notifying a real GitHub user.
  lines.push(`| **Submitted by** | ${handle ? '`' + escMd(handle) + '`' : '_anonymous (no handle given)_'} |`);
  lines.push(
    `| **Written in** | ${format === 'richtext' ? 'Rich text editor (converted to markdown)' : 'Markdown'} |`
  );

  if (createdSection) lines.push(`| **Note** | This created a new \`###\` section. |`);
  if (filledPlaceholder) lines.push(`| **Note** | This filled a "_coming soon_" placeholder. |`);

  if (original) {
    lines.push('');
    lines.push('<details><summary>Text that was replaced</summary>');
    lines.push('');
    lines.push(...fenced(original));
    lines.push('');
    lines.push('</details>');
  }

  lines.push('');
  lines.push('<details><summary>Raw submitted content</summary>');
  lines.push('');
  lines.push(...fenced(content));
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('Opened automatically by the contribute form. Merge is handled by the daily batch job after review.');

  return lines.join('\n');
}

/** Escape the pipe characters and newlines a handle could carry into the table. */
function escMd(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function titleFor(flow, sectionName, handle) {
  const what = flow === 'edit' ? `Correct: ${sectionName}` : `Add to ${sectionName}`;
  const who = handle ? ` (from ${handle})` : '';
  return `contribute: ${what}${who}`;
}

export async function handleSubmit({ request, config, gh }) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new PatchError('Could not read the submission. Please refresh the page and try again.', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PatchError('Could not read the submission. Please refresh the page and try again.', 400);
  }
  for (const key of ['pillar', 'section', 'newSectionName', 'original', 'content']) {
    if (body[key] != null && typeof body[key] !== 'string') {
      throw new PatchError('Could not read the submission. Please refresh the page and try again.', 400);
    }
  }

  const flow = body.flow === 'edit' ? 'edit' : 'new';
  const handle = sanitizeHandle(body.handle);
  // Informational only — the client always sends markdown, whichever editor
  // produced it. Anything unrecognised is treated as plain markdown.
  const format = body.format === 'richtext' ? 'richtext' : 'markdown';
  // Older cached copies of the form sent 'new::<pillar>' for "+ New section".
  const section = typeof body.section === 'string' && body.section.startsWith('new::') ? 'new' : body.section;
  const pillar = body.pillar;

  if (!pillar) throw new PatchError('Please choose which part of the site your change belongs to.');
  if (!section) throw new PatchError('Please choose the section you want to change.');

  /* ---- 1. current README from upstream ---- */
  const readme = await gh.getReadme(config.owner, config.repo, README_PATH);
  if (!readme.content) throw new PatchError('The README could not be read. Try again shortly.', 502);

  /* ---- 2. build the patched file ---- */
  let result;
  if (flow === 'edit') {
    result = applyEdit(readme.content, {
      pillar,
      section,
      original: body.original,
      replacement: body.content,
    });
  } else {
    result = applyNew(readme.content, {
      pillar,
      section,
      content: body.content,
      newSectionName: body.newSectionName,
    });
  }

  // Prefer the name resolved from the README over the raw form input so the
  // PR metadata always matches where the change actually landed.
  const resolvedPillar = result.pillarName || pillar;

  if (result.markdown === readme.content) {
    throw new PatchError('That change would not alter the README. Nothing to submit.', 422);
  }

  assertStructureIntact(readme.content, result.markdown);

  /* ---- 2b. refuse when the review queue is already long ----
     Every accepted submission costs a branch, a commit and a PR. A flood would
     bury the digest and trip GitHub's limits on content creation. */
  const open = await gh.listOpenPulls(config.owner, config.repo);
  const waiting = open.filter((p) => isContributionPull(p, config)).length;
  if (waiting >= config.maxOpenContributions) {
    throw new PatchError(
      'We have a lot of changes waiting for review right now. Please try again in a day or two.',
      503
    );
  }

  /* ---- 3. push a branch to this repo, branched from main ---- */
  const baseSha = await gh.getDefaultBranchSha(config.owner, config.repo);

  const branch = `${config.branchPrefix}/${flow}-${slugify(result.sectionName || 'submission')}-${Date.now().toString(36)}-${randomSuffix()}`;

  await gh.createBranch(config.owner, config.repo, branch, baseSha);
  await gh.commitReadme(config.owner, config.repo, branch, {
    path: README_PATH,
    content: result.markdown,
    sha: readme.sha,
  });

  /* ---- 4. open the PR upstream ---- */
  const pr = await gh.createPullRequest(config.owner, config.repo, {
    title: titleFor(flow, result.sectionName, handle),
    head: branch,
    base: 'main',
    body: buildPrBody({
      flow,
      pillar: resolvedPillar,
      sectionName: result.sectionName,
      handle,
      format,
      content: body.content,
      original: flow === 'edit' ? String(body.original ?? '').trim() : '',
      createdSection: result.createdSection,
      filledPlaceholder: result.filledPlaceholder,
    }),
  });

  /* ---- 5. labels: create on first use, then mark as pending review ---- */
  for (const [name, meta] of Object.entries(LABEL_META)) {
    await gh.ensureLabel(config.owner, config.repo, name, meta.color, meta.description);
  }
  await gh.addLabels(config.owner, config.repo, pr.number, [LABELS.pending]).catch(() => {});

  return {
    ok: true,
    prNumber: pr.number,
    prUrl: pr.html_url,
    handle,
  };
}
