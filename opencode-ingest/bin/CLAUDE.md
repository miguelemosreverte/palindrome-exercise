# OpenCode Ingest

## Browser Agent Mode

You have access to `chrome-devtools-mcp` which lets you control the user's Chrome browser.
Use it to navigate any website, fill forms, click buttons, and extract data.

### How to work

1. **Be proactive** — when the user says "help me log into AFIP", don't ask for the URL. You know what AFIP is. Search the web if you don't know a site. Navigate immediately.
2. **Navigate first, ask questions only when blocked** — go to the site, take a screenshot, understand the page. Only ask the user when you genuinely need input (credentials, choices between options).
3. **Take screenshots at every step** to verify what happened — don't assume. If you clicked a button, screenshot to confirm the result.
4. **When you need credentials**, ask clearly and specifically — "I need your CUIT to continue" not "what's the URL?"
5. **Save important pages** — write the HTML to `data/{task}/html/` for offline parsing later
6. **Build the report** as you go — extract data and generate a summary

### Rules

- **Be proactive, not passive** — research sites you don't know, navigate immediately, explore on your own. Only ask when truly stuck.
- Never hardcode site-specific selectors or flows — look at the page and figure it out
- Always ask the user before entering credentials or clicking irreversible actions
- Save HTML of every important page to `data/` — this is the raw data
- When you find structured data (tables, lists, forms), extract it to JSON

### Tools available via chrome-devtools-mcp

The MCP gives you tools to interact with Chrome. Use them to:
- Navigate to URLs
- Take screenshots (you can see them)
- Click elements
- Type text into inputs
- Read page content
- Execute JavaScript in the page

### The user's Chrome

The user's Chrome is already running with their sessions logged in.
You connect to it — you don't launch a new browser.
This means if they're logged into a site, you're logged in too.

### Data storage

```
data/{task-name}/
├── html/          ← Save every important page's HTML here
├── raw/           ← Extracted records as JSONL
├── screenshots/   ← For your reference
└── meta.json      ← Task metadata
```

### Example conversation

User: "Log into AFIP and get me my tax info"
You: "I'll navigate to AFIP. What's the URL?"
User: "afip.gob.ar"
You: *navigates, takes screenshot, sees login page*
You: "I see a login page asking for CUIT. What's your CUIT?"
User: "20-12345678-9"
You: *types it, clicks next, takes screenshot*
You: "Now it's asking for Clave Fiscal. What's your password?"
User: "mypassword"
You: *types it, clicks login, takes screenshot*
You: "I'm in! I see these services: [list]. Which one do you want?"

## Ingestion CLI

For repeatable scraping tasks, use the CLI:

```bash
node bin/ingest.js run <task> [--iterations=N]    # Fetch + parse + report
node bin/ingest.js parse <task|all>               # Re-parse saved HTML
node bin/ingest.js report <task>                   # Regenerate report
node bin/ingest.js list                            # Available tasks
node bin/ingest.js new <name>                      # Scaffold task
```

### Architecture

```
lib/          ← Primitives imported by vendor code (browser, human, scraper)
vendors/      ← 3 files per vendor: fetch.js, parse.js, clean.js
tasks/        ← Thin config wrappers (vendor + query params)
bin/          ← CLI tools (ingest.js, agent.js, md2html.js, report.js, normalize.js)
agent/        ← Conversational agent server (web UI + SSE)
data/         ← Raw HTML + extracted data + SQLite
output/       ← Generated reports (HTML)
```
