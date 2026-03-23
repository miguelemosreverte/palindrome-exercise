const { readJsonBody } = require('../lib/http');

async function webSearch(query) {
  // Try DuckDuckGo instant answer API first (JSON, no scraping)
  const ddgApi = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const apiRes = await fetch(ddgApi, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChutesAI-Bridge/1.0)' },
  });

  const results = [];

  if (apiRes.ok) {
    let data;
    try { data = await apiRes.json(); } catch { data = {}; }

    // Abstract (main answer)
    if (data.Abstract) {
      results.push({ title: data.Heading || 'Resultado', url: data.AbstractURL || '', snippet: data.Abstract });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) {
          results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL || '', snippet: topic.Text });
        }
      }
    }

    // Answer
    if (data.Answer && !results.length) {
      results.push({ title: 'Respuesta', url: '', snippet: data.Answer });
    }
  }

  // Fallback: use SearXNG public instance
  if (!results.length) {
    try {
      const searxUrl = `https://search.ononoki.org/search?q=${encodeURIComponent(query)}&format=json&engines=google,bing,duckduckgo`;
      const searxRes = await fetch(searxUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChutesAI-Bridge/1.0)' },
      });
      if (searxRes.ok) {
        const searxData = await searxRes.json();
        for (const r of (searxData.results || []).slice(0, 5)) {
          results.push({ title: r.title || '', url: r.url || '', snippet: r.content || '' });
        }
      }
    } catch {}
  }

  // Second fallback: another SearXNG instance
  if (!results.length) {
    try {
      const searxUrl2 = `https://searx.be/search?q=${encodeURIComponent(query)}&format=json`;
      const searxRes2 = await fetch(searxUrl2, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChutesAI-Bridge/1.0)' },
      });
      if (searxRes2.ok) {
        const searxData2 = await searxRes2.json();
        for (const r of (searxData2.results || []).slice(0, 5)) {
          results.push({ title: r.title || '', url: r.url || '', snippet: r.content || '' });
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
      try {
        const results = await webSearch(query);
        return res.status(200).json({ tool: 'web_search', query, results });
      } catch (searchErr) {
        return res.status(200).json({ tool: 'web_search', query, results: [], error: searchErr.message });
      }
    }

    return res.status(400).json({ error: `Tool desconocido: ${tool}` });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Error ejecutando tool' });
  }
};
