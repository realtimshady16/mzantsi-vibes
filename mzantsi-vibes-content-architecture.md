# Mzantsi Vibes — Content Architecture Decision
*Captured 2026-10-03. For AGENTS.md / CLAUDE.md once back at the repo.*

## The problem

README.md was treating two genuinely different kinds of content as one flat thing:
- **Evergreen** — stable, rarely changes (how NBT works, K53, banking principles)
- **Current** — time-bound (bursary deadlines, grad programme windows, vac work)

A stale evergreen fact is mildly embarrassing. A stale deadline is actively harmful — someone trusts the site, misses a window. Different content, different maintenance needs, different trust requirements.

## Existing infrastructure (already built, confirmed from repo)

- `src/worker.js` — Cloudflare Worker, entry point for everything
- `src/submit.js` — handles public submissions; writes **directly into README.md** via `applyEdit()`/`applyNew()`, no staging file. Forks/branches, commits, opens PR.
- `src/opportunities.js` — weekly cron (Mondays 05:00 UTC) already searches zabursaries.co.za and graduates24.com via Tavily for bursaries/learnerships/grad programmes/jobs. Produces a **GitHub issue of leads for human review** — explicitly does not touch README. Filters obviously-stale results but does not extract a structured deadline field.
- Existing cadence: 8am reviewer digest email (Resend) → human approves/rejects via single-use links → 6pm batch merge of approved items.

## Decision: Option 2 — structured second source

Rather than keep stuffing current content into README, or leaving the opportunity digest as discovery-only forever:

1. **New file: `OPPORTUNITIES.md`** (or similar name, TBD) — structured per-entry, same `##`/`###` auto-discovery heading pattern as README so the existing parser logic is reusable. Each entry carries real fields: name, link, pillar, category, deadline/last-updated, source.
2. **README.md unchanged** — keeps serving evergreen content exactly as now. No migration needed.
3. **Tagging** — every entry (both files) gets lightweight metadata: pillar + tags (e.g. `deadline`, `evergreen`, `translation-needed`). Cheap — just richer frontmatter per entry, parser already walks this structure.
4. **Submission pipeline (`submit.js`) stays README-only for now** — not extending it to write opportunities yet; that's a later nice-to-have once the opportunity digest is extended to draft directly into the new file's format.

## Search: client-side, no backend

Scale check: README currently has ~80–100 entries total. Even 10x that is tens of KB of JSON — trivially fast to load and filter client-side. No backend needed at this scale.

- Build a **combined JSON index** from both README.md and OPPORTUNITIES.md
- Client-side search/filter runs against that index in-browser
- **Expired current items are filtered out automatically** by date comparison — no manual pruning. Dead/expired content just stops appearing rather than needing cleanup.
- Deliberately avoids a backend/database — consistent with the project's existing "no user data, radical transparency" stance (a backend search log would conflict with that).
- Known fallback if ever genuinely needed: self-hosted on existing VPS, or Supabase. Not being reached for preemptively.

## Index build timing: deploy-time, tied to existing 6pm batch merge

- Index is **not** rebuilt on every request (would redo parsing work every page load) and **not** rebuilt on every individual PR merge (unnecessary churn).
- Instead: rebuild the combined JSON index **once, as part of the existing 6pm batch-merge Worker run** — the only point in the day content actually changes.
- Site serves the static built index until the next day's 6pm run.
- Staleness window is at most ~5 minutes in the worst case (e.g. loading at 17:55) — acceptable for a resource site; nothing time-critical enough to need live rebuilds.
- **If there are no approved PRs on a given day, there's nothing to rebuild** — the 6pm run simply does less. No special-casing needed, this falls out naturally from "only rebuild when content changed."
- Known tradeoff: a direct repo-owner edit to README (bypassing the PR/digest flow) won't be reflected until the next 6pm run unless manually triggered. Acceptable, worth remembering when debugging "why hasn't my edit shown up."

## Open / not yet decided

- Exact filename for the new current-content file (`OPPORTUNITIES.md` used as working name)
- Whether current items get their own site section/path, slot into existing pillar cards with a visual "time-sensitive" marker, or both — not yet decided, explicitly parked
- Whether/how `opportunities.js`'s weekly digest eventually writes drafts directly into the new file's format rather than just surfacing a GitHub issue for manual entry
