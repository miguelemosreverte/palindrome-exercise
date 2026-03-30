# tests/

Testing philosophy: screenshot-based visual iteration, Playwright-driven automation, benchmark-driven prompt engineering.

No traditional unit test framework. Tests are standalone Node scripts that output pass/fail with timing. Run them individually.

## Test Suites

### e2e-query.js -- Integration tests

Tests the full query pipeline: SQLite showcase queries, NL->SQL via OpenCode, and pipeline integrity (HTML exists, DB has records, report generated).

```bash
node tests/e2e-query.js              # offline + pipeline tests
node tests/e2e-query.js live         # NL->SQL via OpenCode API
node tests/e2e-query.js showcase     # showcase queries only
node tests/e2e-query.js --rebuild    # re-fetch live query cache
```

Results are cached in `tests/query-cache/` so live tests can run offline after the first pass.

### playground-filters.js -- Filter UI testing

Opens the generated HTML report in a headless Playwright browser and exercises every faceted filter combination: clicks skill tree parent pills, sub-categories, individual skills, domain dropdowns, seniority selectors, city filters. Screenshots every state. Verifies record counts update correctly.

```bash
node tests/playground-filters.js          # run all filter combinations
node tests/playground-filters.js --fix    # attempt to auto-fix issues
```

Output: `tests/filter-screenshots/` -- numbered PNGs showing each filter state. Review these visually to catch layout regressions, missing counts, or broken interactions.

### visual-charts.js -- Chart component screenshots

Renders chart components (horizontal bars, tag clouds) with sample data at multiple viewport widths (desktop, tablet, mobile). Pure visual regression testing.

```bash
node tests/visual-charts.js
```

Output: `tests/chart-screenshots/` -- PNGs at each viewport size.

### nl-controls-benchmark -- NL->Controls model comparison

Benchmark suite for the NL->Controls translator. Runs a fixed set of 13 natural language queries across multiple LLM models and compares accuracy, latency, and token usage.

```bash
node bin/nl-to-controls.js ar-senior-devs-linkedin --benchmark
node bin/nl-to-controls.js ar-senior-devs-linkedin --benchmark --rebuild
node bin/nl-to-controls.js ar-senior-devs-linkedin --benchmark --model=gemini-flash-lite
```

Results saved to:
- `tests/nl-controls-benchmark.json` -- raw results per model per query
- `tests/nl-controls-benchmark.md` -- Markdown report table
- `tests/nl-controls-benchmark.html` -- rendered HTML report

The benchmark validates each result against the actual filter values in the database. Invalid domains, unknown skills, or wrong city formats are flagged as failures.

## Testing Workflow

The iteration cycle for prompt engineering and UI work:

1. **Add a failing case** -- new query to the benchmark, or new filter combination to the playground
2. **Fix the code** -- adjust the prompt, parser, or UI
3. **Run the test** -- verify the fix, check no regressions
4. **Review screenshots** -- visual inspection of filter states and chart rendering
5. **Ship** -- the benchmark JSON is committed as a regression baseline

## Output Directories

```
tests/
  query-cache/           Cached NL->SQL responses (avoid re-fetching)
  filter-screenshots/    Numbered PNGs of filter states
  chart-screenshots/     Chart renders at multiple viewports
```

These directories are populated by test runs and can be safely deleted.
