# Telegram Bot

Bridge uses a Telegram bot (@AgenteGauchoBot) as the mobile communication channel. No app to install — users just scan a QR and they're in a Telegram conversation.

## Bot commands

| Command | Description |
|---------|-------------|
| `/start SESSION_ID` | Connect to a desktop session (triggered by QR scan) |
| `/start` | Welcome message |
| `/status` | Check current connection |
| `/disconnect` | Unlink from desktop |

## How pairing works

1. Desktop generates a session UUID
2. QR code encodes: `https://t.me/AgenteGauchoBot?start=SESSION_ID`
3. When scanned, Telegram opens the bot with `/start SESSION_ID` pre-filled
4. User taps Start → webhook fires → pairing stored in Firebase
5. All future messages in that chat are routed to the paired desktop session

## Setting up your own bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, choose a name and username
3. Copy the token
4. Set it as `TELEGRAM_BOT_TOKEN` in Vercel:
   ```bash
   vercel env add TELEGRAM_BOT_TOKEN production
   ```
5. Register the webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-app.vercel.app/api/bridge/telegram"
   ```

## Webhook handler

The webhook (`/api/bridge/telegram`) handles:
- `/start SESSION_ID` → pairs chat with session in Firebase
- `/disconnect` → removes pairing
- `/status` → returns connection info
- Regular messages → stores in Firebase for desktop to read
