const { readJsonBody } = require('../lib/http');

async function webSearch(query) {
  const results = [];

  // Primary: Wikipedia (always works from any IP, any region)
  try {
    const lang = /[áéíóúñ¿¡]/.test(query) ? 'es' : 'en';
    const wikiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=5`;
    const wikiRes = await fetch(wikiUrl);
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      for (const r of (wikiData.query?.search || [])) {
        results.push({
          title: r.title,
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
          snippet: (r.snippet || '').replace(/<[^>]*>/g, ''),
        });
      }
    }
    // Also try English Wikipedia if Spanish returned few results
    if (lang === 'es' && results.length < 2) {
      const enUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=3`;
      const enRes = await fetch(enUrl);
      if (enRes.ok) {
        const enData = await enRes.json();
        for (const r of (enData.query?.search || [])) {
          results.push({
            title: r.title + ' (EN)',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
            snippet: (r.snippet || '').replace(/<[^>]*>/g, ''),
          });
        }
      }
    }
  } catch {}

  // Fallback: Brave Search (if configured)
  if (!results.length && process.env.BRAVE_SEARCH_KEY) {
    try {
      const braveRes = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_KEY, Accept: 'application/json' },
      });
      if (braveRes.ok) {
        const braveData = await braveRes.json();
        for (const r of (braveData.web?.results || []).slice(0, 5)) {
          results.push({ title: r.title || '', url: r.url || '', snippet: r.description || '' });
        }
      }
    } catch {}
  }

  return results;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const tool = String(body.tool || '').trim();

    if (tool === 'web_search') {
      const query = String(body.query || '').trim();
      if (!query) return res.status(400).json({ error: 'Query vacía' });
      const results = await webSearch(query);
      return res.status(200).json({ tool: 'web_search', query, results });
    }

    return res.status(400).json({ error: `Tool desconocido: ${tool}` });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Error ejecutando tool' });
  }
};
