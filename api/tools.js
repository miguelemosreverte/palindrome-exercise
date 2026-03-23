const { readJsonBody } = require('../lib/http');

async function webSearch(query) {
  const results = [];

  // Use DuckDuckGo Lite (always works, lightweight HTML)
  try {
    const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(ddgUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `q=${encodeURIComponent(query)}`,
    });

    if (response.ok) {
      const html = await response.text();
      // DDG Lite has results in <a class="result-link"> and snippets in <td class="result-snippet">
      const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

      const links = [];
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        links.push({ url: m[1], title: m[2].replace(/<[^>]*>/g, '').trim() });
      }

      const snippets = [];
      while ((m = snippetRegex.exec(html)) !== null) {
        snippets.push(m[1].replace(/<[^>]*>/g, '').trim());
      }

      for (let i = 0; i < Math.min(links.length, 5); i++) {
        results.push({
          title: links[i]?.title || '',
          url: links[i]?.url || '',
          snippet: snippets[i] || '',
        });
      }
    }
  } catch {}

  // Fallback: Wikipedia search API (always works from any IP)
  if (!results.length) {
    try {
      const lang = /[áéíóúñ¿¡]/.test(query) ? 'es' : 'en';
      const wikiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=5`;
      const wikiRes = await fetch(wikiUrl);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        for (const r of (wikiData.query?.search || [])) {
          results.push({
            title: r.title,
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
            snippet: r.snippet.replace(/<[^>]*>/g, ''),
          });
        }
      }
    } catch {}
  }

  // Brave Search API (if key is configured)
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
