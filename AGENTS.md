# AGENTS.md

Guidance for AI coding agents working on Mzantsi Vibes. Humans: start with
[`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Operations
(secrets, deploy, review cycle) are in [`CONTRIBUTE_SETUP.md`](CONTRIBUTE_SETUP.md).

## What this is

A free guide for South African school-leavers, plus a system that lets anyone
contribute without a GitHub account. Three parts:

- **The content**: `README.md`.
- **The site**: static pages in `PUBLISH/`, served by a Cloudflare Worker.
- **The contribution system**: the same Worker (`src/`) turns form submissions into
  pull requests and runs a daily review cycle. It runs as a **GitHub App**.

## The one thing to understand: `README.md` is the content

The site fetches `README.md` from `main` on GitHub at runtime
(`PUBLISH/script.js`, `README_URL`) and parses it. So:

- **Merging to `main` changes the live site.** There is no build step for content.
- The parser is strict. Only list items shaped `-   [Name](url) — description`
  render. Plain paragraphs, numbered lists, a `-` where the `—` belongs, or text
  with no link are written to the README and **never shown**.
- Four `##` pillars (`🎓 I'm Going to Study`, `💼 I'm Going to Work`,
  `🤷 I Don't Know Yet`, `📋 For Everyone`) hold `###` sections. They are matched by
  keyword in `PUBLISH/script.js`. Renaming one breaks the site **and** the form.
- `src/readme.js` (`normalizeMarkdown`, `applyNew`, `applyEdit`) is what keeps
  submissions in that shape. Change it with its tests (`test/test-normalize.mjs`).
- Never put test data in the README. Test entries get closed or rejected, never merged.

## Layout

| Path | What |
|---|---|
| `README.md` | The content (see above) |
| `PUBLISH/` | The static site. `PUBLISH/contribute/` is the form (Quill + Turndown + marked, **vendored** in `vendor/`) |
| `src/worker.js` | Entry: routing and the three crons |
| `src/submit.js`, `readme.js` | Form submission → patched README → branch → PR |
| `src/github-auth.js`, `github.js` | GitHub App auth (JWT → installation token) and the REST client |
| `src/cron.js`, `action.js`, `email.js`, `tokens.js` | Daily digest, Approve/Reject links, 18:00 merge |
| `src/admin.js` | `POST /api/admin/run`: runs a job by hand (token-protected) |
| `src/opportunities.js` | Weekly Tavily opportunity digest → one GitHub issue |
| `scripts/mz`, `trigger.mjs`, `run-opportunities.mjs` | Run and tune things by hand |
| `test/` | Seven dependency-free suites |

## Commands

No `package.json`, nothing to install. Node 18+ only. Do not add dependencies.

```bash
for t in test test-auth test-admin test-review test-opportunities test-normalize test-integration; do node test/$t.mjs | tail -3; done
```

All seven must pass before a PR (59, 48, 43, 69, 101, 23 and 39 checks as of writing).
`test.mjs` and `test-integration.mjs` fetch the real README from GitHub. The rest are
fully faked: no network, nothing sent, nothing merged. Two of them print
error-looking lines on purpose (`admin run failed: explode`, `opportunity label
unavailable: 403`): they exercise failure paths. Trust the `N passed, 0 failed` line.
Add tests with every change, and update the counts in `CONTRIBUTE_SETUP.md`.

```bash
./scripts/mz status            # open contribution PRs and where each stands
./scripts/mz digest            # PREVIEW the review email. `digest send` sends it.
./scripts/mz opps              # PREVIEW the opportunity issue (10 Tavily credits). `opps post` opens it.
./scripts/mz merge             # PREVIEW the 18:00 job. `merge run` runs it.
node scripts/run-opportunities.mjs --help    # tuning flags: --list, --only, --explain, --min-score ...
```

```bash
node scripts/preview.mjs       # http://127.0.0.1:8000 : the site, with a MOCK API
```

`preview.mjs` serves `PUBLISH/` with `Cache-Control: no-store` and fakes the form's two API
calls (the section list comes from the live README; submitting prints in the terminal and
sends nothing to GitHub). Use it, not `python3 -m http.server`: a plain static server sends no
cache headers, and a browser (Firefox in particular) can keep an old stylesheet while using a
new page, which looks like a half-applied theme. If a page looks half-restyled, hard-reload first.

