import { Scraper } from '../lib/scraper.js';

/**
 * YouTube — Claude Code tutorial videos
 * Public search, no auth needed.
 */
export default class YouTubeClaudeCodeScraper extends Scraper {
  sources() {
    return [{ name: 'YouTube', url: 'https://www.youtube.com/results?search_query=claude+code+tutorial' }];
  }

  async extract(page) {
    // Accept cookies if prompted
    await page.click('button[aria-label*="Accept"], button:has-text("Accept all")').catch(() => {});
    await page.waitForTimeout(2000);

    // Scroll to load more results
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
    }

    return page.evaluate(() => {
      const videos = [];
      document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer').forEach(el => {
        const titleEl = el.querySelector('#video-title, a#video-title-link, h3 a');
        const title = titleEl?.textContent?.trim() || '';
        const url = titleEl?.href || '';

        const channelEl = el.querySelector('#channel-name a, ytd-channel-name a, [class*="channel"] a');
        const channel = channelEl?.textContent?.trim() || '';

        const viewsEl = el.querySelector('#metadata-line span, [class*="metadata"] span');
        const views = viewsEl?.textContent?.trim() || '';

        const timeEl = el.querySelectorAll('#metadata-line span, [class*="metadata"] span')[1];
        const published = timeEl?.textContent?.trim() || '';

        const durationEl = el.querySelector('[class*="time-status"] span, ytd-thumbnail-overlay-time-status-renderer span');
        const duration = durationEl?.textContent?.trim() || '';

        const descEl = el.querySelector('#description-text, .metadata-snippet-text');
        const description = descEl?.textContent?.trim()?.substring(0, 200) || '';

        if (title && url && !url.includes('/shorts/')) {
          videos.push({ title, url, channel, views, published, duration, description, source: 'youtube' });
        }
      });
      return videos;
    });
  }

  async nextPage(page) {
    // YouTube infinite scroll — just scroll more
    if (this.meta.iteration >= 5) return false;
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1500);
    }
    // Check if new content loaded
    const count = await page.evaluate(() => document.querySelectorAll('ytd-video-renderer').length);
    return count > (this.meta.totalRecords || 0);
  }
}
