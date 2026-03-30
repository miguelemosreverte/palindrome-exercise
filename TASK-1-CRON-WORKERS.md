# Task 1: Cron Job Worker Pool for Continuous Ingestion

## Problem

Data ingestion is currently manual — run `ingest run <task>` by hand. But real use cases need continuous updates:
- LinkedIn talent pool: new candidates appear, people change jobs
- MercadoLibre bikes: prices change, new listings appear, old ones sell
- YouTube tutorials: new videos drop daily
- Restaurants in Córdoba: places open, close, get popular
- Flight tickets: prices fluctuate hourly

## Solution

A **worker pool** with a **task queue** and **cron scheduler**. Jobs run on a schedule, workers process them from a queue, results flow into the existing pipeline (HTML → parse → label → report).

## Architecture

```
┌─────────────────┐
│   Cron Scheduler │  ← schedules jobs on intervals
│   (node-cron)    │
└────────┬────────┘
         │ enqueues
         ▼
┌─────────────────┐
│   Task Queue     │  ← SQLite table: job_id, task, status, next_run, interval
│   (SQLite)       │
└────────┬────────┘
         │ dequeues
         ▼
┌─────────────────┐
│   Worker Pool    │  ← N workers (configurable, default 2)
│   (async)        │  ← each worker: fetch → parse → label → report
└────────┬────────┘
         │ writes
         ▼
┌─────────────────┐
│   data/{task}/   │  ← HTML, JSONL, SQLite, reports
└─────────────────┘
```

## Queue Schema (SQLite)

```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  task TEXT NOT NULL,           -- e.g. "ar-senior-devs-linkedin"
  status TEXT DEFAULT 'pending', -- pending | running | done | failed
  interval_minutes INTEGER,     -- how often to run (0 = one-shot)
  next_run TEXT,                -- ISO timestamp
  last_run TEXT,
  last_duration_ms INTEGER,
  last_error TEXT,
  iterations_total INTEGER DEFAULT 0,
  records_total INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## CLI

```bash
# Schedule a recurring job
node bin/cron.js add ar-senior-devs-linkedin --every=60    # every hour
node bin/cron.js add mercado-libre-bikes --every=1440       # daily
node bin/cron.js add youtube-tutorials --every=360           # every 6 hours

# One-shot job
node bin/cron.js run ar-senior-devs-linkedin

# Manage
node bin/cron.js list                    # show all jobs + status
node bin/cron.js pause <job-id>          # pause a recurring job
node bin/cron.js resume <job-id>
node bin/cron.js logs <job-id>           # show run history

# Start the daemon (worker pool)
node bin/cron.js start --workers=2       # start N workers
node bin/cron.js stop
node bin/cron.js status                  # show workers + queue depth
```

## Worker Logic

Each worker loops:
1. Dequeue next pending job (WHERE status='pending' AND next_run <= now)
2. Set status='running'
3. Run the task pipeline:
   - `ingest run <task> --iterations=1` (fetch new pages, save HTML)
   - `ingest parse <task>` (re-parse all HTML → JSONL)
   - `label <task>` (label any unlabeled records)
   - `ingest report <task>` (regenerate report)
4. Set status='done', update last_run, schedule next_run
5. On error: set status='failed', log error, retry after backoff

## URL Deduplication

The scraper already saves HTML keyed by URL. Re-running a task only fetches NEW pages (cursor-based pagination). Already-fetched URLs are skipped. This means:
- First run: fetches all pages
- Subsequent runs: fetches only new pages since last cursor
- Re-parsing is always from ALL saved HTML (complete dataset)

## Concurrency

- Worker pool size is configurable (default 2)
- Each worker runs one task at a time
- Playwright browser instances are expensive — pool limits prevent OOM
- LinkedIn tasks use human emulation with session limits (28-35 profiles/session)

## Files to Create

| File | Purpose |
|------|---------|
| `bin/cron.js` | CLI for scheduling, managing, starting daemon |
| `lib/queue.js` | SQLite-backed job queue (enqueue, dequeue, status) |
| `lib/worker.js` | Worker loop: dequeue → run pipeline → reschedule |

## Dependencies

- `node-cron` or similar for scheduling
- Existing: `lib/scraper.js`, `lib/browser.js`, vendor fetch/parse/clean/label

## Testing

- Unit: queue enqueue/dequeue/status
- Integration: schedule job → worker picks it up → pipeline runs → report generated
- Stress: 5 jobs queued, 2 workers → all complete without race conditions

## Definition of Done

- [ ] `cron.js add` schedules a job
- [ ] `cron.js start` launches worker pool
- [ ] Workers process jobs from queue
- [ ] URL dedup: re-runs don't re-fetch existing pages
- [ ] Recurring jobs reschedule after completion
- [ ] `cron.js list` shows all jobs with status
- [ ] Works for LinkedIn, MercadoLibre, YouTube tasks
