// Desktop sends a message to Telegram user
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { chatId, content } = req.body || {};
  if (!chatId || !content) return res.status(400).json({ error: 'chatId and content required' });

  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });

  const tgRes = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '💻 ' + content,
    }),
  });

  const data = await tgRes.json();
  return res.json(data);
};
