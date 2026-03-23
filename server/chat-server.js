require('dotenv').config();

const { WebSocketServer } = require('ws');
const { consumePaidAccess } = require('../lib/access');
const { appendMessages, createChat, listChatsForUser, readChat } = require('../lib/chat-store');
const { verifyJwt } = require('../lib/jwt');
const { estimateCostUsd, recordUsage } = require('../lib/usage');

const PORT = Number(process.env.CHAT_WS_PORT || 8787);
const DEMO_API_BASE = process.env.DEMO_API_BASE || 'https://llm.chutes.ai/v1';

function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, ...payload }));
}

async function providerChat({ model, messages }) {
  const response = await fetch(`${DEMO_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CHUTESAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Proveedor: ${text}`);
  }

  const data = await response.json();
  return {
    raw: data,
    text:
      data.choices?.[0]?.message?.content ||
      data.output_text ||
      data.response ||
      '',
  };
}

async function handleInit(ws, session) {
  if (!session.sub && !session.access_token) {
    return send(ws, 'error', { message: 'Sesion invalida para chat.' });
  }

  if (session.sub) {
    const chats = await listChatsForUser(session.sub);
    send(ws, 'init', { chats });
    return;
  }

  send(ws, 'init', { chats: [] });
}

async function handleOpenChat(ws, session, payload) {
  if (!session.sub) {
    return send(ws, 'error', { message: 'Hace falta cuenta para ver historial.' });
  }

  const chat = await readChat(payload.chat_id);
  if (!chat || chat.owner_id !== session.sub) {
    return send(ws, 'error', { message: 'Chat no encontrado.' });
  }

  send(ws, 'chat_loaded', { chat: { chat_id: payload.chat_id, ...chat } });
}

async function handleUserMessage(ws, session, payload) {
  const model = String(payload.model || '').trim();
  const userText = String(payload.content || '').trim();
  let chatId = payload.chat_id || null;

  if (!model || !userText) {
    return send(ws, 'error', { message: 'Faltan modelo o mensaje.' });
  }

  const seedMessages = [{ role: 'user', content: userText }];
  const reserveUsd = estimateCostUsd(userText, 'x'.repeat(1600));
  const entitlement = await consumePaidAccess(
    {
      userId: session.sub || null,
      email: session.email || null,
      accessToken: session.access_token || null,
    },
    reserveUsd
  );

  if (!entitlement.ok) {
    return send(ws, 'error', {
      message: 'Saldo insuficiente para continuar con el chat.',
      entitlement: entitlement.summary,
    });
  }

  let historyMessages = [];
  let title = userText.slice(0, 60);

  if (chatId) {
    const existingChat = await readChat(chatId);
    if (!existingChat || (session.sub && existingChat.owner_id !== session.sub)) {
      return send(ws, 'error', { message: 'Chat no encontrado.' });
    }
    historyMessages = existingChat.messages || [];
    title = existingChat.title || title;
  } else if (session.sub) {
    const created = await createChat({
      ownerId: session.sub,
      ownerEmail: session.email || null,
      model,
      title,
    });
    chatId = created.chat_id;
  }

  const providerMessages = [
    { role: 'system', content: 'Responde en espanol, claro y breve.' },
    ...historyMessages.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: userText },
  ];

  send(ws, 'assistant_thinking', { chat_id: chatId, model });
  const result = await providerChat({ model, messages: providerMessages });

  const savedMessages = [
    { role: 'user', content: userText, created_at: Date.now(), model },
    { role: 'assistant', content: result.text, created_at: Date.now(), model },
  ];

  if (chatId) {
    await appendMessages(chatId, savedMessages, title);
  }

  const usage = await recordUsage({
    userId: session.sub || 'token',
    email: session.email || null,
    model,
    prompt: userText,
    response: result.text,
    source: 'chat',
  });

  send(ws, 'assistant_message', {
    chat_id: chatId,
    chat_title: title,
    model,
    message: savedMessages[1],
    usage,
    entitlement: entitlement.summary,
  });
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', async (ws, req) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const session = verifyJwt(token);

    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    await handleInit(ws, session);

    ws.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'open_chat') {
          await handleOpenChat(ws, session, data);
          return;
        }
        if (data.type === 'user_message') {
          await handleUserMessage(ws, session, data);
          return;
        }
        send(ws, 'error', { message: 'Tipo de mensaje no soportado.' });
      } catch (error) {
        send(ws, 'error', { message: error.message || 'Error interno del chat.' });
      }
    });
  } catch {
    ws.close(4001, 'Unauthorized');
  }
});

console.log(`Chat WebSocket server listening on ws://localhost:${PORT}`);
