# Desktop App

The desktop app is built with Electron and provides the local interface for Bridge.

## Features

- **Connect tab** — Shows QR code for phone pairing
- **Chat tab** — Bidirectional messaging with phone/Telegram
- **Agent tab** — Shows current agent task, status, connected devices

## Running locally

```bash
cd desktop-app
npm install
npm start
```

## Building for distribution

```bash
cd desktop-app

# macOS
./node_modules/.bin/electron-builder build --mac -c.mac.identity=null

# Output: dist/Bridge-1.0.0-arm64.dmg
```

## Tech stack

- **Electron 33** — Desktop shell
- **QRCode.js** — QR code generation
- **Firebase RTDB SSE** — Real-time message streaming (no SDK, pure EventSource)
- **Vercel API** — Session creation, message sending, pairing

## How it connects

1. On launch, creates a session via `POST /api/bridge/sessions`
2. Generates QR code pointing to `https://t.me/AgenteGauchoBot?start=SESSION_ID`
3. Polls `/api/bridge/pair?session=SESSION_ID` until phone connects
4. Once paired, opens Firebase SSE streams for real-time messages and status
5. Sends messages via `POST /api/bridge/send` (routes through Telegram bot)
