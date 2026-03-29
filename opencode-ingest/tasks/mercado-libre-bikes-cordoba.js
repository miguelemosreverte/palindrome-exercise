import { Scraper } from '../lib/scraper.js';

/**
 * MercadoLibre — Bikes for sale in Córdoba, Argentina
 * Public site, no auth needed. Paginated search results.
 */
export default class MercadoLibreBikesScraper extends Scraper {
  sources() {
    return [{ name: 'MercadoLibre', url: 'https://listado.mercadolibre.com.ar/bicicleta_OrderId_PRICE_Ubicaci%C3%B3n_C%C3%B3rdoba#applied_filter_id%3Dcity%26applied_filter_name%3DCiudad%26applied_filter_order%3D4%26applied_value_id%3DTUxBQ0NPUmFkZGIw%26applied_value_name%3DC%C3%B3rdoba' }];
  }

  async extract(page) {
    await page.waitForSelector('.ui-search-layout', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    return page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.ui-search-layout__item, .ui-search-result, [class*="ui-search-layout__item"]').forEach(card => {
        const titleEl = card.querySelector('a.ui-search-link__title-card, h2 a, .ui-search-item__title, a[class*="title"]');
        const title = titleEl?.textContent?.trim() || card.querySelector('h2, h3')?.textContent?.trim() || '';
        const url = titleEl?.href || card.querySelector('a')?.href || '';

        const priceEl = card.querySelector('.andes-money-amount__fraction, [class*="price"] span, .ui-search-price__second-line span');
        const price = priceEl?.textContent?.trim() || '';
        const currency = card.querySelector('.andes-money-amount__currency-symbol')?.textContent?.trim() || '$';

        const locationEl = card.querySelector('[class*="location"], .ui-search-item__location, [class*="address"]');
        const location = locationEl?.textContent?.trim() || 'Córdoba';

        const sellerEl = card.querySelector('[class*="seller"], [class*="official-store"]');
        const seller = sellerEl?.textContent?.trim() || '';

        const shippingEl = card.querySelector('[class*="shipping"], [class*="fulfillment"]');
        const shipping = shippingEl?.textContent?.trim() || '';

        const conditionEl = card.querySelector('[class*="condition"], [class*="new"], [class*="used"]');
        const condition = conditionEl?.textContent?.trim() || '';

        if (title && url) {
          items.push({ title, price: `${currency}${price}`, url, location, seller, shipping, condition, source: 'mercadolibre' });
        }
      });
      return items;
    });
  }

  async nextPage(page) {
    if (this.meta.iteration >= 20) return false;
    const next = await page.$('a.andes-pagination__link[title="Siguiente"]');
    if (!next) return false;
    await next.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    return true;
  }
}
