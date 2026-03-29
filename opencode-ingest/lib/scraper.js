import { createBrowser } from './browser.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Base scraper with iterator pattern, powered by Playwright.
 *
 * CRITICAL: Saves the FULL PAGE HTML for every URL visited.
 * The HTML is the true raw data — JSONL is derived from it.
 * If extraction misses something, we can re-parse from HTML offline.
 *
 * Data layout:
 *   data/{task}/html/{iteration}-{urlhash}.html   ← THE TREASURE
 *   data/{task}/raw/{iteration}.jsonl              ← extracted records (derived)
 *   data/{task}/screenshots/{iteration}.png        ← visual debugging
 *   data/{task}/meta.json                          ← cursor, history
 */
export class Scraper {
  constructor(taskName, dataDir) {
    this.taskName = taskName;
    this.dataDir = dataDir;
    this.metaPath = join(dataDir, 'meta.json');
    this.rawDir = join(dataDir, 'raw');
    this.htmlDir = join(dataDir, 'html');
    mkdirSync(this.rawDir, { recursive: true });
    mkdirSync(this.htmlDir, { recursive: true });
    this.meta = existsSync(this.metaPath)
      ? JSON.parse(readFileSync(this.metaPath, 'utf8'))
      : { task: taskName, iteration: 0, cursor: null, sources: [], totalRecords: 0, history: [] };
  }

  /** Override in task */
  sources() { return []; }
  async extract(page) { return []; }
  async nextPage(page) { return false; }

  /** Cookie domain for authenticated scraping — override in task if needed */
  get cookieDomain() { return undefined; }

  /** Save the full HTML of the current page */
  async savePageHtml(page, label) {
    const html = await page.content();
    const url = page.url();
    const hash = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80);
    const filename = `${label}-${hash}.html`;
    const path = join(this.htmlDir, filename);
    writeFileSync(path, html);
    return path;
  }

  /** One iteration: launch browser, save HTML, extract, save JSONL */
  async next() {
    const { browser, page, close } = await createBrowser({
      domain: this.cookieDomain,
      locale: 'es-AR',
    });

    try {
      const url = this.meta.cursor || this.sources()[0]?.url;
      if (!url) throw new Error(`No URL to scrape for task "${this.taskName}"`);

      const iterNum = this.meta.iteration + 1;
      console.log(`[${this.taskName}] Iteration ${iterNum} → ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // SAVE THE RAW HTML — this is the treasure
      const htmlPath = await this.savePageHtml(page, String(iterNum).padStart(3, '0'));
      console.log(`[${this.taskName}] Saved HTML: ${htmlPath.split('/').pop()}`);

      // Extract structured records from the page
      const records = await this.extract(page);
      console.log(`[${this.taskName}] Extracted ${records.length} records`);

      // Screenshot for visual debugging
      const ssDir = join(this.dataDir, 'screenshots');
      mkdirSync(ssDir, { recursive: true });
      await page.screenshot({ path: join(ssDir, `iter-${iterNum}.png`), fullPage: true });

      // Save extracted records as JSONL (derived data — can be regenerated from HTML)
      this.meta.iteration = iterNum;
      const rawFile = join(this.rawDir, `${String(iterNum).padStart(3, '0')}.jsonl`);
      writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      // Advance to next page
      const hasNext = await this.nextPage(page);
      this.meta.cursor = hasNext ? page.url() : null;
      this.meta.totalRecords += records.length;
      this.meta.history.push({
        iteration: iterNum,
        date: new Date().toISOString(),
        url,
        records: records.length,
        htmlFile: htmlPath.split('/').pop(),
      });

      this.saveMeta();
      return { records, iteration: iterNum, hasNext };
    } finally {
      await close();
    }
  }

  saveMeta() {
    writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2));
  }

  get isDone() {
    return this.meta.iteration > 0 && this.meta.cursor === null;
  }
}
