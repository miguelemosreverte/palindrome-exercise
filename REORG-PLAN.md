# Repo Reorganization Plan

## Step 1: Remove dead stuff
```bash
# Remove the dead gaucho-cowork submodule reference
git rm --cached gaucho-cowork
# Remove empty minimal-app
rm -rf minimal-app
```

## Step 2: Move webapp files to `web/`
```bash
mkdir web
git mv index.html admin.html auth.html chat.html dashboard.html demo.html success.html web/
git mv bridge.html connect.html download.html web/
git mv app.js styles.css web/
git mv architecture.html architecture-c4.html web/
git mv architecture.mmd architecture-components.mmd architecture-containers.mmd architecture-context.mmd architecture-flows.mmd web/
```

## Step 3: Update `vercel.json` to serve from `web/`
```json
{
  "outputDirectory": "web",
  "rewrites": [
    { "source": "/connect", "destination": "/connect.html" },
    { "source": "/bridge", "destination": "/bridge.html" },
    { "source": "/download", "destination": "/download.html" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Authorization, X-Access-Token, X-Demo-Session" }
      ]
    }
  ]
}
```

## Step 4: Update `app.js` reference in `web/index.html`
The `<script src="app.js">` stays the same since both files are in `web/` now — relative paths still work.

## Step 5: Update desktop app `API_BASE`
No change needed — it already uses the full Vercel URL.

## Step 6: Resulting structure
```
/
├── api/              ← Vercel serverless functions
├── web/              ← All static web files (Vercel serves this)
├── desktop-app/      ← Electron app
├── mobile-app/       ← Flutter app
├── lib/              ← Shared JS (firebase.js)
├── scripts/          ← CLI tools (bridge.sh, notify.sh)
├── server/           ← Chat server / proxy
├── docs/             ← Docsify documentation site
├── tests/            ← Tests
├── CLAUDE.md
├── package.json
├── vercel.json
└── .env
```

## Gotcha
The key thing is `"outputDirectory": "web"` in `vercel.json`. This tells Vercel to serve static files from `web/` instead of root. The `api/` folder stays at root — Vercel always looks for it there regardless of outputDirectory.

**Test locally with `vercel dev` before pushing to make sure routes still work.**
