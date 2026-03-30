# Task 6: Demo Feed — Showcase Before Setup

## Problem

When a new user onboards (Task 2), they haven't set up any tasks yet. The feed and exploration views are empty. But we need to showcase the system's capabilities immediately — before any data is ingested.

## Vision

A **demo feed with mock data** that looks and feels exactly like the real thing, but showcases the product itself. Like a demo mode in a video game — you see the gameplay before committing.

### The Demo Feed Shows:

1. **Product features as feed items**
   - "🆕 New: Natural language search — just type what you're looking for"
   - "🆕 New: Skill tree filtering — click to explore by technology"
   - "📊 Insight: How our two-pass LLM labeling works"

2. **Sample experiences**
   - A few real LinkedIn profiles (from our test data) as "Candidate Match" cards
   - A few real MercadoLibre listings as "Deal Found" cards
   - A few real YouTube videos as "New Video" cards

3. **Product changelog**
   - "v0.2: Added Gemini Flash-Lite support — 646ms query translation"
   - "v0.1: Faceted filter UI with skill tree"

4. **Call to action**
   - "Ready to set up your first experience? → [Get Started]"

## Mock Data Source

The demo feed is generated from:
- Actual test data in `data/ar-senior-devs-linkedin/` (18 real profiles)
- Actual test data in `data/mercado-libre-bikes-cordoba/` (510 real listings)
- Actual test data in `data/youtube-claude-code-tutorials/` (112 real videos)
- Product metadata from `package.json` + git log

This means the demo is not fabricated — it's real data from our test runs, just presented as a feed.

## Architecture

```
demo/
├── feed.json          ← pre-built demo feed (checked into git)
├── generate-demo.js   ← script that builds feed from test data
└── assets/            ← screenshots, product images
```

## Demo Feed Generation

```bash
node demo/generate-demo.js
# Reads from data/*/db.sqlite
# Picks best records: highest rated bike, most viewed video, best candidate
# Mixes with product feature announcements
# Outputs demo/feed.json
```

## Transition: Demo → Real

When the user completes onboarding:
1. Demo feed items get a "demo" badge (subtle, not distracting)
2. Real feed items start appearing above demo items
3. After 5+ real items, demo items auto-hide
4. User can toggle "Show demo items" in settings

## Exploration Mode Demo

The same approach for the exploration view (Task 4):
- LinkedIn skill tree pre-loaded with 18 test profiles
- MercadoLibre grid pre-loaded with top 20 bikes
- YouTube feed pre-loaded with 10 best tutorials

User can interact with real data immediately — filter, search, click. The "Get Started" button turns this into their own persistent task.

## Definition of Done

- [ ] Demo feed generated from real test data
- [ ] Feed renders in the dashboard before any user setup
- [ ] Product features shown as feed cards
- [ ] Sample experiences (LinkedIn, MercadoLibre, YouTube) are interactive
- [ ] "Get Started" CTA leads to onboarding wizard
- [ ] Demo items gracefully transition to real items after setup
- [ ] Demo feed checked into git (reproducible)
