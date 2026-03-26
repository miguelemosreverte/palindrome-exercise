# Multi-Instance OpenCode Server

Runs N OpenCode instances behind a lightweight proxy in a single container.

## Architecture

```
Railway container ($5/mo)
├── proxy.js (port 8080)
│   ├── sticky routing by session/user/IP
│   ├── health checks every 5s
│   ├── auto-restart crashed instances
│   └── CORS handling
├── OpenCode #0 (port 9001, /workspaces/pool-0/)
├── OpenCode #1 (port 9002, /workspaces/pool-1/)
└── OpenCode #2 (port 9003, /workspaces/pool-2/)
```

## What the proxy does

- **Sticky sessions**: Users are routed to the same instance based on session ID, cookie, or IP hash
- **Health checking**: Polls each instance every 5s, only routes to healthy ones
- **Auto-restart**: If an OpenCode process crashes, restarts it in 3s
- **Filesystem isolation**: Each instance has its own `/workspaces/pool-N/` directory
- **Data isolation**: Each instance has its own HOME, XDG_DATA_HOME, XDG_CONFIG_HOME
- **CORS**: Configured for our frontend domains

## Config

| Env var | Default | Description |
|---------|---------|-------------|
| `INSTANCES` | `3` | Number of OpenCode instances |
| `PORT` | `8080` | External proxy port |
| `BASE_PORT` | `9001` | First internal port |
| `CORS_ORIGINS` | `https://palindrome-exercise.vercel.app,...` | Allowed origins |

## Endpoints

| Path | Description |
|------|-------------|
| `/health` | Proxy health + instance status |
| `/proxy/status` | Quick status (instance count, uptime) |
| `/*` | Proxied to OpenCode instance |

## Deploy on Railway

1. Set the Docker image to build from this directory
2. Set env vars: `INSTANCES=3`, `PORT=8080`
3. Railway auto-detects the Dockerfile

Or push the image to a registry:
```bash
docker build -t myregistry/opencode-multi:latest ./server/
docker push myregistry/opencode-multi:latest
```
Then use the image URL on Railway.

## Capacity estimate

With `INSTANCES=3` and the benchmark results:

| Metric | Per instance | × 3 instances |
|--------|-------------|---------------|
| Concurrent @ 2s latency | 30 users | **90 users** |
| Concurrent @ 5s latency | 100 users | **300 users** |
| Messages/minute | 36 | **108** |
| Filesystem | Isolated per instance | ✓ |
| RAM estimate | ~200MB | ~600MB |
