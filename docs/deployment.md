# Deployment

## Vercel (backend + web)

The backend auto-deploys when you push to main. Manual deploy:

```bash
vercel --prod
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `FIREBASE_DATABASE_URL` | Firebase RTDB URL (has default) |

### API routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/bridge/sessions` | POST | Create a new session |
| `/api/bridge/pair` | GET, POST, DELETE | Session ↔ Telegram pairing |
| `/api/bridge/messages` | GET, POST | Message mailbox |
| `/api/bridge/agent` | GET, POST | Agent notifications |
| `/api/bridge/send` | POST | Desktop → Telegram message |
| `/api/bridge/telegram` | POST | Telegram webhook handler |

## GitHub Releases (desktop app)

```bash
# Build
cd desktop-app
./node_modules/.bin/electron-builder build --mac -c.mac.identity=null

# Create release
gh release create v1.x.x desktop-app/dist/Bridge-*.dmg \
  --title "Bridge v1.x.x" \
  --notes "Release notes here"
```

## Firebase

Uses Firebase Realtime Database with REST API (no SDK). The database URL is configured in `lib/firebase.js`. No authentication required for the demo — add Firebase security rules for production.

## Telegram webhook

After deploying, register the webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://your-app.vercel.app/api/bridge/telegram"
```

Verify:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```
