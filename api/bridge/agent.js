// Agent API — Claude/OpenCode calls this to communicate with users via Telegram
//
// POST /api/bridge/agent
// {
//   "sessionId": "...",        // or "chatId" directly
//   "action": "notify" | "summary" | "ask" | "status",
//   "message": "...",
//   "metadata": { ... }        // optional: task info, progress, etc.
// }
//
// Examples:
//   notify  → "🔔 Build completed successfully"
//   summary → "📋 Here's what I did: ..."
//   ask     → "❓ Should I proceed with X?" (user replies in Telegram)
//   status  → "⚙️ Working on: analyzing data (45%)"

const { readPath, pushPath, writePath } = require('../../lib/firebase');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';
const MSGS_PATH = 'mercadopago-bridge/bridge-messages';
const STATUS_PATH = 'mercadopago-bridge/bridge-status';
const APPROVALS_PATH = 'mercadopago-bridge/bridge-approvals';

const ICONS = {
  notify: '🔔',
  summary: '📋',
  ask: '❓',
  approve: '🔐',
  status: '⚙️',
  error: '🚨',
  success: '✅',
  thinking: '🤔',
  working: '🔧',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch agent status or approval status
  if (req.method === 'GET') {
    var session = req.query.session;
    if (!session) return res.status(400).json({ error: 'session required' });

    // Poll approval status
    var approvalId = req.query.approval;
    if (approvalId) {
      var approval = await readPath(APPROVALS_PATH + '/' + session + '/' + approvalId);
      if (!approval) return res.status(404).json({ error: 'Approval not found' });
      return res.json({ approval: approval });
    }

    var status = await readPath(STATUS_PATH + '/' + session);
    return res.json({ status: status || { state: 'idle' } });
  }

  // POST — agent sends something to the user
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var sessionId = body.sessionId;
    var chatId = body.chatId;
    var action = body.action || 'notify';
    var message = body.message || '';
    var metadata = body.metadata || {};

    // Resolve chatId from sessionId if needed
    if (!chatId && sessionId) {
      var pair = await readPath(PAIRS_PATH + '/' + sessionId);
      if (pair) chatId = pair.chatId;
    }

    if (!chatId) {
      // Try to find any active session
      if (!sessionId) return res.status(400).json({ error: 'sessionId or chatId required' });
      return res.status(404).json({ error: 'No phone connected to this session' });
    }

    // Format the message based on action
    var icon = ICONS[action] || ICONS.notify;
    var formattedMsg = '';

    switch (action) {
      case 'summary':
        formattedMsg = icon + ' *Summary*\n\n' + message;
        break;
      case 'ask':
        formattedMsg = icon + ' *Question from your agent*\n\n' + message + '\n\n_Reply here to respond._';
        break;
      case 'status':
        formattedMsg = icon + ' *Status update*\n' + message;
        // Also store current status for desktop to display
        await writePath(STATUS_PATH + '/' + sessionId, {
          state: metadata.state || 'working',
          task: message,
          progress: metadata.progress || null,
          updatedAt: new Date().toISOString(),
        });
        break;
      case 'approve':
        var approvalId = metadata.approvalId;
        if (!approvalId) return res.status(400).json({ error: 'metadata.approvalId required for approve action' });
        formattedMsg = icon + ' *Approval requested*\n\n' + message;
        if (metadata.command) formattedMsg += '\n\n`' + metadata.command + '`';
        if (metadata.project) formattedMsg += '\n\nProject: _' + metadata.project + '_';
        // Store pending approval in Firebase
        await writePath(APPROVALS_PATH + '/' + sessionId + '/' + approvalId, {
          status: 'pending',
          message: message,
          command: metadata.command || null,
          project: metadata.project || null,
          createdAt: new Date().toISOString(),
        });
        // Send with inline keyboard
        var replyMarkup = {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: 'approve:' + approvalId },
            { text: '❌ Deny', callback_data: 'deny:' + approvalId },
          ]],
        };
        await sendTelegram(chatId, formattedMsg, 'Markdown', replyMarkup);
        // Store in message history
        if (sessionId) {
          await pushPath(MSGS_PATH + '/' + sessionId, {
            from: 'agent',
            action: 'approve',
            content: message,
            approvalId: approvalId,
            timestamp: new Date().toISOString(),
          });
        }
        return res.json({ ok: true, delivered: true, approvalId: approvalId });
      case 'error':
        formattedMsg = icon + ' *Error*\n\n`' + message + '`';
        break;
      case 'success':
        formattedMsg = icon + ' ' + message;
        break;
      default:
        formattedMsg = icon + ' ' + message;
    }

    // Send to Telegram
    await sendTelegram(chatId, formattedMsg, 'Markdown');

    // Store in message history
    if (sessionId) {
      await pushPath(MSGS_PATH + '/' + sessionId, {
        from: 'agent',
        action: action,
        content: message,
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({ ok: true, delivered: true });
  } catch (err) {
    console.error('Agent API error:', err);
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
