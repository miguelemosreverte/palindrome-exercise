import { createBrowser } from './browser.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Base scraper with iterator pattern, powered by Playwright.
 * Each task extends this and implements:
 *   - sources()       → array of { name, url } to scrape
 *   - extract(page)   → array of raw record objects from current page
 *   - nextPage(page)  → navigate to next page, return false if no more pages
 */
export class Scraper {
  constructor(taskName, dataDir) {
    this.taskName = taskName;
    this.dataDir = dataDir;
    this.metaPath = join(dataDir, 'meta.json');
    this.rawDir = join(dataDir, 'raw');
    mkdirSync(this.rawDir, { recursive: true });
    this.meta = existsSync(this.metaPath)
      ? JSON.parse(readFileSync(this.metaPath, 'utf8'))
      : { task: taskName, iteration: 0, cursor: null, sources: [], totalRecords: 0, history: [] };
  }

  /** Override in task */
  sources() { return []; }
  async extract(page) { return []; }
  async nextPage(page) { return false; }

  /** One iteration: launch browser, scrape next page(s), save raw, update meta */
  /** Cookie domain for authenticated scraping — override in task if needed */
  get cookieDomain() { return undefined; }

  async next() {
    const { browser, page, close } = await createBrowser({
      domain: this.cookieDomain,
      locale: 'es-AR',
    });

    try {
      const url = this.meta.cursor || this.sources()[0]?.url;
      if (!url) throw new Error(`No URL to scrape for task "${this.taskName}"`);

      console.log(`[${this.taskName}] Iteration ${this.meta.iteration + 1} → ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      const records = await this.extract(page);
      console.log(`[${this.taskName}] Extracted ${records.length} records`);

      // Screenshot for debugging
      const ssDir = join(this.dataDir, 'screenshots');
      mkdirSync(ssDir, { recursive: true });
      await page.screenshot({ path: join(ssDir, `iter-${this.meta.iteration + 1}.png`), fullPage: true });

      // Save raw
      this.meta.iteration++;
      const rawFile = join(this.rawDir, `${String(this.meta.iteration).padStart(3, '0')}.jsonl`);
      writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      // Try to advance to next page
      const hasNext = await this.nextPage(page);
      this.meta.cursor = hasNext ? page.url() : null;
      this.meta.totalRecords += records.length;
      this.meta.history.push({
        iteration: this.meta.iteration,
        date: new Date().toISOString(),
        url,
        records: records.length,
      });

      this.saveMeta();
      return { records, iteration: this.meta.iteration, hasNext };
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
