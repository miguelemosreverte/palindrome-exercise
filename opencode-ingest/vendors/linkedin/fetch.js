/**
 * LinkedIn — fetcher
 * Uses Chrome cookies + human behavior emulation.
 * Saves FULL HTML for every search page + profile page.
 * Lightweight extraction here; real parsing happens offline via parse.js.
 */
import { Scraper } from '../../lib/scraper.js';
import { getChromeCookes } from '../../lib/chrome-cookies.js';
import { humanReadPage, humanNavigate, Session, uniform } from '../../lib/human.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export class LinkedInFetcher extends Scraper {
  constructor(taskName, dataDir, config = {}) {
    super(taskName, dataDir);
    this.queries = config.queries || ['senior software engineer'];
    this.geoUrn = config.geoUrn || '100446943'; // Argentina
    this.maxPages = config.maxPages || 100;
  }

  get cookieDomain() { return '.linkedin.com'; }

  sources() {
    const queryIdx = Math.floor(this.meta.iteration / 10) % this.queries.length;
    const q = encodeURIComponent(this.queries[queryIdx]);
    return [{
      name: 'LinkedIn',
      url: `https://www.linkedin.com/search/results/people/?keywords=${q}&geoUrn=%5B%22${this.geoUrn}%22%5D&origin=FACETED_SEARCH`,
    }];
  }

  /** Override next() — custom flow with human emulation + per-profile HTML saving */
  async next() {
    const { chromium } = await import('playwright');

    const cookies = await getChromeCookes('.linkedin.com');
    if (cookies.length === 0) throw new Error('No LinkedIn cookies — log in to LinkedIn in Chrome');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const cleanCookies = cookies.filter(c => c.name && c.value && c.domain).map(c => {
      const o = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/' };
      if (c.secure) o.secure = true;
      if (c.httpOnly) o.httpOnly = true;
      if (c.expires && c.expires > 0) o.expires = c.expires;
      if (c.sameSite === 'None' && c.secure) o.sameSite = 'None';
      else if (c.sameSite === 'Strict') o.sameSite = 'Strict';
      else o.sameSite = 'Lax';
      return o;
    });
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    const session = new Session({ maxProfiles: Math.floor(uniform(28, 36)) });
    const htmlDir = join(this.dataDir, 'html');
    mkdirSync(htmlDir, { recursive: true });

    try {
      const baseUrl = this.sources()[0].url;
      const pageNum = this.meta.iteration + 1;
      const url = this.meta.cursor || (pageNum > 1 ? `${baseUrl}&page=${pageNum}` : baseUrl);

      console.log(`[${this.taskName}] Iteration ${pageNum} → ${url}`);
      await humanNavigate(page, url);

      // Check login
      const isLoggedIn = await page.evaluate(() => !document.querySelector('.join-form, .login-form'));
      if (!isLoggedIn) throw new Error('Not logged in — cookies may have expired');

      // Scroll search results
      await humanReadPage(page, { minTime: 3000, maxTime: 8000 });

      // Save search page HTML
      writeFileSync(join(htmlDir, `${String(pageNum).padStart(3, '0')}-search.html`), await page.content());

      // Collect profile URLs
      const profileUrls = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('a[href*="/in/"]').forEach(a => {
          const href = a.href?.split('?')[0];
          if (href?.match(/\/in\/[a-z0-9-]+\/?$/i)) urls.add(href);
        });
        return [...urls];
      });

      console.log(`[${this.taskName}] Found ${profileUrls.length} profile URLs`);

      // Visit each profile — save HTML + lightweight extract
      const records = [];
      for (const profileUrl of profileUrls) {
        if (!session.canContinue) { console.log(`[${this.taskName}] Session limit`); break; }

        try {
          await humanNavigate(page, profileUrl);
          await humanReadPage(page, { minTime: 2000, maxTime: 6000 });

          // SAVE PROFILE HTML
          const slug = profileUrl.split('/in/')[1]?.replace(/\//g, '') || 'unknown';
          writeFileSync(join(htmlDir, `${String(pageNum).padStart(3, '0')}-profile-${slug}.html`), await page.content());

          // Lightweight extraction from page title (real parsing via parse.js offline)
          const pageTitle = await page.title();
          const name = pageTitle.replace(/\s*\|?\s*LinkedIn\s*$/, '').trim();

          if (name && name.length > 2) {
            records.push({ name, profileUrl, source: 'linkedin' });
            console.log(`  ✓ ${name}`);
          }
        } catch (err) {
          console.log(`  ✗ ${profileUrl.split('/in/')[1] || profileUrl} — ${err.message.substring(0, 50)}`);
        }

        await session.waitBetweenProfiles();
      }

      // Save JSONL + meta
      this.meta.iteration = pageNum;
      const rawFile = join(this.rawDir, `${String(pageNum).padStart(3, '0')}.jsonl`);
      writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      const pageWithinQuery = (this.meta.iteration % 10) + 1;
      let hasNext = this.meta.iteration < this.maxPages;
      let nextUrl;
      if (records.length === 0 || pageWithinQuery >= 10) {
        this.meta.iteration = Math.ceil(this.meta.iteration / 10) * 10;
        nextUrl = this.sources()[0].url;
      } else {
        nextUrl = `${this.sources()[0].url}&page=${pageWithinQuery + 1}`;
      }

      this.meta.cursor = hasNext ? nextUrl : null;
      this.meta.totalRecords += records.length;
      this.meta.history.push({ iteration: pageNum, date: new Date().toISOString(), url, records: records.length });
      this.saveMeta();

      return { records, iteration: pageNum, hasNext };
    } finally {
      await browser.close();
    }
  }

  async extract() { return []; }
  async nextPage() { return false; }
}
