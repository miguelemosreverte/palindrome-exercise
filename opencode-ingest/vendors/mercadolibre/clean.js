/**
 * MercadoLibre — record cleaner
 * Normalizes prices, titles, shipping text.
 */

export function clean(r) {
  if (r.title) {
    r.title = r.title.replace(/\s+/g, ' ').trim();
    if (r.title.length > 120) r.title = r.title.substring(0, 120).trim();
  }

  if (r.shipping) {
    r.shipping = r.shipping.replace(/\s+/g, ' ').trim();
  }

  return r;
}
