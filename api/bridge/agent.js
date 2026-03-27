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
const MINIAPP_BASE = 'https://palindrome-exercise.vercel.app/miniapp.html';

// Rich content block patterns (timeline, options, cards, table, steps)
var RICH_BLOCK_RE = /```(timeline|options|cards|table|steps|tree|chartjs)\b/;

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

    // Resolve chatIds from sessionId (owner + guests)
    var allChatIds = [];
    if (chatId) {
      allChatIds = [chatId];
    } else if (sessionId) {
      var pair = await readPath(PAIRS_PATH + '/' + sessionId);
      if (pair) {
        chatId = pair.chatId;
        allChatIds.push(String(pair.chatId));
        if (pair.guests) {
          for (var gid in pair.guests) {
            if (pair.guests[gid]) allChatIds.push(gid);
          }
        }
      }
    }

    if (allChatIds.length === 0) {
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
        // Send with inline keyboard to all members
        var replyMarkup = {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: 'approve:' + approvalId },
            { text: '❌ Deny', callback_data: 'deny:' + approvalId },
          ]],
        };
        for (var a = 0; a < allChatIds.length; a++) {
          await sendTelegram(allChatIds[a], formattedMsg, 'Markdown', replyMarkup);
        }
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

    // Detect rich content — send clean text to Telegram, full content to Firebase/Mini App
    var hasRichContent = RICH_BLOCK_RE.test(message);
    var telegramText = formattedMsg;
    var telegramMarkup = null;

    if (hasRichContent && sessionId) {
      var cleanMsg = message.replace(/```(?:timeline|options|cards|table|steps|tree|chartjs)[\s\S]*?```/g, '').trim();
      telegramText = icon + ' ' + (cleanMsg || 'Tap below to view rich content');
      telegramMarkup = {
        inline_keyboard: [[
          { text: '📱 View in Mini App', web_app: { url: MINIAPP_BASE + '?session=' + sessionId } },
        ]],
      };
    }

    // Strip any leaked internal paths/scripts from messages
    telegramText = telegramText.replace(/\.\/scripts\/[^\s]+/g, '').replace(/bridge\.sh\s+\w+/g, '').trim();

    // Add Mini App button to all messages if session exists and no other markup
    if (!telegramMarkup && sessionId) {
      telegramMarkup = {
        inline_keyboard: [[
          { text: '📱 Open Mini App', web_app: { url: MINIAPP_BASE + '?session=' + sessionId } },
        ]],
      };
    }

    // Send to all session members (owner + guests)
    for (var b = 0; b < allChatIds.length; b++) {
      await sendTelegram(allChatIds[b], telegramText, 'Markdown', telegramMarkup);
    }

    // Store in message history (full content with rich blocks for Mini App)
    var model = metadata.model || metadata.modelID || null;
    if (sessionId) {
      await pushPath(MSGS_PATH + '/' + sessionId, {
        from: 'agent',
        action: action,
        content: message,
        model: model,
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
