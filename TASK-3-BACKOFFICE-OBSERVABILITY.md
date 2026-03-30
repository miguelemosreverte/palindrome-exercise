# Task 3: Back Office — Observability Dashboard

## Problem

We have no visibility into:
- Where time is being spent across the pipeline
- Which LLM models are being used, by whom, for what
- How many tokens are consumed and what that costs
- Which tasks are running, failing, succeeding
- Per-user vs global usage patterns

The pipeline already collects metrics (`pipeline-metrics.json`, `_metrics` column in SQLite), but there's no dashboard to view them.

## Solution

A **back office web dashboard** that aggregates metrics from all tasks and presents them as:
- Global overview (all users, all tasks)
- Per-user drill-down
- Per-task drill-down
- Cost tracking (tokens → dollars)

## Dashboard Sections

### 1. Global Overview
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Total Tasks  │ Records      │ Tokens Used  │ Estimated    │
│     12       │   2,450      │   450K       │ Cost: $0.85  │
└──────────────┴──────────────┴──────────────┴──────────────┘

[Pipeline Time Breakdown — stacked bar]
  HTML→Text: 2%  |  Extract: 45%  |  Normalize: 42%  |  PostProc: 1%  |  Report: 10%

[Token Usage by Model — horizontal bars]
  gemini-flash-lite: 180K tokens ($0.02)
  mistral-nemo: 120K tokens ($0.05)
  oc-nemotron: 150K tokens (free)
```

### 2. Per-Task View
```
Task: ar-senior-devs-linkedin
  Records: 18 labeled, 0 pending
  Last run: 2 hours ago
  Schedule: every 60 min (cron)

  [Pipeline metrics per record — table]
  | Name | HTML KB | Text KB | Extract ms | Normalize ms | Labels |

  [Cost over time — line chart]
```

### 3. Per-User View
```
User: Miguel
  Active tasks: 3
  Total records: 156
  Tokens this month: 230K ($0.42)

  [Tasks: marketplace, linkedin, youtube]
```

### 4. Model Performance
```
[NL→Controls accuracy by model — from benchmark]
[Labeling quality by model — from pipeline metrics]
[Latency distribution — histogram]
```

## Data Sources

| Source | Location | What |
|---|---|---|
| Pipeline metrics | `data/{task}/pipeline-metrics.json` | Per-run: tokens, time, stages |
| Per-record metrics | `_metrics` column in SQLite | Per-record: HTML size, LLM calls |
| NL benchmark | `tests/nl-controls-benchmark.json` | Model accuracy, latency |
| Job queue | `data/jobs.sqlite` (from Task 1) | Schedules, run history, errors |
| User profile | `~/.opencode-ingest/user.json` (from Task 2) | Preferences, active tasks |

## Cost Calculation

```javascript
const PRICING = {
  'gemini-flash-lite': { input: 0.10, output: 0.40 },  // per 1M tokens
  'mistral-nemo': { input: 0.02, output: 0.04 },
  'gemma-4b': { input: 0.01, output: 0.03 },
  'oc-nemotron': { input: 0, output: 0 },  // free
  'oc-bigpickle': { input: 0, output: 0 },
};
// cost = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000
```

## Implementation

| File | Purpose |
|------|---------|
| `bin/backoffice.js` | Web server serving the dashboard |
| `bin/metrics.js` | Aggregate metrics from all tasks |
| `web/backoffice.html` | Dashboard UI (reuse WSJ theme) |

The dashboard reuses `bin/charts.js` (horizontal bars, tag clouds) and the WSJ styling from `bin/md2html.js`.

## API Endpoints

```
GET /api/metrics/global          → aggregated stats
GET /api/metrics/task/:name      → per-task metrics
GET /api/metrics/models          → model comparison
GET /api/metrics/cost            → cost breakdown
```

## Definition of Done

- [ ] Dashboard shows global overview (tasks, records, tokens, cost)
- [ ] Pipeline time breakdown visible per stage
- [ ] Token usage by model with cost translation
- [ ] Per-task drill-down with per-record metrics table
- [ ] Cost calculation matches actual API pricing
- [ ] Refreshes automatically (SSE or polling)
- [ ] Reuses existing chart components
