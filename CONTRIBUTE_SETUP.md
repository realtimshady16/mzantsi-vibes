# Contribution system — setup and operations

How the no-GitHub contribute form works, how to deploy it, and how to run the
review cycle. The design brief this implements is in
[`CONTRIBUTE_SYSTEM_PLAN.md`](CONTRIBUTE_SYSTEM_PLAN.md).

## How it fits together

One Cloudflare Worker does three jobs, so there is no extra infrastructure:

| Job | Where |
|---|---|
| Serves the static site | `PUBLISH/` via the `ASSETS` binding |
| Contribute API + review links | `src/worker.js` |
| Two cron jobs | `src/cron.js` |

```
contribute form  ──POST /api/submit──▶  Worker
                                        │
                                        ├─ patch README.md (src/readme.js)
                                        ├─ push branch to the bot's fork
                                        └─ open a PR upstream  + needs-review

08:00 SAST cron  ──▶  digest email to Tim, one Approve + Reject link per PR
                        links are HMAC-signed, stateless, expire after 72h

click link       ──GET /action──▶  verify signature ──▶ add/remove label
                                        (never merges)

18:00 SAST cron  ──▶  merge everything labelled approved
                        close everything labelled rejected
```

## Files

| File | Purpose |
|---|---|
| `src/worker.js` | Entry point: routing, cron dispatch |
| `src/readme.js` | README parsing, patching, input sanitising |
| `src/submit.js` | Form submission → patch → pull request |
| `src/cron.js` | Morning digest, evening batch merge |
| `src/action.js` | Approve/Reject endpoint |
| `src/email.js` | Resend + digest HTML |
| `src/opportunities.js` | Weekly opportunity digest (Tavily → one GitHub issue) |
| `scripts/run-opportunities.mjs` | Run that digest on demand, from your machine |
| `src/tokens.js` | HMAC sign/verify for the review links |
| `src/github.js` | GitHub REST wrapper |
| `src/config.js` | Env, secrets, rate limiting |
| `PUBLISH/contribute/` | The form page (`convert.js` bridges rich text and markdown) |
| `PUBLISH/contribute/vendor/` | Quill, Turndown and marked, vendored so the form has no CDN dependency |
| `test/` | Test suites (see below) |

## Prerequisites

1. **A dedicated bot GitHub account.** Not your personal one. The Worker uses
   it to push branches and open PRs, and it should be able to be revoked
   without affecting you.
2. **The bot account needs its own fork** of `realtimshady16/mzantsi-vibes`.
   GitHub will not let it push a branch to a repo it does not own. Fork it once:
   <https://github.com/realtimshady16/mzantsi-vibes/fork>
   (`ensureFork()` in `src/github.js` will also create it automatically on the
   first submission, and wait for GitHub to finish.)
3. **A fine-grained PAT** on that bot account, scoped to
   `realtimshady16/mzantsi-vibes` only, with:
   - Contents: **Read and write**
   - Pull requests: **Read and write**
4. **A Resend account** and an API key.

## Secrets

None of these go in the repo. Set each with:

```bash
wrangler secret put BOT_GITHUB_PAT
wrangler secret put HMAC_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put REVIEWER_EMAIL
```

| Secret | What it is |
|---|---|
| `BOT_GITHUB_PAT` | The bot's fine-grained PAT |
| `HMAC_SECRET` | Signs the Approve/Reject links. `openssl rand -hex 32` |
| `RESEND_API_KEY` | From <https://resend.com/api-keys> |
| `REVIEWER_EMAIL` | Where the digest is sent |

Non-secret settings live in `vars` in `wrangler.jsonc`. **Change `BASE_URL`**
once you know the deployed hostname — the digest links are built from it, and
crons have no request to infer it from.

## Local development

```bash
cp .dev.vars.example .dev.vars     # then fill it in; .dev.vars is gitignored
npm install -g wrangler            # or: bun add -g wrangler
wrangler dev
```

`.dev.vars` is gitignored. Never commit real values.

## Deploy

```bash
wrangler deploy
```

Check it came up:

```bash
curl https://<your-hostname>/api/health          # {"ok":true,...}
open  https://<your-hostname>/contribute
```

The form loads its section list from `/api/sections`. If that call fails the
page falls back to a saved copy of the sections and says so, so a GitHub
outage does not take the form down.

## Tests

No dependencies — plain ES modules. Run them with `node` (18+) or `bun`:

```bash
node test/test.mjs            # 59 checks — README patching, sanitising, HMAC
node test/test-integration.mjs # 41 checks — real GitHub reads, mutations mocked
node test/test-review.mjs     # 55 checks — digest, signed links, batch merge
node test/test-normalize.mjs  # 23 checks — markdown normalisation, no network
node test/test-opportunities.mjs # 78 checks — opportunity digest, Tavily and GitHub faked
```

`test-integration.mjs` reads the real README from GitHub, so it needs a token:
`BOT_GITHUB_PAT=... node test/test-integration.mjs`. Without one it skips.
It mocks every call that would create a branch, commit or PR, so it cannot
open a pull request by accident.

`test.mjs` needs network access once, to fetch the current README as a fixture.

## How the two flows work

**Add something new** — pick a section, the Worker appends your bullet to the
end of that `###` section. If the section contains a `— _coming soon_`
placeholder, your line replaces that placeholder instead, which is usually
exactly what you want.

**Correct something** — paste the current text and the replacement. The Worker
searches for your text *within the chosen section* and swaps it. Whitespace is
matched loosely (`-   [X](url)` and `- [X](url)` are treated as the same), so
copying from the rendered site works. If your text appears more than once in
that section the submission is rejected rather than guessed at — paste a bit
more surrounding text.

## Rich text or markdown

