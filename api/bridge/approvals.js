// Approvals API — manage approval requests
//
// GET  /api/bridge/approvals?session=ID&approval=AID — check approval status
// POST /api/bridge/approvals — create approval request

const { readPath, writePath, pushPath } = require('../../lib/firebase');

var BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';
var APPROVALS_PATH = 'mercadopago-bridge/bridge-approvals';
var MSGS_PATH = 'mercadopago-bridge/bridge-messages';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — check approval status
    if (req.method === 'GET') {
      var session = req.query.session;
      var approvalId = req.query.approval;
      if (!session || !approvalId) return res.status(400).json({ error: 'session and approval required' });

      var approval = await readPath(APPROVALS_PATH + '/' + session + '/' + approvalId);
      if (!approval) return res.status(404).json({ error: 'Approval not found' });
      return res.json({ approval: approval });
    }

    // POST — create approval request
    if (req.method === 'POST') {
      var body = req.body || {};
      var sessionId = body.sessionId;
      var approvalId = body.approvalId;
      var message = body.message || '';

      if (!sessionId || !approvalId) {
        return res.status(400).json({ error: 'sessionId and approvalId required' });
      }

      // Store pending approval
      await writePath(APPROVALS_PATH + '/' + sessionId + '/' + approvalId, {
        status: 'pending',
        message: message,
        command: body.command || null,
        project: body.project || null,
        createdAt: new Date().toISOString(),
      });

      // Send to Telegram with inline keyboard
      var pair = await readPath(PAIRS_PATH + '/' + sessionId);
      if (pair && pair.chatId) {
        var text = '🔐 *Approval requested*\n\n' + message;
        if (body.command) text += '\n\n`' + body.command + '`';
        if (body.project) text += '\n\nProject: _' + body.project + '_';

        var replyMarkup = {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: 'approve:' + approvalId },
            { text: '❌ Deny', callback_data: 'deny:' + approvalId },
          ]],
        };
        await sendTelegram(pair.chatId, text, 'Markdown', replyMarkup);
      }

      // Store in message history
      await pushPath(MSGS_PATH + '/' + sessionId, {
        from: 'agent',
        action: 'approve',
        content: message,
        approvalId: approvalId,
        timestamp: new Date().toISOString(),
      });

      return res.json({ ok: true, approvalId: approvalId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Approvals API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function sendTelegram(chatId, text, parseMode, replyMarkup) {
  if (!BOT_TOKEN) return;
  var payload = { chat_id: chatId, text: text, parse_mode: parseMode || undefined };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  var resp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}
