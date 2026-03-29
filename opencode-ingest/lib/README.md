# lib/

Primitives imported by vendor code. Nothing else belongs here.

```
browser.js         createBrowser({domain}) — Playwright + Chrome cookies
human.js           humanClick(), humanScroll(), humanType(), Session
scraper.js         Base Scraper class with .next(), HTML saving, meta
chrome-cookies.js  getChromeCookes(domain) — macOS Chrome decryption
graph.js           Neo4j Graph class (optional)
```

**Rule**: if a vendor's fetch.js, parse.js, or clean.js needs it, it goes here.
If only the CLI needs it (report generation, markdown rendering), it does NOT go here.
