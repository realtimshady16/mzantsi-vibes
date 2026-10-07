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
                                        ├─ push a contribute/… branch to this repo
                                        └─ open a PR to main  + needs-review
                                           (as the GitHub App, no user account involved)

08:00 SAST cron  ──▶  digest email to Tim, one Approve + Reject link per PR
                        links are HMAC-signed, stateless, expire after 72h

click link       ──GET /action──▶  confirm page ──button (POST)──▶ verify signature ──▶ add/remove label
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

The Worker acts as a **GitHub App**, not as a bot user account. An app is
GitHub's supported way to run automation: there is no account to get suspended,
it is limited to the repositories you install it on, and its tokens expire after
an hour. (The system originally used a bot user account with a PAT; GitHub
suspended it, which is what prompted the switch.)

### 1. Create the GitHub App (once, about five minutes)

Do this signed in as the owner of the repo. GitHub → **Settings → Developer
settings → GitHub Apps → New GitHub App**.

| Field | Value |
|---|---|
| Name | Anything unique, e.g. `Mzantsi Vibes Contribute`. PRs show as `<name>[bot]`. |
| Homepage URL | `https://mzantsivibes.co.za` |
| Webhook → Active | **Untick it.** The system polls; it never receives events. |
| Repository permissions | **Contents: Read and write**, **Pull requests: Read and write**, **Issues: Read and write** (Metadata: Read-only is added for you). Nothing else. |
| Where can it be installed | **Only on this account** |

Then, on the app's settings page:

1. Note the **App ID** at the top.
2. **Generate a private key.** A `.pem` file downloads. Treat it like a password.
3. **Install App** in the left sidebar → your account → **Only select
   repositories** → `mzantsi-vibes`.

### 2. A Resend account and an API key

## Secrets

None of these go in the repo. Set each with `wrangler secret put <NAME>` (or
`cf workers secrets update <NAME> --worker mzantsi-vibes --type secret_text --text …`):

```bash
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY < path/to/the-key.pem
wrangler secret put HMAC_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put REVIEWER_EMAIL
```

| Secret | What it is |
|---|---|
| `GITHUB_APP_ID` | The app's numeric ID |
| `GITHUB_APP_PRIVATE_KEY` | The whole `.pem` file, as GitHub gave it (BEGIN/END lines included). No `openssl` conversion needed. |
| `HMAC_SECRET` | Signs the Approve/Reject links. `openssl rand -hex 32` |
| `RESEND_API_KEY` | From <https://resend.com/api-keys> |
| `REVIEWER_EMAIL` | Where the digest is sent |

