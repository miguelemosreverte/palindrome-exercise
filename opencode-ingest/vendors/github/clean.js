/**
 * GitHub — record cleaner
 */

export function clean(r) {
  if (r.name) r.name = r.name.replace(/\s+/g, ' ').trim();
  if (r.stars) r.stars = r.stars.trim();
  return r;
}
