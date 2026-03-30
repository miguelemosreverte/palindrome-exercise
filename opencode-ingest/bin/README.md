# bin/

CLI tools. Each is a standalone executable (`#!/usr/bin/env node`).

## Pipeline tools

### ingest.js -- Orchestrator

The main entry point. Runs the full pipeline or individual stages.

```bash
node bin/ingest.js run <task> [--iterations=N] [--refetch]   # Full: fetch + parse + normalize + report
node bin/ingest.js parse <task|all>                          # Re-parse saved HTML (offline)
node bin/ingest.js report <task>                             # Regenerate report only
node bin/ingest.js render <file.md> [output.html]            # Markdown -> HTML

node bin/ingest.js browse <url> [--domain=.example.com]      # Open URL with Chrome cookies
node bin/ingest.js cookies <domain>                          # Show decrypted Chrome cookies

node bin/ingest.js list                                      # Show tasks + record counts
node bin/ingest.js new <name>                                # Scaffold a new task
node bin/ingest.js status <task>                             # Show iteration history
```

Pipeline stages: fetch HTML -> parse records -> clean -> normalize to SQLite -> generate report.

### label.js -- Two-pass LLM labeling

Enriches SQLite records with LLM-generated labels. Two passes:

1. **Extract**: LLM reads raw profile text, outputs free-form labels (domain, seniority, skills, location)
2. **Normalize**: LLM maps raw labels to pipe-delimited taxonomy paths (`Engineering|Backend|Java`)

```bash
node bin/label.js <task>                         # Label all unlabeled records
node bin/label.js <task> --limit=10              # First 10 only (for iteration)
node bin/label.js <task> --model=qwen-32b        # Specific model
node bin/label.js <task> --reset                 # Clear all labels, start fresh
node bin/label.js --list-models                  # Show available models + pricing
```

Uses ChutesAI API. Set `CHUTESAI_API_KEY` env var or in `../.env`.

### normalize.js -- JSONL to SQLite

Reads `data/{task}/raw/records.jsonl`, creates/updates `data/{task}/db.sqlite`. Auto-creates table schema from first record's keys. Uses sql.js (pure JS, no native dependencies).

Called automatically by `ingest.js run` and `ingest.js parse`.

### report.js -- SQLite to HTML report

Reads SQLite, detects layout type (graph/feed/grid/table) from task name heuristics and column names, generates Markdown with embedded chart data, then converts to HTML via md2html.js.

```bash
node bin/report.js --task=<name>
```

### md2html.js -- Markdown to HTML renderer

Full-featured Markdown-to-HTML converter with custom extensions: Chart.js code blocks, embedded JSON data blocks, WSJ-inspired typography, faceted filter UI injection, and responsive layouts.

### charts.js -- Chart components

Exports `horizontalBar()`, `tagCloud()`, `chartRow()`, and `CHARTS_CSS`. All charts are pure HTML/CSS -- no Chart.js for bar charts. Responsive, reactive to filter changes.

## Query tools

### serve.js -- Local HTTP server

Serves generated reports from `output/` and exposes two API endpoints:

- `POST /api/nl-controls` -- NL->Controls (natural language to UI filter states)
- `POST /api/query` -- NL->SQL->results (legacy, uses OpenCode for SQL generation)

```bash
node bin/serve.js [--port=3456] [--opencode=9001]
```

The NL->Controls endpoint uses a model cascade: gemini-flash-lite -> mistral-nemo -> OpenCode free models. Each result is validated against actual filter values before returning.

### nl-to-controls.js -- Natural language to UI controls

Maps natural language queries to exact UI control states instead of SQL. Output is a JSON object like:

```json
{"domain": "engineering", "city": "Argentina|Cordoba", "skill_categories": ["Engineering"], "skills": ["Java"]}
```

The UI applies these as filter selections. Deterministic, sub-second, benchmarkable.

```bash
node bin/nl-to-controls.js <task> "senior java devs in cordoba"
node bin/nl-to-controls.js <task> --benchmark              # Run all models
node bin/nl-to-controls.js <task> --benchmark --rebuild    # Force re-run
```

### query.js -- Showcase query engine

Pre-computes 10 showcase SQL queries for reports and provides a CLI for ad-hoc queries.

```bash
node bin/query.js <task>                     # Run all showcase queries
node bin/query.js <task> senior              # Run specific showcase by ID
node bin/query.js <task> "SELECT ..."        # Run arbitrary SQL
```

## Agent tools

### agent.js -- Conversational browser agent

Interactive web UI for guided scraping sessions. Agent navigates sites, takes screenshots, asks the user for credentials/decisions via chat. Uses SSE for real-time updates.

```bash
node bin/agent.js
# Open http://localhost:3456
```

## How the tools connect

```
ingest.js run
  |-> vendor/fetch.js (saves HTML)
  |-> vendor/parse.js + clean.js (HTML -> JSONL)
  |-> normalize.js (JSONL -> SQLite)
  |-> report.js + md2html.js + charts.js (SQLite -> HTML)

label.js (enriches SQLite with LLM labels)

serve.js
  |-> serves output/ as static files
  |-> POST /api/nl-controls -> nl-to-controls.js -> JSON response
  |-> POST /api/query -> serve.js NL->SQL -> SQLite -> JSON response
```
