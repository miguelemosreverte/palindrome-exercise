/**
 * YouTube — fetcher
 * Navigates search results, infinite-scrolls, saves HTML.
 * The real data is in ytInitialData JSON — parse.js extracts it offline.
 */
import { Scraper } from '../../lib/scraper.js';

export class YouTubeFetcher extends Scraper {
  constructor(taskName, dataDir, config = {}) {
    super(taskName, dataDir);
    this.query = config.query || 'tutorial';
    this.maxPages = config.maxPages || 10;
  }

  sources() {
    return [{ name: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(this.query)}` }];
  }

  async extract(page) {
    await page.click('button[aria-label*="Accept"], button:has-text("Accept all")').catch(() => {});
    await page.waitForTimeout(2000);

    // Scroll to load more
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
    }

    // Lightweight extraction — real data comes from parse.js on the saved HTML
    return page.evaluate(() => {
      const videos = [];
      document.querySelectorAll('ytd-video-renderer').forEach(el => {
        const title = el.querySelector('#video-title')?.textContent?.trim() || '';
        const url = el.querySelector('#video-title')?.href || '';
        if (title && url) videos.push({ title, url, source: 'youtube' });
      });
      return videos;
    });
  }

  async nextPage(page) {
    if (this.meta.iteration >= this.maxPages) return false;
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1500);
    }
    const count = await page.evaluate(() => document.querySelectorAll('ytd-video-renderer').length);
    return count > (this.meta.totalRecords || 0);
  }
}
