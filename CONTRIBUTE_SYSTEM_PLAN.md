Build a community contribution system for the Mzantsi Vibes site (single README.md site, Cloudflare Worker deployment, wrangler.jsonc already present).

GOAL: let non-technical people submit content without needing GitHub knowledge.

TWO SUBMISSION FLOWS:
1. Edit/correction to existing README content
2. New resource or written piece, targeting an existing or new README section

FORM:
- New page on the existing site (e.g. /contribute)
- No account required
- Fields: flow type, target section, content, optional contributor handle (for credit), no PII required
- Submits to a Cloudflare Worker endpoint

SUBMISSION → PR:
- Worker receives the form POST
- Formats the submission into a diff/patch against README.md
- Opens a PR via a dedicated bot GitHub account (separate from Tim's personal account; token lives in Worker secrets, never in repo)
- PR body includes: flow type, target section, contributor handle if given, raw submitted content for reviewer context

REVIEW — NO DATABASE, NO REVIEWER LOGIN:
- Scheduled Worker (cron trigger) runs each morning, finds open bot PRs, emails a digest to the reviewer (just Tim for now) listing each pending PR
- Each PR in the digest has two links: Approve and Reject
- Links use signed (HMAC) tokens encoding PR number + action + expiry — stateless, no KV/database. Note: a link could theoretically be clicked twice before batch merge (e.g. email client prefetch); acceptable for now since a duplicate approve/reject is a harmless no-op
- Clicking a link hits a Worker endpoint that verifies the signature, then labels the PR (approved/rejected) via GitHub API — does NOT merge immediately

BATCH MERGE:
- Second scheduled Worker runs at 6pm daily
- Merges all PRs labeled "approved" that day
- Closes PRs labeled "rejected" (with a comment, if easy)

SECRETS NEEDED (Wrangler secrets, not committed):
- Bot GitHub PAT (fine-grained, Contents + PRs read/write only, this repo only)
- HMAC signing secret
- Email sending credentail (whatever provider — ask if unclear, e.g. Resend, Mailgun, or GitHub's own notification if that's simpler)

DELIVERABLES, IN ORDER:
1. Contribute form page
2. Worker: form submission → PR
3. Worker: daily digest email with approve/reject links
4. Worker: approve/reject endpoint (labels PR, doesn't merge)
5. Worker: 6pm batch merge/close job

Constraints: no user database, no contributor accounts, minimal new infra beyond what wrangler.jsonc already sets up. Prioritize simplicity — this is low-traffic right now, don't over-engineer for scale.
