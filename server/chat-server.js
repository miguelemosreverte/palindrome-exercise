require('dotenv').config();

const { WebSocketServer } = require('ws');
const { consumePaidAccess } = require('../lib/access');
const { appendMessages, createChat, listChatsForUser, readChat } = require('../lib/chat-store');
const { verifyJwt } = require('../lib/jwt');
const { estimateCostUsd, recordUsage } = require('../lib/usage');

const PORT = Number(process.env.CHAT_WS_PORT || 8787);
const LLM_API_BASE = process.env.LLM_API_BASE;
const LLM_API_KEY = process.env.LLM_API_KEY;

function send(ws, type, payload) {
  ws.send(JSON.stringify({ type, ...payload }));
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

  // Use fetch with streaming
  if (!LLM_API_BASE || !LLM_API_KEY) {
    return send(ws, 'error', { message: 'LLM provider is not configured.' });
  }

  const response = await fetch(`${LLM_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: providerMessages,
      temperature: 0.7,
      max_tokens: 800,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return send(ws, 'error', { message: `Proveedor: ${text}` });
  }

  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') break;
        try {
          const data = JSON.parse(dataStr);
          const text = data.choices?.[0]?.delta?.content || '';
          if (text) {
            fullText += text;
            send(ws, 'assistant_chunk', {
              chat_id: chatId,
              text,
            });
          }
        } catch (e) {
          // Ignore parse errors for partial chunks
        }
      }
    }
  }

  const savedMessages = [
    { role: 'user', content: userText, created_at: Date.now(), model },
    { role: 'assistant', content: fullText, created_at: Date.now(), model },
  ];

  if (chatId) {
    await appendMessages(chatId, savedMessages, title);
  }

  const usage = await recordUsage({
    userId: session.sub || 'token',
    email: session.email || null,
    model,
    prompt: userText,
    response: fullText,
    source: 'chat',
  });

  send(ws, 'assistant_message_end', {
    chat_id: chatId,
    chat_title: title,
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
