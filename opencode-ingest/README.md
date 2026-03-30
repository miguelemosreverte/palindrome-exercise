# opencode-ingest

Browser-based data ingestion CLI. Your Chrome session is the universal API.

Scrapes websites using your real Chrome cookies (you stay logged in), saves raw HTML as the permanent record, then parses, labels, and serves interactive reports with faceted filters and charts.

## Quick Start

```bash
npm install

# List available tasks
node bin/ingest.js list

# Run a full pipeline: fetch HTML, parse, normalize to SQLite, generate report
node bin/ingest.js run mercado-libre-bikes-cordoba --iterations=5

# Re-parse all saved HTML (no network needed)
node bin/ingest.js parse all

# Serve reports with NL->Controls API
node bin/serve.js

# LLM labeling (two-pass: extract + normalize)
node bin/label.js ar-senior-devs-linkedin --model=mistral-nemo

# Interactive agent mode (web UI + SSE)
node bin/agent.js
```

## Architecture

```
                    Chrome cookies
                         |
   tasks/           lib/browser.js + lib/human.js
   (config)              |
      |          vendors/{vendor}/fetch.js     <-- saves raw HTML
      |                  |
      |          vendors/{vendor}/parse.js     <-- HTML -> structured records (offline)
      |                  |
      |          vendors/{vendor}/clean.js     <-- normalize, remove noise
      |                  |
      +------->  bin/ingest.js                 <-- orchestrates the pipeline
                         |
                 bin/normalize.js              <-- JSONL -> SQLite (sql.js)
                         |
                 bin/label.js                  <-- two-pass LLM labeling
                         |
                 bin/report.js + bin/charts.js <-- SQLite -> Markdown -> HTML
                         |
                 bin/serve.js                  <-- HTTP server + NL->Controls API
                         |
                 bin/nl-to-controls.js         <-- NL query -> UI filter state
```

## Key Design Decisions

### HTML is the raw data

Every page visited is saved as full HTML to `data/{task}/html/`. JSONL and SQLite are derived artifacts that can be regenerated at any time. If the parser misses something, fix the parser and run `ingest parse all` -- no re-scraping needed.

### Two-pass LLM labeling

1. **Extract** -- LLM reads profile text, outputs raw labels with no constraints. Free-form extraction of domain, seniority, skills, location.
2. **Normalize** -- LLM maps raw labels to a fixed taxonomy using pipe-delimited paths: `Engineering|Backend|Java`. The taxonomy skeleton is fixed but 59% of leaf nodes were invented by the LLM itself.

### Faceted filters replace NL->SQL

The search space is tiny (a few dozen filter values). NL->SQL is overkill and non-deterministic. Instead, `nl-to-controls.js` maps natural language to exact UI control states: dropdown selections, tag toggles, slider positions. The UI then applies filters client-side in sub-second time. Deterministic, benchmarkable, debuggable.

### Model cascade

For NL->Controls translation: gemini-flash-lite (fastest, cheapest) -> mistral-nemo (fallback) -> OpenCode free models (no API key needed). Each attempt is validated against the known filter values; invalid results fall through to the next model.

### Hierarchical taxonomy

Geography uses `Country|City` format: `Argentina|Cordoba`. Skills use the same pattern: `Engineering|Backend|Java`. Queryable with SQL `LIKE 'Engineering|Backend|%'`. Same pipe-delimited convention everywhere.

### Charts are pure CSS

Horizontal bar charts and tag clouds are rendered as HTML/CSS with no JavaScript charting library. They are reactive to filter changes and work at any viewport size.

### Human behavior emulation

LinkedIn scraping uses Bezier-curve mouse movements (Fitts's Law), Gaussian micro-jitter for hand tremor, beta-distributed timing, 3% typo rate with backspace correction, session warm-up periods, and periodic breaks. See `lib/human.js`.

### Chrome cookie extraction

`lib/chrome-cookies.js` reads the Chrome Cookies SQLite database on macOS, decrypts values using the Chrome Safe Storage keychain password (AES-128-CBC for v10, AES-256-GCM for v20), and injects them into Playwright. No manual login needed.

## Project Structure

```
bin/                CLI tools (see bin/README.md)
lib/                Primitives: browser, human emulation, scraper base class, cookies, graph
vendors/            Per-site scraping logic: fetch, parse, clean (see vendors/README.md)
tasks/              Thin config wrappers that combine vendor + query params
agent/              Conversational agent server (web UI + SSE for interactive scraping)
data/               Raw HTML + JSONL + SQLite (gitignored)
output/             Generated HTML reports (gitignored)
tests/              Visual tests, filter playground, NL benchmarks (see tests/README.md)
```

## Adding a New Vendor

See `vendors/README.md` for the three-file pattern (fetch, parse, clean) and step-by-step guide.

## Adding a New Task

```bash
node bin/ingest.js new my-task
# Edit tasks/my-task.js to set vendor + config
node bin/ingest.js run my-task --iterations=3
```

Or create a thin wrapper manually:

```js
import { MercadoLibreFetcher } from '../vendors/mercadolibre/fetch.js';

export default class extends MercadoLibreFetcher {
  constructor(name, dir) {
    super(name, dir, { query: 'notebook', location: 'Buenos Aires', maxPages: 10 });
  }
}
```

## Dependencies

- **playwright** -- browser automation (Chromium)
- **sql.js** -- pure-JS SQLite (no native bindings)
- **marked** -- Markdown to HTML
- **neo4j-driver** -- optional graph database for relationship mapping
