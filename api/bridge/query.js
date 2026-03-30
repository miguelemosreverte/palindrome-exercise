/**
 * POST /api/bridge/query
 *
 * Natural language → SQL → results.
 * Proxies through OpenCode to translate, then executes against uploaded SQLite.
 *
 * Body: { task, question, schema? }
 * Returns: { sql, columns, rows, error? }
 */

const OPENCODE = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { question, schema } = req.body || {};

  if (!question) {
    return res.status(400).json({ error: 'question required' });
  }

  if (!schema) {
    return res.status(400).json({ error: 'schema required (array of {name, type})' });
  }

  const schemaStr = schema.map(c => `${c.name} (${c.type})`).join(', ');

  const prompt = `You have a SQLite table called "records" with these columns: ${schemaStr}.

Translate this natural language query to SQL. Return ONLY the SQL in a \`\`\`sql code block. Nothing else. No explanation.

Query: "${question}"`;

  try {
    // Create session
    const session = await fetch(OPENCODE + '/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json());

    // Send message
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      await fetch(OPENCODE + '/session/' + session.id + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }

    // Poll for response
    let sql = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const msgs = await fetch(OPENCODE + '/session/' + session.id + '/message').then(r => r.json());
      for (let j = (Array.isArray(msgs) ? msgs : []).length - 1; j >= 0; j--) {
        const m = msgs[j];
        if (m.info?.role !== 'assistant') continue;
        const parts = m.parts || [];
        if (parts.some(p => p.type === 'step-finish')) {
          const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
          const match = text.match(/```sql\n([\s\S]*?)```/) || text.match(/(SELECT\s[\s\S]*?(?:;|$))/i);
          sql = match ? (match[1] || match[0]).trim() : null;
          break;
        }
      }
      if (sql) break;
    }

    if (!sql) {
      return res.status(500).json({ error: 'Could not generate SQL from the question' });
    }

    return res.status(200).json({ sql });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
