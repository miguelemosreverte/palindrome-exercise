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

  // Fallback: DuckDuckGo instant answer API
  if (!results.length) {
    try {
      const apiRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
      if (apiRes.ok) {
        const text = await apiRes.text();
        const data = JSON.parse(text);
        if (data.Abstract) {
          results.push({ title: data.Heading || 'Resultado', url: data.AbstractURL || '', snippet: data.Abstract });
        }
        for (const topic of (data.RelatedTopics || []).slice(0, 4)) {
          if (topic.Text) results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL || '', snippet: topic.Text });
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
