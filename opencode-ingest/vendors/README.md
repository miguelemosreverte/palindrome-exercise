# vendors/

Each vendor is a website-specific scraping module with exactly three files:

```
vendors/{name}/
  fetch.js   -- navigate pages, save raw HTML (uses lib/browser.js + lib/human.js)
  parse.js   -- extract structured records from saved HTML (offline, no network)
  clean.js   -- normalize fields, remove noise, mark junk as _deleted
```

Some vendors have additional files (e.g., LinkedIn has `label.js` for LLM-based labeling).

## Current Vendors

| Vendor | Site | Auth | Notes |
|--------|------|------|-------|
| `linkedin` | linkedin.com | Chrome cookies | Human emulation (Bezier mouse, session rhythm) |
| `mercadolibre` | mercadolibre.com.ar | None | Product listings with price/seller/location |
| `youtube` | youtube.com | Chrome cookies | Video metadata, channels, view counts |
| `github` | github.com | None | Trending repos, user profiles |
| `afip` | afip.gob.ar | Agent-assisted | Argentine tax authority (interactive login) |

## The Pipeline

```
Browser (with cookies)
    |
  fetch.js  -->  data/{task}/html/*.html     (THE RAW DATA -- permanent)
    |
  parse.js  -->  data/{task}/raw/records.jsonl  (derived, regenerable)
    |
  clean.js  -->  same JSONL, cleaned          (removes noise, normalizes)
    |
  normalize.js --> data/{task}/db.sqlite       (derived, regenerable)
```

HTML is the truth. Everything downstream can be regenerated with `node bin/ingest.js parse all`.

## fetch.js

Extends `lib/scraper.js` base class. Must implement:

- `sources()` -- returns `[{ name, url }]` array of starting URLs
- `extract(page)` -- extracts records from the current page (Playwright `page` object)
- `nextPage(page)` -- navigates to next page, returns `true` if there are more pages
- `get cookieDomain()` -- returns cookie domain string (e.g., `.linkedin.com`) or `undefined`

The base class handles HTML saving, iteration tracking, meta.json, and JSONL output automatically.

For sites that require authentication, `cookieDomain` triggers Chrome cookie injection via `lib/chrome-cookies.js`. For sites requiring human-like behavior (LinkedIn), import helpers from `lib/human.js`.

## parse.js

Runs offline on saved HTML files. Exports one of:

- `parseAll(htmlFiles, readFile)` -- for profile-based vendors (LinkedIn: each HTML = one entity)
- `parsePage(html, filename)` -- for list-based vendors (MercadoLibre: each HTML = one search results page with many items)

Returns arrays of plain objects. No network access. The parser can be improved and re-run any time against the saved HTML.

## clean.js

Exports `clean(record)` that receives a single parsed record and returns a cleaned version. Responsibilities:

- Remove UI noise from fields (LinkedIn skill sections contain "mostrar todo", "validar", etc.)
- Normalize company names, titles, locations
- Set `record._deleted = true` for junk records (expired sessions, login prompts)
- Return the cleaned record

## Adding a New Vendor

1. Create `vendors/{name}/` with three files:

```js
// fetch.js
import { Scraper } from '../../lib/scraper.js';

export class MyVendorFetcher extends Scraper {
  constructor(taskName, dataDir, config = {}) {
    super(taskName, dataDir);
    this.query = config.query || 'default search';
  }

  get cookieDomain() { return undefined; } // or '.example.com'

  sources() {
    return [{ name: 'MyVendor', url: `https://example.com/search?q=${this.query}` }];
  }

  async extract(page) {
    // Return array of record objects
    return page.evaluate(() => {
      return [...document.querySelectorAll('.item')].map(el => ({
        title: el.querySelector('h2')?.textContent?.trim(),
        url: el.querySelector('a')?.href,
      }));
    });
  }

  async nextPage(page) {
    const next = await page.$('a.next-page');
    if (!next) return false;
    await next.click();
    await page.waitForLoadState('networkidle');
    return true;
  }
}
```

```js
// parse.js -- offline HTML parsing
export function parsePage(html, filename) {
  // Extract data from raw HTML string
  return [{ title: '...', url: '...' }];
}
```

```js
// clean.js
export function clean(record) {
  if (!record.title) return { ...record, _deleted: true };
  return { ...record, title: record.title.trim() };
}
```

2. Register vendor detection in `bin/ingest.js` `vendorForTask()`:

```js
if (n.includes('myvendor')) return 'myvendor';
```

3. Create a task in `tasks/`:

```js
import { MyVendorFetcher } from '../vendors/myvendor/fetch.js';

export default class extends MyVendorFetcher {
  constructor(name, dir) {
    super(name, dir, { query: 'something specific' });
  }
}
```

4. Run: `node bin/ingest.js run my-task --iterations=3`
