/**
 * MercadoLibre — fetcher
 * Navigates search pages, saves HTML. No auth needed.
 */
import { Scraper } from '../../lib/scraper.js';

export class MercadoLibreFetcher extends Scraper {
  constructor(taskName, dataDir, config = {}) {
    super(taskName, dataDir);
    this.query = config.query || 'bicicleta';
    this.location = config.location || '';
    this.maxPages = config.maxPages || 50;
  }

  sources() {
    let url = `https://listado.mercadolibre.com.ar/${encodeURIComponent(this.query)}_OrderId_PRICE`;
    if (this.location) url += `_Ubicaci%C3%B3n_${encodeURIComponent(this.location)}`;
    return [{ name: 'MercadoLibre', url }];
  }

  async extract(page) {
    // Accept cookies
    await page.click('button:has-text("Entendido")').catch(() => {});
    await page.waitForTimeout(2000);

    // The HTML is already saved by the base scraper.
    // We do a lightweight DOM extraction here for the initial JSONL.
    // The real extraction happens offline via vendors/mercadolibre/parse.js
    return page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.ui-search-layout__item').forEach(card => {
        const title = card.querySelector('[class*="poly-component__title"]')?.textContent?.trim() || '';
        const price = card.querySelector('[class*="andes-money-amount__fraction"]')?.textContent?.trim() || '';
        const url = card.querySelector('a')?.href || '';
        if (title) items.push({ title, price: '$' + price, url, source: 'mercadolibre' });
      });
      return items;
    });
  }

  async nextPage(page) {
    if (this.meta.iteration >= this.maxPages) return false;
    const next = await page.$('a.andes-pagination__link[title="Siguiente"]');
    if (!next) return false;
    await next.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    return true;
  }
}
