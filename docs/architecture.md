# Architecture

## Overview

Bridge has three main components:

```
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────┐
│   Desktop App   │     │   Vercel Backend     │     │   Telegram   │
│   (Electron)    │     │                      │     │              │
│                 │     │  /api/bridge/sessions │     │  @Agente     │
│  QR Code ───────┼────→│  /api/bridge/pair    │←────┼── GauchoBot  │
│  Chat UI ←──────┼─SSE─│  /api/bridge/messages│     │              │
│  Agent Status   │     │  /api/bridge/agent   │─────┼→ Sends msgs  │
│                 │     │  /api/bridge/telegram │←────┼── Webhook    │
└─────────────────┘     │  /api/bridge/send    │     └──────────────┘
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │   Firebase RTDB     │
                        │                      │
                        │  bridge-pairs/       │
                        │  bridge-messages/    │
                        │  bridge-status/      │
                        └─────────────────────┘
```

## Data flow

### Pairing (one-time)
1. Desktop creates a session via `POST /api/bridge/sessions`
2. QR code encodes `https://t.me/AgenteGauchoBot?start=SESSION_ID`
3. User scans → Telegram bot receives `/start SESSION_ID`
4. Webhook writes pairing to Firebase (`bridge-pairs/{sessionId}`)
5. Desktop detects pairing via polling or Firebase SSE

### Messaging
- **Phone → Desktop**: User sends message in Telegram → webhook stores in Firebase (`bridge-messages/{sessionId}`) → desktop reads via Firebase SSE (real-time) or polling
- **Desktop → Phone**: Desktop calls `POST /api/bridge/send` → Vercel calls Telegram Bot API → message appears in chat
- **Agent → Phone**: Agent calls `POST /api/bridge/agent` → stores in Firebase + sends via Telegram

## Storage

All state lives in **Firebase Realtime Database** (REST API, no SDK needed):

| Path | Purpose |
|------|---------|
| `bridge-pairs/{sessionId}` | Maps session to Telegram chatId |
| `bridge-messages/{sessionId}` | Message history per session |
| `bridge-status/{sessionId}` | Agent status (current task, progress) |

## Why Firebase + Vercel?

- Vercel serverless functions are **stateless** — can't share in-memory state between requests
- Firebase RTDB provides **real-time streaming** via SSE over REST — no SDK needed
- Firebase is the **source of truth** that both the webhook and the desktop can read from
