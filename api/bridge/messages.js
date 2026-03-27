// Message mailbox via Firebase Realtime DB
const { readPath, pushPath } = require('../../lib/firebase');

const MSGS_PATH = 'mercadopago-bridge/bridge-messages';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { sessionId, from, content } = req.body || {};
    if (!sessionId || !content) return res.status(400).json({ error: 'sessionId and content required' });

    await pushPath(MSGS_PATH + '/' + sessionId, {
      from: from || 'unknown',
      content: content,
      timestamp: new Date().toISOString(),
    });

    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const { session, since } = req.query;
    if (!session) return res.status(400).json({ error: 'session required' });

    const data = await readPath(MSGS_PATH + '/' + session);
    if (!data) return res.json({ messages: [] });

    // Convert Firebase object to array
    var msgs = Object.values(data);

    // Filter by timestamp if 'since' provided
    if (since) {
      msgs = msgs.filter(function(m) { return m.timestamp > since; });
    }

    // Sort by timestamp
    msgs.sort(function(a, b) { return a.timestamp < b.timestamp ? -1 : 1; });

    return res.json({ messages: msgs });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