There is no installation-id secret: the Worker finds the installation from the
repo. If the app is not installed on the repo, or the ID and key do not belong
together, the error in the Worker log says which. Once the app works, delete any
old `BOT_GITHUB_PAT` secret and the downloaded `.pem`.

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
node test/test-hardening.mjs  # 50 checks — unsafe links, PR-body injection, bad types, queue cap, paging, caching, deploy config
node test/test.mjs            # 59 checks — README patching, sanitising, HMAC
node test/test-auth.mjs       # 48 checks — GitHub App keys, JWT, token caching, which PRs jobs may touch
node test/test-integration.mjs # 39 checks — real README read from GitHub, mutations mocked
node test/test-review.mjs     # 75 checks — digest, signed links, batch merge
node test/test-admin.mjs      # 43 checks — run tokens, the admin endpoint, dry runs, new-section fix
node test/test-normalize.mjs  # 23 checks — markdown normalisation, no network
node test/test-entry-meta.mjs # 36 checks — {closes; tags} blocks: parser, site, form validation
node test/test-index.mjs      # 39 checks — search index, /api/index.json (cache, failures), ranking
node test/test-opportunity-pr.mjs # 71 checks — the PR of dated leads: file insertion, limits, skipping links already in open PRs, the whole job, all faked
node test/test-employers.mjs # 70 checks — the employer pass: company list, own-domain and portal searches, dated-only judging, into the PR, all faked
node test/test-registry.mjs # 56 checks — registry mode: URL filters, locales, page types, primary and alternates, the retry, all faked
node test/test-opportunities.mjs # 173 checks — opportunity digest, Tavily and GitHub faked
node test/browser/run.mjs      # 154 checks — the six pages in headless Chromium (needs Chromium; skips without it)
```

`test-integration.mjs` reads the real README from GitHub. The repo is public so
it needs no token (set `GITHUB_TOKEN` only if you hit the 60/hour limit). It
mocks every call that would create a branch, commit or PR, so it cannot open a
pull request by accident. `test-auth.mjs` generates its own RSA key and fakes
GitHub, so it needs nothing.

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

A separate job, sharing the Worker and the GitHub App. Every **Monday 07:00
SAST** it searches for bursaries, learnerships, graduate programmes, jobs and
training with [Tavily](https://tavily.com) and opens **one GitHub issue** titled
`Opportunity digest — <date>`. It is a leads list for a human: nothing it finds
goes near the README, and there is no deduplication between weeks.

- **Closing soon:** zabursaries keeps these on one page per month
  (`/bursaries-closing-in-november-2026/`). Tavily's index missed the current
  month's page, so the job builds this month's and the next two URLs and keeps
  the ones that exist (a 404 rules a page out). No search, no credits. The issue
  links each page, and **the page itself is also read** (the same request): each
  row is `<li><a href=…>Bursary name</a> (closing: 8 October 2026)</li>`, an
  individual bursary with its own date, which is far more useful than the link.
  Rows with no date ("closing: none – applications are accepted anytime"), closed
  rows and rows not on zabursaries are skipped. These go to the PR below (not into
  the issue, which would list dozens). **These three requests are the only ones the
  job makes to zabursaries itself, one at a time, 30 seconds apart** (their
  `robots.txt` asks for `Crawl-delay: 30`), so this step takes about a minute.
  A dry run therefore takes about a minute longer than before.
- **Trusted pass:** bursaries by the six README faculties (zabursaries only,
  filed by the faculty in each URL), then learnerships, graduate programmes,
  jobs and training/vac work, also limited to zabursaries (`include_domains`;
  Graduates24 was dropped, see "What the sources allow"). Everything but
  the evergreen faculty hubs is limited to the last month, which turns generic
  listing pages into specific postings.
- **Broader pass (off in the weekly run):** one whole-web search per category,
  with zabursaries, Graduates24, social media and job-board search pages excluded. It is
  kept in the code but not run by the cron, because real runs showed roughly
  half its results were noise (foreign employers, generic careers pages, job
  board listings). Run it on demand with `--with-broad` while tuning, and switch
  it on in the cron (`planSearches({ broad: true })`) once `--min-score` or new
  queries make it trustworthy.
- **Tidying:** home pages, on-site search, pagination and contact pages are
  dropped; titles that only mention past years are dropped; page chrome
  ("Create My CV", WhatsApp banners, sidebars of other listings) is stripped
  from descriptions. A lead with no usable description shows title and link only.
- **Closing dates:** a date comes from the monthly lists above, or from a search
  result's title and snippet. The job never fetches a bursary or job page itself
  to look for one (see "What the sources allow" below). The snippet rules are
  conservative, because a wrong deadline is worse than a missing one: the field
  label ("Closing Date") is trusted first, then a sentence ("close on", "deadline
  is", "apply by", lowercase "closes 30 Nov 2026"); a year is required;
  capitalised "Closes: 30 Sep 2026" is a listing row for *another* opening and is
  ignored; more than one distinct date at the same level means a listing, so no
  date is reported. A lead whose date has passed is dropped. Dated leads show
  `closes YYYY-MM-DD`, and the issue ends with a collapsed **Ready to paste into
  OPPORTUNITIES.md** block: one line per dated lead in the `{closes; tags; source}`
  format, under the heading it goes in. Undated leads are not in it, because an
  entry with no date never expires. The block is a fallback for when the PR below
  is skipped or fails.
- **The PR of dated leads:** the same run then opens **one pull request** adding
  the dated leads to `OPPORTUNITIES.md` (Bursaries under *Paying for It*, the rest
  under *Finding Work*; the file's headings are created if missing). It is opened
  by the **GitHub App**, from a `contribute/opps-<date>-<id>` branch, labelled
  `needs-review`, so it appears in the 08:00 digest email with Approve and Reject
  links and is only merged by the 18:00 job once approved. It is never pushed to
  `main`. Limits: **bursaries from zabursaries only**; **every entry gets our own plain description**
  ("Engineering bursary. See the page for who can apply and how."), never text
  copied from a page or a search snippet; one such PR open at a time (the
  next week says so and skips); at most 15 entries, soonest first; anything whose
  link is already in `README.md` or `OPPORTUNITIES.md` is skipped; only entries
  closing tomorrow or later (a PR is approved and merged after it is opened, so one
  closing today would be dead on arrival). The monthly lists are the main supply:
  the soonest 15 go in the first PR, and the next 15 a week later. The entries
  are read back through the site's own parser before the PR is opened, and if one
  would not come out with its link and date, no PR is opened. If the PR cannot be
  opened for any reason, the issue is still posted and says why. Check each date
  against the page when reviewing; for example a page can say a date passed but
  applications "remain open", and the entry would hide on that date.
- **Cost:** 10 basic searches = **10 Tavily credits per run** (15 with the
  broader pass). No advanced search.
- **Issue label:** `opportunity-digest`, created on first use.

### What the sources allow

Read on 2026-10-03; this is a practical reading, not legal advice, and the sites'
pages can change. Re-read them before widening what the job does.

- **graduates24.com** (Terms & Conditions, `/terms&conditions`): §5.1 forbids
  "systematic or automated data collection … without our express written
  consent" and accessing the site "using any robot, spider or other automated
  means"; §4.2 forbids downloading material beyond browser use; §4.4 forbids
  republishing or redistributing it. Its `robots.txt` allows `*` but blocks AI
  crawlers (GPTBot, ClaudeBot, CCBot…). **So this project does not use
  Graduates24 as a source at all:** it is not searched, not fetched, and any
  result from it is dropped, so none of its text or links reach the weekly issue
  or the site (the README's plain links to its pages are ordinary links, which
  its terms do not restrict). Consent can be asked for through the form on
  `/contact`; with it, its structured listing cards (title, link, `Closes:` date)
  could be read.
- **zabursaries.co.za:** no terms of use page (the usual URLs return 404), only a
  privacy policy with a disclaimer ("published in good faith … at your own risk").
  The footer says "Copyright ZA Bursaries", so their text is not free to copy.
  `robots.txt` has no `Disallow`, only `Crawl-delay: 30`. So: **three requests per
  run, 30 seconds apart; only names, dates and links are taken, and descriptions
  are our own words.** The site invites bursary providers to list for free
  (info@zabursaries.co.za); asking permission to use their closing dates would be
  polite and likely welcome.
- Every entry carries `source: <site>` and links to the original page. The site
  tells users to check dates themselves and not to rely on it alone.

Setup is one secret: `wrangler secret put TAVILY_API_KEY` (key from
<https://app.tavily.com>). Without it only this job fails, with a clear message
in the Worker log; the contribute form and review digest are unaffected.

**Running it on demand, and tuning it.** The script runs the same code as the
cron, from your machine. It is a **dry run by default**: it searches and prints
the issue, and creates nothing on GitHub. Every search costs 1 Tavily credit, dry
run or not, so the useful flags are the ones that let you run less.

```bash
node scripts/run-opportunities.mjs --list              # show the plan and cost, spends nothing
node scripts/run-opportunities.mjs                     # full dry run of the weekly digest, 10 credits; also previews the PR
node scripts/run-opportunities.mjs --post              # for real: the issue AND the PR, as the GitHub App (add --no-pr for the issue only)
node scripts/run-opportunities.mjs --with-broad        # ...plus the broader pass, 15 credits
node scripts/run-opportunities.mjs --only job --explain   # 2 credits: just the job searches, with reasons
node scripts/run-opportunities.mjs --post              # full run, then open the real issue
```

| Flag | What it does |
|---|---|
| `--list` | Print the searches (query, domains, window, cost) and stop. Free. |
| `--with-broad` | Also run the broader whole-web pass, which the weekly digest leaves out. `--only broad` does the same on its own. |
| `--only a,b` | Keep searches whose pass (`scoped`/`broad`), category or faculty contains any term, e.g. `--only learnership,law`. Add `closing` for the closing-soon pages. |
| `--query "text"` | Replace the query text of the searches `--only` selects, to try a new wording. |
| `--time-range X` | `day`, `week`, `month`, `year` or `none`, for every selected search. |
| `--max-results N` | Results per search (1 to 20). |
| `--min-score X` | Drop results Tavily scored below X. In the broader pass the score tracks quality closely: a real run gave 0.75 for a relevant page and 0.23 for a generic careers page, so this is the first thing to try when taming it. |
| `--explain` | Print every result with `KEEP`/`DROP`, its score and the reason it was dropped (noise page, no South Africa signal, past-year title, duplicate, low score). This is how to see what a filter change would do. |
| `--save FILE` | Also write the issue text to a file. |

Any tuning flag makes it a dry run only: `--post` refuses to combine with them,
so a half-run can never be posted as the weekly digest.

It reads `TAVILY_API_KEY` from `.dev.vars` or the environment. `--post` also needs
GitHub access: `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` (the same app, key on one
line with literal `\n`), or `GITHUB_TOKEN` (e.g. `GITHUB_TOKEN=$(gh auth token)` to
post as yourself). The defaults, the faculties and `RECENT` (the one-month window)
live at the top of `src/opportunities.js`; once a flag setting proves itself,
change the default there.

## Testing by hand

### The short way: `mz`

```bash
./scripts/mz status           # open contribution PRs and where each stands
./scripts/mz digest           # preview the review digest (who is emailed, which PRs). Sends nothing.
./scripts/mz digest send      # send it for real (asks you to confirm)
./scripts/mz opps             # run the opportunity searches and show the issue. 10 Tavily credits, posts nothing.
./scripts/mz opps post        # ...and open the real GitHub issue (asks you to confirm)
./scripts/mz opps tune --only job --explain    # tune the searches locally (flags below)
./scripts/mz merge            # preview what the 18:00 job would merge and close
./scripts/mz merge run        # run it now (asks you to confirm)
```

Anything that sends, posts or merges is a **preview by default**, and the real version
shows the preview first and then asks you to type `yes`. `--yes` skips the question;
without a terminal it refuses unless you pass it. To type just `mz` from anywhere:
`ln -s "$(pwd)/scripts/mz" ~/.local/bin/mz`.

### The long way: `trigger.mjs`

You do not have to wait for 08:00, 18:00 or Monday. `scripts/trigger.mjs` (which `mz`
wraps) drives the **live** system, so it tests exactly what the crons do, with the real secrets.

```bash
node scripts/trigger.mjs status                  # open contribution PRs and where each stands (no secrets needed)
node scripts/trigger.mjs submit --section "Law" --content "[Site](https://x.co.za) - what it is"
node scripts/trigger.mjs digest --dry-run        # who would be emailed, and which PRs. Sends nothing.
node scripts/trigger.mjs digest                  # send the review digest email now
node scripts/trigger.mjs merge --dry-run         # what the 18:00 job would merge and close. Changes nothing.
node scripts/trigger.mjs merge                   # run it now
node scripts/trigger.mjs opportunities --dry-run # run the opportunity searches, post no issue (~10 Tavily credits)
node scripts/trigger.mjs opportunities           # open the opportunity issue now
```

- **`--dry-run` always reports and never changes anything**: no email, no merge, no
  comment, no label, no issue. Do one before the real thing.
- **`submit`** goes through the same public API as the form, so it exercises the
  whole path (README patch, branch, PR as the app). Add `--format richtext`,
  `--handle NAME`, `--new-section NAME --pillar NAME`, or `--edit "OLD TEXT"` for a
  correction. `--help` lists everything. It is rate-limited like the form (5 an hour).
- **`status`** reads GitHub's public API, so it works with no setup at all.
- `digest`, `merge` and `opportunities` run on the Worker through `POST
  /api/admin/run`. The command signs a **five-minute token for that one job** with
  `HMAC_SECRET`, the same secret that guards the Approve/Reject links, so there is
  no login to manage. Without the secret there is no way in, and the endpoint only
  ever answers "Unauthorised". Approve links and run tokens are signed differently
  and cannot stand in for each other.

**One-time setup:** `HMAC_SECRET` in your `.dev.vars` must equal the Worker's.
Generate one and set it in both places:

```bash
openssl rand -hex 32                                    # copy the output into .dev.vars as HMAC_SECRET=...
cf workers secrets update HMAC_SECRET --worker mzantsi-vibes --type secret_text \
  --text="$(grep '^HMAC_SECRET=' .dev.vars | cut -d= -f2-)"
