# OpenCode Ingest — Agent-Driven Data Ingestion Framework

## Philosophy

This project is **built by the agent, for the agent**. The agent evolves the scraper scripts
over time, adding domain knowledge, pagination logic, and normalization rules incrementally.

Each "task" is a domain (real-estate, hr, linkedin, etc.) with its own:
- Puppeteer scraper (iterator pattern with `.next()`)
- Raw data store (JSON lines in `data/{task}/raw/`)
- SQLite normalized database (`data/{task}/db.sqlite`)
- Living Markdown report → HTML (`output/{task}/index.html`)

## Architecture

```
src/
├── ingest.js          ← Main entry: picks task, runs scraper.next(), stores raw, normalizes, reports
├── scraper.js         ← Base scraper class with .next() iterator pattern
├── normalize.js       ← Raw JSON → SQLite normalization
├── report.js          ← SQLite → Markdown with ```chartjs``` blocks + insights
├── md2html.js         ← Universal Markdown → HTML converter (Chart.js, tables, timeline)
└── tasks/             ← One file per domain (the agent creates these over time)
    └── example.js     ← Template task

data/{task}/
├── raw/               ← JSON lines files, one per iteration (001.jsonl, 002.jsonl, ...)
├── db.sqlite          ← Normalized relational data
└── meta.json          ← Task metadata: source URLs, page cursor, iteration count

output/{task}/
├── report.md          ← Generated Markdown report
└── index.html         ← Rendered HTML (always viewable)
```

## Iteration Cycle

Each invocation of `npm run ingest -- --task=<name>` does ONE iteration:

1. **Discover** — If no task file exists, agent researches known sites for the domain
2. **Scrape** — Call `scraper.next()` → fetches next page(s), returns raw records
3. **Store** — Append raw JSON lines to `data/{task}/raw/{iteration}.jsonl`
4. **Normalize** — Parse raw → insert/update SQLite tables
5. **Report** — Query SQLite → generate Markdown with Chart.js charts
6. **Render** — Convert Markdown → HTML via `md2html.js`

The agent can invoke this repeatedly. Each run picks up where the last left off (cursor in meta.json).

## Report Structure (every task follows this)

```markdown
# {Task Name} — Ingestion Report

## Timeline
- **Iteration 1** (2024-01-15): Scraped 50 records from site-a.com/page/1
- **Iteration 2** (2024-01-15): Scraped 50 records from site-a.com/page/2
...

## Overview
{Agent-written insights and conclusions about the data}

## Charts
```chartjs
{ "type": "line", "data": { ... } }
```

## Data
| Column A | Column B | ... |
|----------|----------|-----|
| ...      | ...      | ... |
```

## Commands

```bash
# Run one iteration for a task
npm run ingest -- --task=real-estate

# Regenerate report without scraping
npm run report -- --task=real-estate

# Convert any markdown to HTML
npm run md2html -- input.md output.html

# Serve output folder
npm run serve
```

## Agent Guidelines

- **Create task files incrementally** — don't try to build the perfect scraper upfront
- **Store raw data first** — normalize later; raw is the source of truth
- **Pagination via cursor** — meta.json tracks where we left off
- **Max 100 pages per task** unless explicitly told otherwise
- **Reports are append-friendly** — each iteration adds to the timeline
- **Insights should be specific** — not generic summaries, actual patterns found in data
