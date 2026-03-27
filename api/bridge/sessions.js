const { randomUUID } = require('crypto');

const sessions = globalThis.__bridgeSessions || (globalThis.__bridgeSessions = new Map());

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      created: Date.now(),
      clients: [],
      messages: [],
    });
    return res.json({ sessionId });
  }

  if (req.method === 'GET') {
    const { session } = req.query;
    if (!session || !sessions.has(session)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const s = sessions.get(session);
    return res.json({ sessionId: session, created: s.created, messageCount: s.messages.length });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
