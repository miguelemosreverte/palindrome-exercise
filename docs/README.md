# Bridge

> Your AI agent, in your pocket.

Bridge connects your desktop AI agent to your phone via Telegram. Scan a QR code once, and you're connected — get notifications, status updates, and have conversations with your agent from anywhere.

## How it works

```
Desktop App          Vercel + Firebase          Telegram
┌──────────┐        ┌──────────────┐        ┌──────────┐
│ Shows QR │───────→│  Session DB  │←───────│  Phone   │
│ Chat UI  │←──SSE──│  Message DB  │──webhook│  scans   │
│ Agent    │───POST─│  Agent API   │───bot──→│  QR      │
└──────────┘        └──────────────┘        └──────────┘
```

1. **Desktop** creates a session, shows a QR code
2. **Phone** scans QR → Telegram opens → bot pairs the session
3. **Messages** flow both ways: desktop ↔ Firebase ↔ Telegram
4. **Agents** (Claude, OpenCode) can send notifications via the Agent API

## Quick start

```bash
# Clone and install
git clone https://github.com/miguelemosreverte/palindrome-exercise.git
cd palindrome-exercise

# Run the desktop app
cd desktop-app && npm install && npm start

# Or use the web version
open https://palindrome-exercise.vercel.app/bridge
```

## Links

- [Live app](https://palindrome-exercise.vercel.app)
- [Download desktop](https://palindrome-exercise.vercel.app/download)
- [Web bridge](https://palindrome-exercise.vercel.app/bridge)
- [Telegram bot](https://t.me/AgenteGauchoBot)
