// Mini App — sends a Telegram message with inline button to open the Bridge Mini App
//
// POST /api/bridge/miniapp
// { "sessionId": "...", "chatId": "..." (optional) }

var { readPath } = require('../../lib/firebase');

var BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';
var MINIAPP_BASE = 'https://palindrome-exercise.vercel.app/miniapp.html';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    var { sessionId, chatId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    // Resolve chatId from session if not provided
    if (!chatId) {
      var pair = await readPath(PAIRS_PATH + '/' + sessionId);
      if (!pair || !pair.chatId) {
        return res.status(404).json({ error: 'Session not found or not paired' });
      }
      chatId = String(pair.chatId);
    }

    var miniAppUrl = MINIAPP_BASE + '?session=' + encodeURIComponent(sessionId);

    // Send Telegram message with web_app inline button
    var resp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'Open the Bridge dashboard to see rich components, agent status, and full message history.',
        reply_markup: {
          inline_keyboard: [[
            {
              text: 'Open Bridge Dashboard',
              web_app: { url: miniAppUrl },
            },
          ]],
        },
      }),
    });

    var result = await resp.json();
    return res.json({ ok: true, result: result });
  } catch (err) {
    console.error('miniapp error:', err);
    return res.status(500).json({ error: err.message });
  }
};
