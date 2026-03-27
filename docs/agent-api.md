# Agent API

The Agent API lets AI agents (Claude, OpenCode, or any script) communicate with users via Telegram.

## Endpoint

```
POST https://palindrome-exercise.vercel.app/api/bridge/agent
```

## Request body

```json
{
  "sessionId": "uuid-of-the-session",
  "action": "notify | summary | ask | status | error | success",
  "message": "Your message here",
  "metadata": {
    "state": "working",
    "progress": 45
  }
}
```

## Actions

| Action | Icon | Use case | Example |
|--------|------|----------|---------|
| `notify` | 🔔 | General notification | "Build completed!" |
| `summary` | 📋 | Work summary | "Refactored 3 files, added tests" |
| `ask` | ❓ | Need user decision | "Deploy to prod?" |
| `status` | ⚙️ | Progress update | "Running test suite... (45%)" |
| `error` | 🚨 | Something went wrong | "API rate limit hit" |
| `success` | ✅ | Task completed | "All tests passing" |

## Examples

### Send a notification

```bash
curl -X POST https://palindrome-exercise.vercel.app/api/bridge/agent \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"abc123","action":"notify","message":"Build completed!"}'
```

### Ask the user a question

```bash
curl -X POST https://palindrome-exercise.vercel.app/api/bridge/agent \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"abc123","action":"ask","message":"Should I deploy to production?"}'
```

The user replies in Telegram. Read their response:

```bash
curl "https://palindrome-exercise.vercel.app/api/bridge/messages?session=abc123"
```

### Update agent status

```bash
curl -X POST https://palindrome-exercise.vercel.app/api/bridge/agent \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"abc123","action":"status","message":"Analyzing logs...","metadata":{"state":"working","progress":60}}'
```

## Reading user replies

```
GET https://palindrome-exercise.vercel.app/api/bridge/messages?session={sessionId}
```

Optional query param: `since` (ISO timestamp) to only get new messages.

Response:
```json
{
  "messages": [
    {
      "from": "Miguel",
      "content": "Yes, deploy it",
      "timestamp": "2026-03-27T01:50:00.000Z"
    }
  ]
}
```