Each content field has a **Rich text** and a **Markdown** tab. Rich text is a
Quill editor limited to what the site can show: bold, italic, links and bullets.
The markdown textarea underneath is always the source of truth and is what gets
submitted, so switching tabs never loses anything and the Worker only ever sees
markdown. If the editor libraries fail to load, the field falls back to markdown.

Both routes end up identical because of two steps:

1. **In the browser**, `convert.js` turns the editor's HTML into markdown
   (headings, images and rules are dropped, since the site cannot show them).
2. **In the Worker**, `normalizeMarkdown()` in `src/readme.js` puts any markdown
   into the one shape the site parser reads: `-   [Name](url) — description`. It
   bullets bare lines, turns `*`/`+`/`1.` into `-   `, and turns a hyphen after
   the link into an em dash. The site only renders lines in that shape, so a
   line that is not a bullet would be written to the README and never shown.

The PR body records which editor was used ("Written in").

## Weekly opportunity digest

A separate job, sharing the Worker and the bot account. Every **Monday 07:00
SAST** it searches for bursaries, learnerships, graduate programmes, jobs and
training with [Tavily](https://tavily.com) and opens **one GitHub issue** titled
`Opportunity digest — <date>`. It is a leads list for a human: nothing it finds
goes near the README, and there is no deduplication between weeks.

- **Closing soon:** zabursaries keeps these on one page per month
  (`/bursaries-closing-in-november-2026/`). Tavily's index missed the current
  month's page, so the job builds this month's and the next two URLs and keeps
  the ones that exist (a 404 rules a page out). No search, no credits.
- **Trusted pass:** bursaries by the six README faculties (zabursaries only,
  filed by the faculty in each URL), then learnerships, graduate programmes,
  jobs and training/vac work on both sites (`include_domains`). Everything but
  the evergreen faculty hubs is limited to the last month, which turns generic
  listing pages into specific postings.
- **Broader pass:** one search per category with the two sites, social media and
  job-board search pages excluded, `country: south africa`, last month only, and
  kept only if there is some South Africa signal. Listed under a "less trusted"
  heading at the bottom.
- **Tidying:** home pages, on-site search, pagination and contact pages are
  dropped; titles that only mention past years are dropped; page chrome
  ("Create My CV", WhatsApp banners, sidebars of other listings) is stripped
  from descriptions. A lead with no usable description shows title and link only.
- **Cost:** 15 basic searches = **15 Tavily credits per run**. No advanced search.
- **Issue label:** `opportunity-digest`, created on first use.

Setup is one secret: `wrangler secret put TAVILY_API_KEY` (key from
<https://app.tavily.com>). Without it only this job fails, with a clear message
in the Worker log; the contribute form and review digest are unaffected.

**Running it on demand** (to tune the queries without waiting a week):

```bash
node scripts/run-opportunities.mjs          # dry run: prints the issue, posts nothing
node scripts/run-opportunities.mjs --post   # opens the real issue
```

It reads `TAVILY_API_KEY` (and `BOT_GITHUB_PAT` for `--post`) from `.dev.vars`.
A dry run still spends the same 15 credits. The queries, faculties and
`TIME_RANGE` live at the top of `src/opportunities.js`.

## What is rejected, and why

| Rejected | Reason |
|---|---|
| Any line starting with `#` | The site is driven by four `##` headings; a contributor could not be allowed to restructure it. The Worker generates headings itself for the "new section" flow. |
| `---` dividers | Used as separators in the README |
| `<!-- ... -->` | Hides content from the site parser but shows in the PR |
| A change to the four pillars | Checked after patching, not just before |
| An email address or a long digit run in the name | `CONTRIBUTING.md` asks contributors not to post contact details |
| More than 5 submissions/hour/IP | Best-effort only — see limitations |

## Review cycle

- **08:00 SAST** — digest lists every open bot PR that is neither approved nor
  rejected. Already-decided PRs are skipped so they do not nag.
- **Approve** adds `approved` and removes `rejected`/`needs-review`. **Reject**
  does the inverse, so the last click wins and a double-click is harmless.
  (An email client prefetching a link is the reason the brief accepts this.)
- **18:00 SAST** — merges everything labelled `approved` (squash), closes
  everything labelled `rejected` with a comment linking back to the form, then
  strips the labels so nothing is reprocessed. Safe to run twice.
- `main` has no branch protection and its only ruleset is disabled, so the bot
  can merge without an admin bypass. If you ever enable protection, the bot
  needs to be added to the bypass list or the 18:00 job will start failing.

## Limitations, stated plainly

- **Rate limiting is best-effort.** It is an in-memory map per Worker isolate,
  so it resets when an isolate recycles and is not shared across isolates. It
  slows down casual spam; it is not a security boundary. The honeypot field is
  the other guard. If the form ever gets real traffic, this is the first thing
  to replace — Cloudflare Turnstile or WAF rate limiting, neither of which needs
  a database.
- **There is no dedupe.** Submitting the same resource twice opens two PRs.
  Acceptable at this volume; the reviewer sees both in the digest.
- **Concurrent submissions can collide.** Two people patching the same line at
  the same time produce two PRs, and the second may fail to merge cleanly. The
  digest shows both, and the merge job reports failures rather than hiding them.
- **`ensureFork()` can create a fork** on first run. That is intentional, but
  it is a real write on first use.
- **The digest is single-recipient.** Adding reviewers means a list in
  `REVIEWER_EMAIL` and a link that can only be verified once, so a shared inbox
  would let anyone with the email approve. Keep it to one person until that
  changes.

## Cost

Free on Cloudflare's Workers free tier at this volume. The only real
constraints are the GitHub API rate limit (5,000/hour, and a bad submission
costs about 8 calls) and Resend's daily allowance.