There is no local deploy. `wrangler` is not installed. Deploys happen when a PR merges
to `main` (Cloudflare Workers Builds). The `cf` CLI is for account operations only.

## How the contribution system works

```
form → POST /api/submit → patch README → branch contribute/… → PR (needs-review)
08:00 SAST  digest email, one signed Approve + Reject link per PR → label (never merges)
18:00 SAST  merge `approved`, close `rejected` (comment), delete the branch
Mon 07:00   opportunity digest → one GitHub issue of leads (nothing touches the README)
```

Crons are in `wrangler.jsonc` and dispatched by schedule string in `src/worker.js`.
The review links are stateless HMAC tokens (no database, no sessions).

## Rules that must hold

1. **Never push to `main`.** Branch, open a PR, let the human merge. Merging deploys.
2. **Check the PR's base branch.** A stacked PR merged into its base lands on that
   branch, not `main`. This once left production without the whole feature.
3. **Only act on PRs the form opened.** The digest, the Approve/Reject endpoint and
   the merge job all call `isContributionPull` (a Bot user, a `contribute/…` branch,
   this repo). Never label, merge or close anything else.
4. **Anything that sends, posts or merges is a preview first.** Keep `--dry-run` and the
   confirmation in `scripts/mz` and `admin.js`. Only a boolean `dryRun: true` is a dry run.
5. **Run tokens and Approve links must not be interchangeable.** They are signed over
   different messages (`tokens.js`). Keep it that way.
6. **Never print, log, commit or paste a secret.** Secrets are Worker secrets
   (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `HMAC_SECRET`, `RESEND_API_KEY`,
   `REVIEWER_EMAIL`, `TAVILY_API_KEY`). Locally they live in `.dev.vars`. `.dev.vars*`,
   `*.pem` and `.cloudflare/` are gitignored. Say which secrets exist, never their values.
7. **Web text is untrusted.** Opportunity titles and snippets go into an issue that
   pings people and renders links, so they are made inert (`inert()` in
   `opportunities.js`). Keep that when changing the output.
8. **Tavily costs credits.** One basic search is 1 credit, and a dry run spends the same
   as a real run. The weekly run is 10. Don't loop over it while testing; use
   `mz opps tune --only … --explain`.

## Cloudflare and GitHub gotchas

- **`[10215] Secret edit failed … latest version isn't deployed`**: the newest uploaded
  version isn't the live one. Non-production builds are switched off now, so this should
  only follow an unmerged-branch build. Merge or redeploy `main`, then edit the secret.
  Never "deploy the latest version": it is usually an unreviewed branch.
- **A secret change takes a few seconds to take effect.** A request right after it can
  still get the old value. Retry before debugging.
- **`cf workers secrets update … --text` with a value starting with `-`** (a PEM key)
  needs the `=` form: `--text="$(cat key.pem)"`. A space makes the CLI read dashes as flags.
- **Preview URLs are off** (`preview_urls: false`). They once exposed unmerged code
  with the production secrets.
- **Why a GitHub App, not a bot user:** GitHub suspended the original bot account and
  took everything down. Don't reintroduce a user account or a PAT for the Worker.
- **`baseUrl` already contains `https://`.** Don't prefix it.
- **Squash merges** make `git branch --merged` lie. Check the PR's state, not git.

## Conventions

- Match the surrounding code: plain ES modules, no build step, small functions, a
  comment that says *why* where it isn't obvious.
- Commit messages say what and why. If you are an AI agent, end commits with a
  `Co-Authored-By:` trailer naming yourself.
- One focused PR per change, with a description that says what was verified and what
  was not. Say plainly what you could not test.
- [`CONTRIBUTE_SYSTEM_PLAN.md`](CONTRIBUTE_SYSTEM_PLAN.md) is the original brief and is
  partly out of date (it describes a bot account and a PAT). `CONTRIBUTE_SETUP.md` is current.

## Status (as of 2026-10-01)

Proven in production: submitting, the app opening PRs, the digest email and signed
links, rejecting, the merge job's close path and branch cleanup, and posting the
opportunity issue. **Not yet seen:** the app merging an approved PR, and the three
crons firing on their own schedule (everything so far was triggered by hand).
