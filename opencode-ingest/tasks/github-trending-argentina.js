import { Scraper } from '../lib/scraper.js';

/**
 * GitHub — Trending repos by Argentine developers
 * Public, no auth. Scrapes trending + search for location:Argentina.
 */
export default class GitHubTrendingArgentinaScraper extends Scraper {
  sources() {
    const queries = [
      'https://github.com/search?q=location%3AArgentina+stars%3A%3E10&type=repositories&s=stars&o=desc',
      'https://github.com/search?q=location%3AArgentina+language%3APython&type=repositories&s=stars&o=desc',
      'https://github.com/search?q=location%3AArgentina+language%3ATypeScript&type=repositories&s=stars&o=desc',
      'https://github.com/search?q=location%3AArgentina+language%3AGo&type=repositories&s=stars&o=desc',
      'https://github.com/search?q=location%3AArgentina+language%3ARust&type=repositories&s=stars&o=desc',
    ];
    const idx = this.meta.iteration % queries.length;
    return [{ name: 'GitHub Search', url: queries[idx] }];
  }

  async extract(page) {
    await page.waitForTimeout(3000);

    return page.evaluate(() => {
      const repos = [];
      document.querySelectorAll('[data-testid="results-list"] > div, .repo-list-item, [class*="search-title"] a, .Box-row').forEach(el => {
        const linkEl = el.querySelector('a[href*="github.com/"]') || el.querySelector('a');
        const name = linkEl?.textContent?.trim() || '';
        const url = linkEl?.href || '';

        const descEl = el.querySelector('p, [class*="description"], .Box-row p');
        const description = descEl?.textContent?.trim()?.substring(0, 300) || '';

        const langEl = el.querySelector('[itemprop="programmingLanguage"], [class*="language"], span[class*="repo-language"]');
        const language = langEl?.textContent?.trim() || '';

        const starsEl = el.querySelector('a[href*="stargazers"], [class*="star"]');
        const stars = starsEl?.textContent?.trim() || '';

        const topicEls = el.querySelectorAll('a[class*="topic"], .topic-tag');
        const topics = [...topicEls].map(t => t.textContent.trim()).join(', ');

        if (name && url && url.includes('github.com/')) {
          repos.push({ name, url, description, language, stars, topics, source: 'github' });
        }
      });
      return repos;
    });
  }

  async nextPage(page) {
    if (this.meta.iteration >= 10) return false;
    const next = await page.$('a.next_page, [rel="next"], a:has-text("Next")');
    if (!next) return false;
    await next.click();
    await page.waitForTimeout(3000);
    return true;
  }
}
