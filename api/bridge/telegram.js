// Telegram Bot webhook — writes directly to Firebase
const { readPath, writePath, pushPath } = require('../../lib/firebase');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';
const MSGS_PATH = 'mercadopago-bridge/bridge-messages';
const APPROVALS_PATH = 'mercadopago-bridge/bridge-approvals';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  try {
    var update = req.body;

    // Handle callback queries (inline keyboard button presses)
    if (update && update.callback_query) {
      var cb = update.callback_query;
      var cbData = cb.data || '';
      var cbChatId = String(cb.message.chat.id);
      var cbMessageId = cb.message.message_id;
      var cbUsername = cb.from.username || cb.from.first_name || 'User';

      // Parse callback_data: "approve:{approvalId}" or "deny:{approvalId}"
      var parts = cbData.split(':');
      var decision = parts[0]; // "approve" or "deny"
      var approvalId = parts.slice(1).join(':');

      if (approvalId && (decision === 'approve' || decision === 'deny')) {
        // Find session for this chat
        var cbPairs = await readPath(PAIRS_PATH);
        var cbSession = null;
        if (cbPairs) {
          for (var k in cbPairs) {
            if (cbPairs[k] && String(cbPairs[k].chatId) === cbChatId) {
              cbSession = k;
              break;
            }
          }
        }

        // Update approval in Firebase
        if (cbSession) {
          await writePath(APPROVALS_PATH + '/' + cbSession + '/' + approvalId + '/status', decision === 'approve' ? 'approved' : 'denied');
          await writePath(APPROVALS_PATH + '/' + cbSession + '/' + approvalId + '/decidedBy', cbUsername);
          await writePath(APPROVALS_PATH + '/' + cbSession + '/' + approvalId + '/decidedAt', new Date().toISOString());

          // Store decision in message history
          await pushPath(MSGS_PATH + '/' + cbSession, {
            from: cbUsername,
            content: decision === 'approve' ? 'Approved: ' + approvalId : 'Denied: ' + approvalId,
            action: decision,
            approvalId: approvalId,
            timestamp: new Date().toISOString(),
          });
        }

        // Answer the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: decision === 'approve' ? 'Approved!' : 'Denied.',
        });

        // Edit the original message to show the decision and remove buttons
        var resultIcon = decision === 'approve' ? '✅' : '❌';
        var resultText = cb.message.text + '\n\n' + resultIcon + ' *' + (decision === 'approve' ? 'Approved' : 'Denied') + '* by ' + cbUsername;
        await callTelegram('editMessageText', {
          chat_id: cbChatId,
          message_id: cbMessageId,
          text: resultText,
          parse_mode: 'Markdown',
        });
      }

      return res.json({ ok: true });
    }

    if (!update || !update.message) return res.json({ ok: true });

    var msg = update.message;
    var chatId = String(msg.chat.id);
    var text = (msg.text || '').trim();
    var username = msg.from.username || msg.from.first_name || 'User';

    // /start SESSION_ID
    if (text.startsWith('/start ')) {
      var sessionId = text.split(' ')[1];

      // Store pairing directly in Firebase
      await writePath(PAIRS_PATH + '/' + sessionId, {
        chatId: chatId,
        username: username,
        connectedAt: Date.now(),
      });

      await sendTelegram(chatId,
        '🔗 *Connected to desktop!*\n\n' +
        'Session: `' + sessionId.slice(0, 8) + '...`\n\n' +
        'Send messages here — they appear on the desktop.\n' +
        'The desktop can message you back too.\n\n' +
        '/status — check connection\n' +
        '/disconnect — unlink',
        'Markdown'
      );
      return res.json({ ok: true });
    }

    if (text === '/start') {
      await sendTelegram(chatId,
        '👋 *Welcome to Bridge!*\n\nScan a QR code from a desktop app to connect.',
        'Markdown'
      );
      return res.json({ ok: true });
    }

    if (text === '/disconnect') {
      var allPairs = await readPath(PAIRS_PATH);
      if (allPairs) {
        for (var sid in allPairs) {
          if (allPairs[sid] && String(allPairs[sid].chatId) === chatId) {
            await writePath(PAIRS_PATH + '/' + sid, null);
            break;
          }
        }
      }
      await sendTelegram(chatId, '✅ Disconnected.');
      return res.json({ ok: true });
    }

    if (text === '/status') {
      var pairs = await readPath(PAIRS_PATH);
      var found = false;
      if (pairs) {
        for (var s in pairs) {
          if (pairs[s] && String(pairs[s].chatId) === chatId) {
            await sendTelegram(chatId, '📊 *Connected*\nSession: `' + s.slice(0, 8) + '...`', 'Markdown');
            found = true;
            break;
          }
        }
      }
      if (!found) await sendTelegram(chatId, 'Not connected. Scan a QR code to connect.');
      return res.json({ ok: true });
    }

    // Regular message — find session, store in Firebase
    var allP = await readPath(PAIRS_PATH);
    var targetSession = null;
    if (allP) {
      for (var key in allP) {
        if (allP[key] && String(allP[key].chatId) === chatId) {
          targetSession = key;
          break;
        }
      }
    }

    if (!targetSession) {
      await sendTelegram(chatId, 'Not connected to a desktop. Scan a QR code first!');
      return res.json({ ok: true });
    }

    // Store message in Firebase
    await pushPath(MSGS_PATH + '/' + targetSession, {
      from: username,
      content: text,
      timestamp: new Date().toISOString(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
};

async function sendTelegram(chatId, text, parseMode) {
  if (!BOT_TOKEN) return;
  await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: parseMode || undefined }),
  });
}

async function callTelegram(method, params) {
  if (!BOT_TOKEN) return;
  var resp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return resp.json();
}
