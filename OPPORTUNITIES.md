# Mzantsi Vibes — Opportunities

Time-sensitive entries: bursary deadlines, graduate programme windows, vac work.
Evergreen guides live in [`README.md`](README.md). The site reads both files and
hides an entry once its `closes` date has passed, so nothing here needs pruning.

## Format

Same layout as the README: a `##` pillar (spelled exactly as in the README), a
`###` section, then one line per entry:

```
-   [Name](https://link) — What it is and who it's for. {closes: 2026-11-30; tags: bursary, deadline; source: zabursaries.co.za}
```

The `{…}` block is optional, goes at the end of the line, and takes `;`-separated
fields:

| Field | Value |
|---|---|
| `closes` | Last day to apply, `YYYY-MM-DD`. The entry shows until the end of that day (SAST). |
| `updated` | Date the entry was last checked, `YYYY-MM-DD`. |
| `tags` | Comma-separated lowercase words, e.g. `bursary, deadline`. |
| `source` | Where it was found. |

A `closes` the site cannot read hides the entry, so check the date.

## 🎓 I'm Going to Study

## 💼 I'm Going to Work

## 🤷 I Don't Know Yet

## 📋 For Everyone