```

Rotating it invalidates any Approve/Reject links already emailed (they are signed
with the old one), so do it when none are outstanding.

To try changes locally instead, run `wrangler dev` and add `--url http://localhost:8787`.

## A Cloudflare gotcha: "latest version isn't deployed"

Cloudflare refuses to edit a secret while the newest *uploaded* version of the
Worker isn't the *deployed* one (`[10215] Secret edit failed`). Branch builds upload
versions without deploying them, so any branch push can cause it, and so can every
contribution: the app pushes a `contribute/…` branch, which triggers a build.

- **Fix once:** in the dashboard, Worker → **Settings → Builds → Branch control**,
  add `contribute/*` to the exclusions of the "Deploy non-production branches" trigger.
- **Fix right now:** merge or redeploy `main`, which makes the newest version the
  deployed one, then edit the secret straight away.
- Don't use the error's "deploy the latest version" suggestion: the newest version is
  usually an unreviewed branch.

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

- **08:00 SAST** — digest lists every open PR the contribute form opened that is
  neither approved nor rejected. Already-decided PRs are skipped so they do not nag.
- **Approve** adds `approved` and removes `rejected`/`needs-review`. **Reject**
  does the inverse, so the last click wins and a double-click is harmless.
  (An email client prefetching a link is the reason the brief accepts this.)
