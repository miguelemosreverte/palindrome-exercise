/**
 * GitHub — fetcher
 * Navigates search results. Uses domcontentloaded (not networkidle — GitHub SPAs hang).
 */
import { Scraper } from '../../lib/scraper.js';

export class GitHubFetcher extends Scraper {
  constructor(taskName, dataDir, config = {}) {
    super(taskName, dataDir);
    this.query = config.query || 'location:Argentina stars:>10';
    this.language = config.language || '';
    this.maxPages = config.maxPages || 10;
  }

  sources() {
    let q = this.query;
    if (this.language) q += ` language:${this.language}`;
    return [{ name: 'GitHub', url: `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories&s=stars&o=desc` }];
  }

  async next() {
    // Override to use domcontentloaded instead of networkidle (GitHub hangs on networkidle)
    const { createBrowser } = await import('../../lib/browser.js');
    const { writeFileSync, mkdirSync } = await import('fs');
    const { join } = await import('path');

    const { browser, page, close } = await createBrowser({ domain: this.cookieDomain, locale: 'en-US' });
    try {
      const url = this.meta.cursor || this.sources()[0]?.url;
      if (!url) throw new Error('No URL');
      const iterNum = this.meta.iteration + 1;
      console.log(`[${this.taskName}] Iteration ${iterNum} → ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Save HTML
      await this.savePageHtml(page, String(iterNum).padStart(3, '0'));

      // Lightweight extraction
      const records = await page.evaluate(() => {
        const repos = [];
        document.querySelectorAll('[data-testid="results-list"] > div a[class*="v-align-middle"]').forEach(a => {
          repos.push({ name: a.textContent.trim(), url: a.href, source: 'github' });
        });
        return repos;
      });
      console.log(`[${this.taskName}] Extracted ${records.length} records`);

      // Screenshot
      mkdirSync(join(this.dataDir, 'screenshots'), { recursive: true });
      await page.screenshot({ path: join(this.dataDir, 'screenshots', `iter-${iterNum}.png`), fullPage: true });

      // Save JSONL
      this.meta.iteration = iterNum;
      const rawFile = join(this.rawDir, `${String(iterNum).padStart(3, '0')}.jsonl`);
      writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      // Next page
      const next = await page.$('a.next_page, [rel="next"]');
      const hasNext = !!next && iterNum < this.maxPages;
      if (hasNext) await next.click(), await page.waitForTimeout(3000);
      this.meta.cursor = hasNext ? page.url() : null;
      this.meta.totalRecords += records.length;
      this.meta.history.push({ iteration: iterNum, date: new Date().toISOString(), url, records: records.length });
      this.saveMeta();
      return { records, iteration: iterNum, hasNext };
    } finally {
      await close();
    }
  }

  async extract(page) { return []; }
  async nextPage(page) { return false; }
}
