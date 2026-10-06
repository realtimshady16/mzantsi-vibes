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
  keyword in `PUBLISH/content-parse.js`. Renaming one breaks the site **and** the form.
- `src/readme.js` (`normalizeMarkdown`, `applyNew`, `applyEdit`) is what keeps
  submissions in that shape. Change it with its tests (`test/test-normalize.mjs`).
- Time-sensitive entries go in `OPPORTUNITIES.md` (the form does not write there; the weekly digest opens a PR of dated leads, reviewed like any contribution). An entry
  may end with `{closes: 2026-11-30; tags: bursary}`; the site hides it after that date, and a `closes` it
  cannot read hides the entry. Format: `OPPORTUNITIES.md`, parser: `PUBLISH/entry-meta.js`.
- Pages with a deadline pill show a disclaimer ("check the official page, we are not your only source"): the
  project's decision is that checking is the user's job, so a date that is stale or wrong is acceptable if that is said.
- Never put test data in the README. Test entries get closed or rejected, never merged.

## Layout

| Path | What |
|---|---|
| `README.md` | The content (see above) |
| `PUBLISH/` | The static site: `index.html` (Home), `tasks/`, `allstars/`, `contribute/` |
| `OPPORTUNITIES.md` | Time-sensitive entries (deadlines). Same structure as the README; hidden by date once `closes` passes |
| `PUBLISH/content-parse.js` | The markdown parser, shared by the site and the Worker's search index (so they cannot disagree) |
| `PUBLISH/search-core.js` | Search and ranking over the index (pure functions; the box itself is in `script.js`) |
| `src/content-index.js` | `GET /api/index.json`: every linked entry from both files, edge-cached 5 minutes, no secrets |
| `PUBLISH/entry-meta.js` | Parser for the `{closes: …; tags: …}` block, shared by the site and `src/readme.js` |
| `PUBLISH/theme.css`, `theme.js` | The shared design system and the light/night toggle (see "Design system") |
| `PUBLISH/contribute/` | The form (Quill + Turndown + marked, **vendored** in `vendor/`) |
| `src/worker.js` | Entry: routing and the three crons |
| `src/submit.js`, `readme.js` | Form submission → patched README → branch → PR |
| `src/github-auth.js`, `github.js` | GitHub App auth (JWT → installation token) and the REST client |
| `src/cron.js`, `action.js`, `email.js`, `tokens.js` | Daily digest, Approve/Reject links (GET shows a confirm page, POST acts), 18:00 merge (emails failures) |
| `src/admin.js` | `POST /api/admin/run`: runs a job by hand (token-protected) |
| `src/opportunities.js` | Weekly Tavily opportunity digest → one GitHub issue; reads closing dates |
| `src/opportunity-pr.js`, `opportunities-file.js` | The same run also opens a PR adding dated leads to `OPPORTUNITIES.md` (as the GitHub App, `contribute/opps-…` branch, so it joins the review digest) |
| `scripts/mz`, `trigger.mjs`, `run-opportunities.mjs` | Run and tune things by hand |
| `scripts/preview.mjs` | Local preview of the site with a mock API; reads the working-copy README/OPPORTUNITIES (`--sample` adds fake entries) |
| `test/` | Eleven dependency-free suites, plus `test/browser/` (needs Chromium) |

## Commands

No `package.json`, nothing to install. Node 18+ only. Do not add dependencies.

```bash
for t in test test-hardening test-auth test-admin test-review test-opportunities test-normalize test-integration test-entry-meta test-index test-opportunity-pr; do node test/$t.mjs | tail -3; done
```

All eleven must pass before a PR (59, 50, 48, 43, 75, 173, 23, 39, 36, 39 and 62 checks as of writing).
`test-integration` fetches from GitHub without a login, which GitHub limits per IP address: if it reports "rate limit exhausted", wait an hour rather than re-running it.
```bash
node test/browser/run.mjs      # the six page tests, in headless Chromium (154 checks)
```

