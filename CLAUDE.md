# Bridge — Desktop ↔ Phone Agent Communication

## Quick Start

```bash
# Launch the desktop app (QR code, chat, agent status)
cd desktop-app && npm start

# Start the global daemon (tracks all projects, routes messages)
./scripts/bridge-daemon.sh start

# Register this repo as a project
./scripts/bridge.sh register

# Send a message to the user's phone
./scripts/bridge.sh notify "Hello from the agent!"
```

## Sending notifications to the user's phone

The user has a Telegram bot (@AgenteGauchoBot) connected to their desktop via Bridge.
You can send them messages, ask questions, and provide status updates on their phone.

### API Endpoint

```
POST https://palindrome-exercise.vercel.app/api/bridge/agent
Content-Type: application/json

{
  "sessionId": "<from BRIDGE_SESSION env or ~/.bridge/session>",
  "action": "notify|summary|ask|status|error|success|approve",
  "message": "Your message here",
  "metadata": { "approvalId": "...", "command": "...", "project": "..." }
}
```

### CLI Commands

```bash
# Session is auto-detected from ~/.bridge/session, ~/.bridge-session, or BRIDGE_SESSION env

# Notifications
./scripts/bridge.sh notify "Build completed!"
./scripts/bridge.sh summary "Refactored auth module, added tests, fixed 3 bugs"
./scripts/bridge.sh status "Running test suite..."
./scripts/bridge.sh error "Tests failed: 3 failures"
./scripts/bridge.sh success "Deployed to production"

# Questions (user replies in Telegram)
./scripts/bridge.sh ask "Should I deploy to production?"
./scripts/bridge.sh read                         # Read user's replies

# Approvals (sends Telegram inline buttons: Approve / Deny)
./scripts/bridge.sh approve "Delete node_modules" --wait   # Blocks until user decides
# Exit code: 0 = approved, 1 = denied

# Multi-project
./scripts/bridge.sh register [name]              # Register current dir as a project
./scripts/bridge.sh projects                     # List all registered projects
./scripts/bridge.sh inbox                        # Read messages routed to this project
```

### When to notify the user

- **After completing a significant task** → use `summary`
- **When you need a decision** → use `ask`, then poll with `read` for their reply
- **When you need permission** → use `approve --wait` (sends inline buttons)
- **During long-running work** → use `status` periodically
- **On errors that need attention** → use `error`
- **On success** → use `success`

## Bridge Agent (autonomous Telegram bot)

Spawns a living AI agent that listens to Telegram messages and responds naturally using Claude CLI:

```bash
./scripts/bridge-agent.sh
```

No API key needed — uses `claude --dangerously-skip-permissions` under the hood. The agent:
- Sends a startup greeting about the project and recent work
- Listens for incoming Telegram messages every 2 seconds
- Responds naturally via the Bridge API
- Has full project context (CLAUDE.md, git log)

## Global Daemon

The daemon runs in the background and manages multiple projects across repos.

```bash
./scripts/bridge-daemon.sh start       # Start (creates session, writes PID)
./scripts/bridge-daemon.sh stop        # Stop
./scripts/bridge-daemon.sh status      # Show status + registered projects
./scripts/bridge-daemon.sh register /path/to/repo my-app
./scripts/bridge-daemon.sh unregister /path/to/repo
./scripts/bridge-daemon.sh list        # List all projects
```

State is stored in `~/.bridge/`:
- `session` — persistent session ID
- `projects.json` — registered project registry
- `inbox/{projectId}.json` — messages routed to each project
- `approvals/` — pending/resolved approval requests
- `daemon.pid` — PID file
- `daemon.log` — log file

Messages from the phone are routed by prefix: `[my-app] fix the tests` or `#1 fix the tests`.
No prefix → routes to most recently registered project.

## Multi-User Sessions

The session owner can invite friends to see agent activity and participate.

**Telegram commands:**
- `/invite` — generates a shareable link for guests
- `/kick @username` — remove a guest (or `/kick` for buttons)
- `/members` — list all session participants
- `/leave` — guest exits voluntarily
- `/disconnect` — owner ends session (notifies all guests)

Guests receive all agent messages, can chat, and can vote on approval buttons.

## Project Structure

```
/
├── api/bridge/          ← Vercel serverless functions
│   ├── agent.js         ← Agent → phone (notify, ask, approve, status)
│   ├── telegram.js      ← Telegram webhook (commands, callbacks, multi-user)
│   ├── approvals.js     ← Approval request management
│   ├── projects.js      ← Multi-project registry
│   ├── send.js          ← Desktop → phone messaging
│   ├── sessions.js      ← Session creation
│   ├── pair.js          ← QR pairing
│   ├── messages.js      ← Message mailbox
│   └── connect.js       ← SSE connection
├── web/                 ← Static web files (Vercel serves from here)
├── desktop-app/         ← Electron app (QR, chat, agent status)
├── mobile-app/          ← Flutter app (alternative to Telegram)
├── scripts/
│   ├── bridge.sh        ← Main CLI for agents
│   └── bridge-daemon.sh ← Global background daemon
├── lib/firebase.js      ← Firebase Realtime DB REST client
├── server/              ← OpenCode proxy server
├── docs/                ← Docsify documentation site
├── tests/               ← Tests
├── vercel.json          ← Vercel config (outputDirectory: web)
└── CLAUDE.md
```

## Deployment

Push to main → Vercel auto-deploys. Or manually: `vercel --prod`

Docs site: GitHub Pages serves from `docs/` folder.
