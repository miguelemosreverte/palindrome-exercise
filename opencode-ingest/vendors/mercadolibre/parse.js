/**
 * MercadoLibre — HTML parser
 * Extracts product listings from saved search result HTML pages.
 * Uses poly-component classes (MercadoLibre's web component system).
 */

export function parsePage(html, url) {
  const records = [];
  const items = html.split(/<li[^>]*class="[^"]*ui-search-layout__item[^"]*"/);

  for (let i = 1; i < items.length; i++) {
    const chunk = items[i].substring(0, 10000);

    // Title
    const titleMatch = chunk.match(/poly-component__title[^>]*>([^<]+)/)
      || chunk.match(/polycard_[^>]*title[^>]*>([^<]+)/);
    const title = titleMatch?.[1]?.trim() || '';

    // URL — prefer direct article link
    const articleUrlMatch = chunk.match(/href="(https:\/\/articulo\.mercadolibre\.com\.ar\/MLA-[^"]+)"/);
    const clickUrlMatch = chunk.match(/href="(https:\/\/[^"]*(?:click1\.mercadolibre|www\.mercadolibre)[^"]*)"/);
    const itemUrl = (articleUrlMatch?.[1] || clickUrlMatch?.[1] || '').split('#')[0];

    // Price
    const allFractions = [...chunk.matchAll(/andes-money-amount__fraction[^>]*>([^<]+)/g)].map(m => m[1].trim());
    const currencyMatch = chunk.match(/andes-money-amount__currency-symbol[^>]*>([^<]+)/);
    const currency = currencyMatch?.[1]?.trim() || '$';
    const fraction = allFractions[0] || '';
    const priceNum = fraction ? parseFloat(fraction.replace(/\./g, '')) : 0;

    // Discount + original price
    const discountMatch = chunk.match(/andes-money-amount__discount[^>]*>([^<]*\d+%[^<]*)/);
    const discount = discountMatch?.[1]?.trim() || '';
    const originalPrice = allFractions.length > 1 ? parseFloat(allFractions[1].replace(/\./g, '')) : 0;

    // Image
    const imgMatch = chunk.match(/src="(https:\/\/http2\.mlstatic\.com\/D_[^"]+)"/)
      || chunk.match(/data-src="(https:\/\/http2\.mlstatic\.com\/D_[^"]+)"/);
    const image = imgMatch?.[1] || '';

    // Seller
    const sellerBlock = chunk.match(/poly-component__seller[\s\S]*?(?=poly-component__|$)/)?.[0] || '';
    const sellerTexts = [...sellerBlock.matchAll(/>([^<]{2,60})</g)].map(m => m[1].trim()).filter(t => t && !/poly-|andes-|class=/.test(t));
    const seller = sellerTexts.join(' ').trim();

    // Shipping
    const shipBlock = chunk.match(/poly-component__shipping[\s\S]*?(?=poly-component__|<\/li|$)/)?.[0] || '';
    const shipTexts = [...shipBlock.matchAll(/>([^<]{2,80})</g)].map(m => m[1].trim()).filter(t => t && !/poly-|andes-|class=/.test(t));
    const shipping = shipTexts[0] || '';
    const freeShipping = /gratis|free/i.test(shipBlock);

    // Rating
    const ratingMatch = chunk.match(/>(\d\.\d)</);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // Installments
    const installBlock = chunk.match(/poly-(?:price__installments|component__installments)[\s\S]*?(?=poly-component__|<\/li|$)/)?.[0] || '';
    const installTexts = [...installBlock.matchAll(/>([^<]{2,60})</g)].map(m => m[1].trim()).filter(t => /\d/.test(t));
    const installments = installTexts.join(' ').replace(/\s+/g, ' ').trim();

    // Variations
    const variationsMatch = chunk.match(/Disponible en (\d+) colores?/i);
    const colorVariants = variationsMatch ? parseInt(variationsMatch[1]) : 0;

    // Brand
    const brandMatch = seller.match(/por\s+(.+)/i);
    const brand = brandMatch?.[1]?.trim() || '';
    const storeName = seller.replace(/\s*por\s+.*/i, '').trim();

    // Coupon
    const couponMatch = chunk.match(/poly-component__coupons[\s\S]*?>([^<]{3,40})</);
    const coupon = couponMatch?.[1]?.trim() || '';

    // Is ad
    const isAd = /poly-component__ads|>Ad<|>Publicidad</i.test(chunk);

    if (title) {
      records.push({
        title,
        price: priceNum > 0 ? `${currency}${fraction}` : '',
        _price_num: priceNum,
        original_price: originalPrice > 0 ? `${currency}${allFractions[1] || ''}` : '',
        discount,
        url: itemUrl,
        image,
        seller: storeName || seller,
        brand,
        shipping: freeShipping ? (shipping || 'Envío gratis') : shipping,
        free_shipping: freeShipping,
        installments,
        rating,
        color_variants: colorVariants,
        coupon,
        is_ad: isAd,
        source: 'mercadolibre',
      });
    }
  }
  return records;
}
