/**
 * YouTube — record cleaner
 */

export function clean(r) {
  if (r.url) {
    try {
      const u = new URL(r.url);
      const v = u.searchParams.get('v');
      if (v) r.url = `https://www.youtube.com/watch?v=${v}`;
    } catch {}
  }

  if (r.duration) r.duration = r.duration.trim();

  return r;
}
