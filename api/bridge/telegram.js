// Telegram Bot webhook — writes directly to Firebase
const { readPath, writePath, pushPath, patchPath } = require('../../lib/firebase');

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
      var decision = parts[0];
      var approvalId = parts.slice(1).join(':');

      // Handle kick callbacks: "kick:{sessionId}:{guestChatId}"
      if (decision === 'kick' && parts.length >= 3) {
        var kickSession = parts[1];
        var kickGuestId = parts[2];
        var kickPair = await readPath(PAIRS_PATH + '/' + kickSession);
        if (kickPair && String(kickPair.chatId) === cbChatId) {
          var kickedGuest = kickPair.guests && kickPair.guests[kickGuestId];
          var kickedName = kickedGuest ? kickedGuest.username : 'Guest';
          await writePath(PAIRS_PATH + '/' + kickSession + '/guests/' + kickGuestId, null);
          await sendTelegram(kickGuestId, '🚪 You\'ve been removed from the Bridge session.');
          await callTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Kicked ' + kickedName });
          await callTelegram('editMessageText', {
            chat_id: cbChatId, message_id: cbMessageId,
            text: '✅ *' + kickedName + '* has been kicked.',
            parse_mode: 'Markdown',
          });
          await pushPath(MSGS_PATH + '/' + kickSession, {
            from: 'system',
            content: kickedName + ' was removed from the session',
            timestamp: new Date().toISOString(),
          });
        }
        return res.json({ ok: true });
      }

      if (approvalId && (decision === 'approve' || decision === 'deny')) {
        var cbSession = await findSessionForChat(cbChatId);

        if (cbSession) {
          await writePath(APPROVALS_PATH + '/' + cbSession + '/' + approvalId + '/status', decision === 'approve' ? 'approved' : 'denied');
          await writePath(APPROVALS_PATH + '/' + cbSession + '/' + approvalId + '/decidedBy', cbUsername);
          await writePath(APPROVALS_PATH + '/' + cbSession + '/' + approvalId + '/decidedAt', new Date().toISOString());

          await pushPath(MSGS_PATH + '/' + cbSession, {
            from: cbUsername,
            content: decision === 'approve' ? 'Approved: ' + approvalId : 'Denied: ' + approvalId,
            action: decision,
            approvalId: approvalId,
            timestamp: new Date().toISOString(),
          });
        }

        await callTelegram('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: decision === 'approve' ? 'Approved!' : 'Denied.',
        });

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

    // /start SESSION_ID — owner pairing via QR
    if (text.startsWith('/start ')) {
      var arg = text.split(' ')[1];

      // Guest invite: /start invite_SESSION_ID
      if (arg.startsWith('invite_')) {
        var inviteSession = arg.slice(7);
        var invitePair = await readPath(PAIRS_PATH + '/' + inviteSession);
        if (!invitePair) {
          await sendTelegram(chatId, 'Invalid or expired invite link.');
          return res.json({ ok: true });
        }
        // Don't add if already the owner
        if (String(invitePair.chatId) === chatId) {
          await sendTelegram(chatId, 'You are already the owner of this session!');
          return res.json({ ok: true });
        }
        // Add as guest
        await writePath(PAIRS_PATH + '/' + inviteSession + '/guests/' + chatId, {
          username: username,
          joinedAt: Date.now(),
        });
        await sendTelegram(chatId,
          '🎉 *Joined session!*\n\n' +
          'You\'re now connected to *' + (invitePair.username || 'someone') + '*\'s Bridge session.\n\n' +
          'You\'ll see agent messages and can chat here.\n\n' +
          '/leave — leave this session',
          'Markdown'
        );
        // Notify the owner
        await sendTelegram(invitePair.chatId,
          '👤 *' + username + '* joined your session via invite link.',
          'Markdown'
        );
        // Store in message history
        await pushPath(MSGS_PATH + '/' + inviteSession, {
          from: 'system',
          content: username + ' joined the session',
          timestamp: new Date().toISOString(),
        });
        return res.json({ ok: true });
      }

      // Normal owner pairing
      var sessionId = arg;
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
        '/invite — invite a friend to this session\n' +
        '/kick — remove a guest\n' +
        '/members — see who\'s in the session\n' +
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

    // /invite — owner generates a shareable link
    if (text === '/invite') {
      var session = await findSessionForChat(chatId);
      if (!session) {
        await sendTelegram(chatId, 'Not connected. Scan a QR code first!');
        return res.json({ ok: true });
      }
      var pair = await readPath(PAIRS_PATH + '/' + session);
      if (String(pair.chatId) !== chatId) {
        await sendTelegram(chatId, 'Only the session owner can invite others.');
        return res.json({ ok: true });
      }
      var inviteLink = 'https://t.me/AgenteGauchoBot?start=invite_' + session;
      await sendTelegram(chatId,
        '📨 *Invite link*\n\n' +
        'Share this with a friend:\n' +
        inviteLink + '\n\n' +
        'They\'ll be able to see agent messages and chat in this session.\n' +
        'Use /kick to remove them later.',
        'Markdown'
      );
      return res.json({ ok: true });
    }

    // /members — list everyone in the session
    if (text === '/members') {
      var session = await findSessionForChat(chatId);
      if (!session) {
        await sendTelegram(chatId, 'Not connected. Scan a QR code first!');
        return res.json({ ok: true });
      }
      var pair = await readPath(PAIRS_PATH + '/' + session);
      var memberList = '👥 *Session members*\n\n';
      memberList += '👑 *' + (pair.username || 'Owner') + '* (owner)\n';
      if (pair.guests) {
        for (var gid in pair.guests) {
          if (pair.guests[gid]) {
            memberList += '👤 *' + (pair.guests[gid].username || 'Guest') + '*\n';
          }
        }
      } else {
        memberList += '\n_No guests yet. Use /invite to add someone._';
      }
      await sendTelegram(chatId, memberList, 'Markdown');
      return res.json({ ok: true });
    }

    // /kick — owner removes a guest (shows inline keyboard to pick who)
    if (text.startsWith('/kick')) {
      var session = await findSessionForChat(chatId);
      if (!session) {
        await sendTelegram(chatId, 'Not connected. Scan a QR code first!');
        return res.json({ ok: true });
      }
      var pair = await readPath(PAIRS_PATH + '/' + session);
      if (String(pair.chatId) !== chatId) {
        await sendTelegram(chatId, 'Only the session owner can kick members.');
        return res.json({ ok: true });
      }
      if (!pair.guests || Object.keys(pair.guests).length === 0) {
        await sendTelegram(chatId, 'No guests to kick.');
        return res.json({ ok: true });
      }

      // If username specified: /kick @username
      var kickTarget = text.split(/\s+/)[1];
      if (kickTarget) {
        kickTarget = kickTarget.replace('@', '');
        var kicked = false;
        for (var gid in pair.guests) {
          if (pair.guests[gid] && pair.guests[gid].username === kickTarget) {
            await writePath(PAIRS_PATH + '/' + session + '/guests/' + gid, null);
            await sendTelegram(chatId, '✅ Kicked *' + kickTarget + '* from the session.', 'Markdown');
            await sendTelegram(gid, '🚪 You\'ve been removed from the Bridge session.');
            await pushPath(MSGS_PATH + '/' + session, {
              from: 'system',
              content: kickTarget + ' was removed from the session',
              timestamp: new Date().toISOString(),
            });
            kicked = true;
            break;
          }
        }
        if (!kicked) await sendTelegram(chatId, 'User not found in session.');
        return res.json({ ok: true });
      }

      // No target specified — show buttons
      var buttons = [];
      for (var gid in pair.guests) {
        if (pair.guests[gid]) {
          var guestName = pair.guests[gid].username || 'Guest';
          buttons.push([{ text: '🚪 Kick ' + guestName, callback_data: 'kick:' + session + ':' + gid }]);
        }
      }
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '👥 *Who to kick?*',
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons },
      });
      return res.json({ ok: true });
    }

    // /leave — guest leaves session voluntarily
    if (text === '/leave') {
      var allPairs = await readPath(PAIRS_PATH);
      var leftSession = null;
      if (allPairs) {
        for (var sid in allPairs) {
          var p = allPairs[sid];
          if (p && p.guests && p.guests[chatId]) {
            await writePath(PAIRS_PATH + '/' + sid + '/guests/' + chatId, null);
            leftSession = sid;
            // Notify owner
            if (p.chatId) {
              await sendTelegram(p.chatId, '👤 *' + username + '* left the session.', 'Markdown');
            }
            await pushPath(MSGS_PATH + '/' + sid, {
              from: 'system',
              content: username + ' left the session',
              timestamp: new Date().toISOString(),
            });
            break;
          }
        }
      }
      if (leftSession) {
        await sendTelegram(chatId, '✅ You\'ve left the session.');
      } else {
        await sendTelegram(chatId, 'You\'re not a guest in any session.');
      }
      return res.json({ ok: true });
    }

    // Handle kick callbacks
    if (update.callback_query) {
      // Already handled above, but just in case
      return res.json({ ok: true });
    }

    if (text === '/disconnect') {
      var allPairs = await readPath(PAIRS_PATH);
      if (allPairs) {
        for (var sid in allPairs) {
          if (allPairs[sid] && String(allPairs[sid].chatId) === chatId) {
            // Notify guests before disconnecting
            var guests = allPairs[sid].guests;
            if (guests) {
              for (var gid in guests) {
                if (guests[gid]) {
                  await sendTelegram(gid, '🔌 The session owner disconnected. Session ended.');
                }
              }
            }
            await writePath(PAIRS_PATH + '/' + sid, null);
            break;
          }
        }
      }
      await sendTelegram(chatId, '✅ Disconnected.');
      return res.json({ ok: true });
    }

    if (text === '/status') {
      var session = await findSessionForChat(chatId);
      if (session) {
        var pair = await readPath(PAIRS_PATH + '/' + session);
        var role = String(pair.chatId) === chatId ? 'owner' : 'guest';
        var guestCount = pair.guests ? Object.keys(pair.guests).filter(function(g) { return pair.guests[g]; }).length : 0;
        await sendTelegram(chatId,
          '📊 *Connected* (' + role + ')\n' +
          'Session: `' + session.slice(0, 8) + '...`\n' +
          'Members: ' + (1 + guestCount),
          'Markdown'
        );
      } else {
        await sendTelegram(chatId, 'Not connected. Scan a QR code to connect.');
      }
      return res.json({ ok: true });
    }

    // Regular message — find session (owner or guest), store in Firebase
    var targetSession = await findSessionForChat(chatId);

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

    // Relay message to other session members
    var relayPair = await readPath(PAIRS_PATH + '/' + targetSession);
    if (relayPair) {
      var allChatIds = getAllChatIds(relayPair);
      for (var i = 0; i < allChatIds.length; i++) {
        if (allChatIds[i] !== chatId) {
          await sendTelegram(allChatIds[i], '💬 *' + username + '*: ' + text, 'Markdown');
        }
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    return res.status(200).json({ ok: true, error: err.message });
  }
};

// Find which session a chatId belongs to (as owner or guest)
async function findSessionForChat(chatId) {
  var allPairs = await readPath(PAIRS_PATH);
  if (!allPairs) return null;
  for (var sid in allPairs) {
    var p = allPairs[sid];
    if (!p) continue;
    // Owner match
    if (String(p.chatId) === chatId) return sid;
    // Guest match
    if (p.guests) {
      for (var gid in p.guests) {
        if (gid === chatId && p.guests[gid]) return sid;
      }
    }
  }
  return null;
}

// Get all chatIds for a session (owner + guests)
function getAllChatIds(pair) {
  var ids = [];
  if (pair.chatId) ids.push(String(pair.chatId));
  if (pair.guests) {
    for (var gid in pair.guests) {
      if (pair.guests[gid]) ids.push(gid);
    }
  }
  return ids;
}

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