The browser tests start their own preview server and drive the real pages: the editor, filters,
the theme toggle, every failure path, a phone width. They need Chromium on the PATH and print
SKIPPED without it. Run them after any change under `PUBLISH/`.

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
Mon 07:00   opportunity digest → one GitHub issue of leads, plus one PR adding the dated ones to
            OPPORTUNITIES.md (needs-review, so it is approved in the 08:00 email like any other)
```

Crons are in `wrangler.jsonc` and dispatched by schedule string in `src/worker.js`.
The review links are stateless HMAC tokens (no database, no sessions).

## Design system ("Pull Up a Chair")

All four pages share `PUBLISH/theme.css` (tokens, header, footer, zigzag band) and `PUBLISH/theme.js`
(light/night). Each page then adds its own small stylesheet. The design came from a handoff
(not in the repo); where we deviate from it, it is on purpose and noted in the PR.

- **`theme.js` must be the first script in `<head>`,** before the stylesheets, so the right theme is
  on the page from the first frame. It follows the device, remembers a choice, and survives blocked storage.
- **Use the tokens** (`var(--card)`, `var(--text-2)`, `var(--selected-bg)`...). The night theme is a set of
  token overrides under `[data-theme="dark"]`, not a second stylesheet. The only hard-coded colours are
  dark text on pastels (`#0e2626`), which stays dark in both themes.
- **Colours are hex, not `oklch()`.** The design was specified in oklch; these are the sRGB equivalents
  (verified against the designers' screenshots) so older Android WebViews, common among our users,
  still render. Don't introduce `oklch()`, `:has()`, `aspect-ratio` or flex-only layouts that need newer engines.
- **No shadows.** That is deliberate.
- **Keep text readable.** Small text needs 4.5:1. The design dims "coming soon" rows; at its 50% they were
  2.6:1, so they are 70% with body-colour text (about 6:1).
- **The `website` field on the form is a honeypot and must stay invisible** (off-screen, `tabindex=-1`,
  `aria-hidden`). The design mock-up drew it as a normal field; a real person filling it in would have
  their submission silently dropped.
- **Preview with `scripts/preview.mjs`, never a plain static server.** Browsers can keep a stale stylesheet
  from one that sends no cache headers, which looks like a half-applied theme (this happened in Zen/Firefox).
  `http://127.0.0.1:8000/__diag` checks a browser for exactly that.

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
8. **A Worker run may make only 50 outbound requests** (free plan), and a redirect counts as another. The weekly job
   uses about 30 in a worst case (`test-opportunity-pr.mjs` counts them). Anything that adds a `fetch` to it must
   keep that test under its limit: the first deployed run failed on exactly this.
9. **Respect the sources** (details in `CONTRIBUTE_SETUP.md`, "What the sources allow"). graduates24.com is not a source:
   its terms forbid automated access and republishing, so never search it, fetch it, or put its text anywhere (the
   digest drops any result from it). For zabursaries.co.za make only the three monthly-page requests, one at a time,
   30 seconds apart (its `robots.txt` crawl delay), take names, dates and links only, and write our own
   descriptions. Tests enforce this.
10. **Tavily costs credits.** One basic search is 1 credit, and a dry run spends the same
   as a real run. The weekly run is 10. Don't loop over it while testing; use
   `mz opps tune --only … --explain`.

## Cloudflare and GitHub gotchas

- **Cron weekdays: Cloudflare counts 1 as Sunday**, not Monday. A bare `1` fired the weekly job on a Sunday. Use `MON`.
- **`run_worker_first` is `["/api/*", "/action"]`.** Anything else is served from the assets without running the
  Worker (free, and not counted against the 100k requests a day). A new Worker route must be added to that list or
  the assets layer will answer it first. Static-page headers live in `PUBLISH/_headers`, not in the Worker.

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
