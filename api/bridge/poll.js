// Poll endpoint — desktop calls this to check for Telegram messages
// Uses Telegram's getUpdates wouldn't work with webhook mode
// Instead, we store messages in a simple endpoint the webhook writes to

// We'll use Vercel KV-like approach with global state
// But since serverless instances don't share memory, we need a different approach
// Solution: Desktop polls Telegram bot API directly for chat history

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { session, role, action } = req.query;

  if (action === 'send' && req.method === 'POST') {
    // Desktop sends a message to Telegram
    const { chatId, content } = req.body || {};
    if (!chatId || !content) return res.status(400).json({ error: 'chatId and content required' });

    const url = 'https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage';
    const tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: content,
        parse_mode: 'Markdown',
      }),
    });
    const data = await tgRes.json();
    return res.json(data);
  }

  return res.json({ ok: true });
};
