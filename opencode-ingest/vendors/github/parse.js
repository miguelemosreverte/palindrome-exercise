/**
 * GitHub — HTML parser
 * Extracts repo data from GitHub search result pages.
 */

export function parsePage(html, url) {
  const records = [];
  const seen = new Set();

  const repoMatches = [...html.matchAll(/href="\/([^"]+?\/[^"]+?)"[^>]*class="[^"]*v-align-middle[^"]*"/g)];

  for (const m of repoMatches) {
    const repoPath = m[1];
    if (seen.has(repoPath) || repoPath.includes('/blob/') || repoPath.includes('/tree/')) continue;
    seen.add(repoPath);

    const idx = html.indexOf(m[0]);
    const context = html.substring(idx, idx + 3000);

    const descMatch = context.match(/class="[^"]*mb-1[^"]*"[^>]*>([^<]+)/);
    const langMatch = context.match(/programmingLanguage[^>]*>([^<]+)/);
    const starsMatch = context.match(/(\d[\d,kKmM.]*)\s*stars?/i) || context.match(/aria-label="(\d[\d,kKmM.]*)\s*stars?/i);

    records.push({
      name: repoPath,
      url: `https://github.com/${repoPath}`,
      description: (descMatch?.[1] || '').trim().substring(0, 300),
      language: (langMatch?.[1] || '').trim(),
      stars: (starsMatch?.[1] || '').trim(),
      source: 'github',
    });
  }
  return records;
}
