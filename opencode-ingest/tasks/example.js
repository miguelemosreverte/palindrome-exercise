import { Scraper } from '../lib/scraper.js';

/**
 * Example task — scrapes Hacker News front page.
 * The agent creates real tasks following this pattern.
 *
 * Usage: npm run ingest -- --task=example
 */
export default class ExampleScraper extends Scraper {
  sources() {
    return [{ name: 'Hacker News', url: 'https://news.ycombinator.com/' }];
  }

  async extract(page) {
    return page.evaluate(() => {
      return [...document.querySelectorAll('.athing')].map(row => {
        const title = row.querySelector('.titleline a');
        const subtext = row.nextElementSibling;
        const score = subtext?.querySelector('.score')?.textContent || '0 points';
        return {
          rank: row.querySelector('.rank')?.textContent?.replace('.', '') || '',
          title: title?.textContent || '',
          url: title?.href || '',
          score: score.replace(' points', ''),
          site: row.querySelector('.sitebit a')?.textContent || '',
        };
      });
    });
  }

  async nextPage(page) {
    const moreLink = await page.$('a.morelink');
    if (!moreLink || this.meta.iteration >= 3) return false; // cap at 3 pages for example
    await moreLink.click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    return true;
  }
}
