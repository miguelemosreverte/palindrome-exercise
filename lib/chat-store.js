const { patchPath, pushPath, readPath } = require('./firebase');

const CHATS_PATH = 'mercadopago-bridge/chats';

async function listChatsForUser(ownerId) {
  const chats = (await readPath(CHATS_PATH)) || {};
  return Object.entries(chats)
    .map(([chatId, chat]) => ({ chat_id: chatId, ...chat }))
    .filter((chat) => chat.owner_id === ownerId)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

async function readChat(chatId) {
  return readPath(`${CHATS_PATH}/${chatId}`);
}

async function createChat({ ownerId, ownerEmail, model, title }) {
  const now = Date.now();
  const payload = {
    owner_id: ownerId,
    owner_email: ownerEmail || null,
    model,
    title: title || 'Nuevo chat',
    created_at: now,
    updated_at: now,
    messages: [],
  };

  const result = await pushPath(CHATS_PATH, payload);
  return { chat_id: result.name, ...payload };
}

async function appendMessages(chatId, messages, title) {
  const chat = await readChat(chatId);
  if (!chat) throw new Error('Chat no encontrado');
  const nextMessages = [...(chat.messages || []), ...messages];
  const nextTitle = chat.title && chat.title !== 'Nuevo chat' ? chat.title : title || chat.title;

  await patchPath(`${CHATS_PATH}/${chatId}`, {
    messages: nextMessages,
    title: nextTitle,
    updated_at: Date.now(),
  });

  return {
    chat_id: chatId,
    ...chat,
    title: nextTitle,
    messages: nextMessages,
    updated_at: Date.now(),
  };
}

module.exports = {
  appendMessages,
  createChat,
  listChatsForUser,
  readChat,
};
