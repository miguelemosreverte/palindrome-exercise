# Getting Started

## For users

1. **Download** the desktop app from [the download page](https://palindrome-exercise.vercel.app/download)
2. **Open** it — a QR code appears
3. **Scan** the QR with your phone camera
4. **Telegram** opens automatically with @AgenteGauchoBot
5. Hit **Start** — you're connected!

From now on, messages you send in that Telegram chat appear on the desktop, and vice versa.

## For developers

### Prerequisites

- Node.js 18+
- A Vercel account (for deployment)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

### Setup

```bash
git clone https://github.com/miguelemosreverte/palindrome-exercise.git
cd palindrome-exercise

# Install dependencies
npm install

# Set up environment
cp .env .env.local
# Edit .env.local and add:
# TELEGRAM_BOT_TOKEN=your_token_here

# Deploy to Vercel
vercel --prod

# Register the Telegram webhook
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-app.vercel.app/api/bridge/telegram"
```

### Run the desktop app locally

```bash
cd desktop-app
npm install
npm start
```
