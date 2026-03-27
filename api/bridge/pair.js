// Session pairing via Firebase Realtime DB
const { readPath, writePath } = require('../../lib/firebase');

const PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { sessionId, chatId, username } = req.body || {};
    if (!sessionId || !chatId) return res.status(400).json({ error: 'sessionId and chatId required' });

    await writePath(PAIRS_PATH + '/' + sessionId, {
      chatId: chatId,
      username: username,
      connectedAt: Date.now(),
    });

    return res.json({ ok: true, sessionId: sessionId, chatId: chatId });
  }

  if (req.method === 'GET') {
    const { session } = req.query;
    if (!session) return res.status(400).json({ error: 'session required' });

    const pair = await readPath(PAIRS_PATH + '/' + session);
    if (pair) return res.json({ paired: true, chatId: pair.chatId, username: pair.username });
    return res.json({ paired: false });
  }

  if (req.method === 'DELETE') {
    const { session } = req.query;
    if (session) await writePath(PAIRS_PATH + '/' + session, null);
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
