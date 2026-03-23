const { readJsonBody } = require('../lib/http');

async function webSearch(query) {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(ddgUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChutesAI-Bridge/1.0)' },
  });

  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  const html = await response.text();

  const results = [];
  const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
    results.push({
      url: match[1],
      title: match[2].replace(/<[^>]*>/g, '').trim(),
      snippet: match[3].replace(/<[^>]*>/g, '').trim(),
    });
  }

  if (!results.length) {
    const simpleRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    while ((match = simpleRegex.exec(html)) !== null && results.length < 5) {
      results.push({ title: '', url: '', snippet: match[1].replace(/<[^>]*>/g, '').trim() });
    }
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
