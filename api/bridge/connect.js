const { randomUUID } = require('crypto');

const sessions = globalThis.__bridgeSessions || (globalThis.__bridgeSessions = new Map());

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { session, role } = req.query;
  if (!session) return res.status(400).json({ error: 'session required' });

  // Auto-create session if doesn't exist
  if (!sessions.has(session)) {
    sessions.set(session, { created: Date.now(), clients: [], messages: [] });
  }
  const s = sessions.get(session);

  if (req.method === 'GET') {
    // SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial connected event
    res.write('data: ' + JSON.stringify({ type: 'connected', role: role, session: session }) + '\n\n');

    // Register this client
    const client = { role: role, res: res, id: randomUUID() };
    s.clients = s.clients || [];
    s.clients.push(client);

    // Send missed messages
    var recent = s.messages.slice(-50);
    for (var i = 0; i < recent.length; i++) {
      res.write('data: ' + JSON.stringify(recent[i]) + '\n\n');
    }

    // Notify others
    broadcast(s, { type: 'peer_joined', role: role }, client.id);

    req.on('close', function () {
      s.clients = s.clients.filter(function (c) { return c.id !== client.id; });
      broadcast(s, { type: 'peer_left', role: role });
    });

    return;
  }

  if (req.method === 'POST') {
    var body = req.body || {};
    var msg = {
      type: body.type || 'message',
      content: body.content || '',
      from: role || 'unknown',
      timestamp: new Date().toISOString(),
    };
    s.messages.push(msg);
    if (s.messages.length > 100) s.messages = s.messages.slice(-100);

    broadcast(s, msg);

    // Also forward to Telegram if linked
    try {
      var telegram = require('./telegram');
      if (telegram.sendToTelegram) telegram.sendToTelegram(session, msg);
    } catch (e) {}

    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};

function broadcast(session, data, excludeId) {
  var payload = 'data: ' + JSON.stringify(data) + '\n\n';
  var clients = session.clients || [];
  for (var i = 0; i < clients.length; i++) {
    if (clients[i].id !== excludeId) {
      try { clients[i].res.write(payload); } catch (e) {}
    }
  }
}
