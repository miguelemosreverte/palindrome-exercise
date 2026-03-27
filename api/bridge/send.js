// Desktop sends a message to all Telegram users in a session
const { readPath, pushPath } = require('../../lib/firebase');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';
const MSGS_PATH = 'mercadopago-bridge/bridge-messages';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  var body = req.body || {};
  var chatId = body.chatId;
  var sessionId = body.sessionId;
  var content = body.content;
  if (!content) return res.status(400).json({ error: 'content required' });
  if (!chatId && !sessionId) return res.status(400).json({ error: 'chatId or sessionId required' });

  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });

  // Write to Firebase for mini app
  var from = body.from || 'agent';
  await pushPath(MSGS_PATH + '/' + sessionId, {
    from: from,
    content: content,
    timestamp: new Date().toISOString(),
  });

  // Collect all recipients
  var recipients = [];
  if (chatId) recipients.push(String(chatId));

  if (sessionId) {
    var pair = await readPath(PAIRS_PATH + '/' + sessionId);
    if (pair) {
      if (pair.chatId && recipients.indexOf(String(pair.chatId)) === -1) {
        recipients.push(String(pair.chatId));
      }
      if (pair.guests) {
        for (var gid in pair.guests) {
          if (pair.guests[gid] && recipients.indexOf(gid) === -1) {
            recipients.push(gid);
          }
        }
      }
    }
  }

  var results = [];
  for (var i = 0; i < recipients.length; i++) {
    var tgRes = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: recipients[i], text: '💻 ' + content }),
    });
    results.push(await tgRes.json());
  }

  return res.json({ ok: true, delivered: recipients.length });
};
