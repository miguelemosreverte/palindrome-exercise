/**
 * POST /api/bridge/query
 *
 * Natural language → SQL via OpenCode.
 * Body: { question, schema }
 * Returns: { sql } or { error }
 */

const OPENCODE = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { question, schema } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });
  if (!schema) return res.status(400).json({ error: 'schema required' });

  const schemaStr = schema.map(c => c.name + ' (' + c.type + ')').join(', ');
  const prompt = 'You have a SQLite table called "records" with columns: ' + schemaStr +
    '. Translate this to SQL. Return ONLY the SQL in a ```sql code block. Nothing else.\n\nQuery: "' + question + '"';

  try {
    // Create session
    const sessionRes = await fetch(OPENCODE + '/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const session = await sessionRes.json();

    // Send message
    await fetch(OPENCODE + '/session/' + session.id + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
    });

    // Poll for response (max 60s)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const msgsRes = await fetch(OPENCODE + '/session/' + session.id + '/message');
      const msgs = await msgsRes.json();
      const list = Array.isArray(msgs) ? msgs : [];

      for (let j = list.length - 1; j >= 0; j--) {
        const m = list[j];
        if (m.info && m.info.role !== 'assistant') continue;
        const parts = m.parts || [];
        if (parts.some(p => p.type === 'step-finish')) {
          const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
          const match = text.match(/```sql\n([\s\S]*?)```/);
          if (match) return res.status(200).json({ sql: match[1].trim() });
          const select = text.match(/(SELECT\s[\s\S]*?;?)\s*$/i);
          if (select) return res.status(200).json({ sql: select[1].trim() });
          return res.status(500).json({ error: 'Model did not return SQL', response: text.substring(0, 200) });
        }
      }
    }

    return res.status(500).json({ error: 'Timeout waiting for response' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
