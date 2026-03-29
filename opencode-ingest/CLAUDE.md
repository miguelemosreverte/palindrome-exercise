# OpenCode Ingest — Browser-Based Data Ingestion CLI

Your Chrome session is the universal API. This tool leverages it for authenticated
scraping, normalization, and live report generation across any domain.

## Quick Start

```bash
npm install
node bin/ingest.js list                    # See available tasks
node bin/ingest.js run example             # Run one iteration
node bin/ingest.js run example --iterations=5
node bin/ingest.js status example          # Check progress
```

## CLI Commands

```bash
# Core pipeline
ingest run <task> [--iterations=N]         # Scrape → normalize → report → HTML
ingest feed <task> [--file=data.json]      # Feed external JSON into pipeline
ingest report <task>                       # Regenerate report from existing data
ingest render <file.md> [output.html]      # Convert any markdown to themed HTML

# Browser session (uses your real Chrome cookies)
ingest browse <url> [--domain=.site.com]   # Open URL authenticated
ingest cookies <domain>                    # Inspect extracted cookies

# Task management
ingest list                                # List tasks + record counts
ingest new <name>                          # Scaffold a new task
ingest status <task>                       # Show iterations, records, cursor
```

## Architecture

```
bin/ingest.js          ← Single CLI entry point
lib/
├── browser.js         ← Playwright + Chrome cookie injection (the primitive)
├── human.js           ← Human behavior emulation (Bezier, Fitts's Law, session rhythm)
├── scraper.js         ← Base Scraper class with .next() iterator pattern
├── normalize.js       ← Raw JSONL → SQLite
├── report.js          ← SQLite → Markdown with ```chartjs``` blocks
├── md2html.js         ← Universal Markdown → themed HTML with Chart.js
├── graph.js           ← Neo4j relationship layer (optional)
└── chrome-cookies.js  ← macOS Chrome cookie decryption
tasks/                 ← Domain scrapers (agent creates these over time)
├── example.js         ← Template (Hacker News)
├── ar-senior-devs.js  ← GetOnBoard jobs
└── ar-senior-devs-linkedin.js  ← LinkedIn with human emulation
```

## Creating a New Task

```bash
ingest new my-domain
# Edit tasks/my-domain.js:
```

```js
import { Scraper } from '../lib/scraper.js';

export default class MyDomainScraper extends Scraper {
  // Inject Chrome cookies for authenticated sites:
  get cookieDomain() { return '.example.com'; }

  sources() {
    return [{ name: 'Source', url: 'https://example.com/data' }];
  }

  async extract(page) {
    return page.evaluate(() => {
      // Return array of record objects
      return [...document.querySelectorAll('.item')].map(el => ({
        title: el.querySelector('h2')?.textContent,
        url: el.querySelector('a')?.href,
      }));
    });
  }

  async nextPage(page) {
    if (this.meta.iteration >= 100) return false;
    const next = await page.$('a[rel="next"]');
    if (!next) return false;
    await next.click();
    await page.waitForLoadState('networkidle');
    return true;
  }
}
```

## Composability

The core primitives are independent and composable:

- **`lib/browser.js`** — `createBrowser({domain})` → authenticated Playwright session
- **`lib/human.js`** — `humanClick()`, `humanScroll()`, `humanType()`, `Session` class
- **`lib/chrome-cookies.js`** — `getChromeCookes(domain)` → cookie array
- **`lib/normalize.js`** — `normalize(task, dir)` → JSONL to SQLite
- **`lib/report.js`** — `generateReport(task)` → Markdown with charts
- **`lib/md2html.js`** — `md2html(input, output)` → themed HTML

Tasks compose these. The LinkedIn scraper uses browser + human + cookies.
A YouTube task would use browser + cookies. A public site just uses browser.

## Data Flow

Each `ingest run` iteration:
1. **Scrape** — `scraper.next()` launches Playwright, calls task's `extract(page)`
2. **Store** — Raw JSONL in `data/{task}/raw/{iteration}.jsonl`
3. **Normalize** — Parse → SQLite `data/{task}/db.sqlite`
4. **Report** — Query → Markdown with Chart.js + data table
5. **Render** — Markdown → `output/{task}/index.html`

Cursor in `meta.json` tracks position. Each run resumes where it left off.

## Report Structure (every task)

```
# {Task} — Ingestion Report
## Timeline        ← iteration log
## Overview        ← agent insights (filled over time)
## Dataset Growth  ← Chart.js line chart
## Records/Iter    ← Chart.js bar chart
## Data            ← scrollable table
```

## Human Behavior Emulation

For sites that detect automation (LinkedIn, etc.), `lib/human.js` provides:
- Mouse: Bezier curves, Fitts's Law velocity, 25% overshoot-and-correct
- Clicks: variable hold (60-180ms), pre-click dwell
- Typing: burst patterns, 3% typo rate, word-boundary pauses
- Scrolling: momentum deceleration, direction changes
- Timing: beta distribution (not uniform random)
- Sessions: warm-up, periodic breaks, daily limits (28-35)
