# Bridge — Desktop ↔ Phone Agent Communication

## Sending notifications to the user's phone

The user has a Telegram bot (@AgenteGauchoBot) connected to their desktop via Bridge.
You can send them messages, ask questions, and provide status updates on their phone.

### API Endpoint

```
POST https://palindrome-exercise.vercel.app/api/bridge/agent
Content-Type: application/json

{
  "sessionId": "<from BRIDGE_SESSION env or ~/.bridge-session>",
  "action": "notify|summary|ask|status|error|success",
  "message": "Your message here"
}
```

### Quick CLI (from this repo)

```bash
# Set session first (get from desktop app or env)
export BRIDGE_SESSION="<session-id>"

# Or use the scripts directly
./scripts/bridge.sh notify "Build completed!"
./scripts/bridge.sh ask "Should I deploy to production?"
./scripts/bridge.sh summary "Refactored auth module, added tests, fixed 3 bugs"
./scripts/bridge.sh status "Running test suite..."
./scripts/bridge.sh read  # Read user's replies
```

### When to notify the user

- **After completing a significant task** → use `summary`
- **When you need a decision** → use `ask`, then poll with `read` for their reply
- **During long-running work** → use `status` periodically
- **On errors that need attention** → use `error`
- **On success** → use `success`

### Reading user replies

After sending an `ask`, the user replies in Telegram. Read their response:

```bash
./scripts/bridge.sh read
# or
curl -s "https://palindrome-exercise.vercel.app/api/bridge/messages?session=$BRIDGE_SESSION"
```

## Project structure

- `api/bridge/` — Vercel serverless functions (Firebase-backed)
- `desktop-app/` — Electron desktop app (shows QR, chat, agent status)
- `mobile-app/` — Flutter app (alternative to Telegram, not primary)
- `scripts/` — CLI tools for agent integration
- `lib/firebase.js` — Firebase Realtime DB REST client

## Deployment

Push to main → Vercel auto-deploys. Or manually: `vercel --prod`