- **18:00 SAST** — merges everything labelled `approved` (squash), closes
  everything labelled `rejected` with a comment linking back to the form, strips
  the labels so nothing is reprocessed, and deletes the PR's branch. Safe to run
  twice.
- **Only the form's own PRs are ever touched.** A PR counts as one of ours only
  if an app opened it, from a `contribute/…` branch in this repo. The digest, the
  Approve/Reject endpoint and the merge job all check this, so labelling someone's
  own PR `approved` cannot get it merged.
- `main` has no branch protection and its only ruleset is disabled, so the app
  can merge without an admin bypass. If you ever enable protection, add the app
  to the bypass list or the 18:00 job will start failing.

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
- **Branches live in this repo.** Each submission creates a `contribute/…`
  branch. They are deleted when the PR is merged or closed, but a PR nobody has
  reviewed keeps its branch until someone does.
- **The private key is the crown jewel.** Anyone holding it can act as the app on
  this repo (not elsewhere: the app only has this repo, and only Contents, Pull
  requests and Issues). If it leaks, generate a new key on the app's page, set the
  new secret, and delete the old key there.
- **The digest is single-recipient.** Adding reviewers means a list in
  `REVIEWER_EMAIL` and a link that can only be verified once, so a shared inbox
  would let anyone with the email approve. Keep it to one person until that
  changes.

## Cost

Free on Cloudflare's Workers free tier at this volume. The only real
constraints are the GitHub API rate limit (5,000/hour, and a bad submission
costs about 8 calls) and Resend's daily allowance.
