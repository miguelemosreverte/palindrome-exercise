# Task 5: Feed Experience — Morning Dashboard

## Problem

Users have to actively open reports to see updates. There's no **passive discovery** — no "wake up and see what's new" experience. The system should feel like opening your phone in the morning: notifications, highlights, changes worth knowing about.

## Vision

A **personalized feed** that surfaces the most interesting changes across all active experiences. Like a news feed, but for your data.

```
┌─────────────────────────────────────────┐
│ Good morning, Miguel                     │
│ 3 new items across your experiences      │
├─────────────────────────────────────────┤
│ 📺 NEW VIDEO                            │
│ "Claude Code 2026: Advanced Workflows"   │
│ Benjamín Cordero · 2 hours ago · 4K     │
│ [Watch] [Save] [Dismiss]                │
├─────────────────────────────────────────┤
│ 🏍️ PRICE DROP                           │
│ Bicicleta Mountain Bike R29             │
│ Was $599,999 → Now $449,999 (25% off)   │
│ [View] [Track] [Dismiss]               │
├─────────────────────────────────────────┤
│ 👔 CANDIDATE MATCH                       │
│ New Scala developer found in Córdoba     │
│ Score: 92% match · Senior · Globant     │
│ [View Profile] [Save] [Dismiss]         │
├─────────────────────────────────────────┤
│ 🍽️ TRENDING                             │
│ "La Cocina de María" — 4.8★ new reviews │
│ Added 12 new reviews this week          │
│ [Explore] [Dismiss]                     │
└─────────────────────────────────────────┘
```

## Feed Item Types

| Type | Source | Trigger |
|---|---|---|
| NEW | Any vendor | New record added since last check |
| PRICE_DROP | MercadoLibre | Price decreased > 10% |
| CANDIDATE_MATCH | LinkedIn | New profile matches saved search criteria |
| TRENDING | YouTube/Places | Significant engagement increase |
| ALERT | Any | Task failed, quota exceeded, schedule changed |
| INSIGHT | Pipeline | "Most common skill this week: Docker" |

## Architecture

```
Feed Generation (runs after each cron job)
  ↓
Compare: new records vs previous snapshot
  ↓
Generate feed items (type, title, body, action URL)
  ↓
Store in data/feed.json (append-only, with read/dismissed flags)
  ↓
UI renders: desktop dashboard / phone notification / Telegram bot
```

## Feed Storage

```json
{
  "items": [
    {
      "id": "feed-001",
      "type": "NEW",
      "source": "youtube-claude-code-tutorials",
      "title": "New video: Claude Code 2026 Advanced",
      "body": "Benjamín Cordero · 2h ago · 4K",
      "url": "https://youtube.com/watch?v=...",
      "thumbnail": "https://i.ytimg.com/...",
      "timestamp": "2026-03-30T08:00:00Z",
      "read": false,
      "dismissed": false
    }
  ]
}
```

## Integration Points

- **Desktop app** (Task 2): Feed is the home dashboard
- **Telegram bot** (existing Bridge): Push notifications for high-priority items
- **Cron workers** (Task 1): Generate feed items after each run
- **Reports** (existing): "View" action opens the full report

## Responsive

- Desktop: multi-column feed with cards
- Tablet: single column, swipeable cards
- Phone: notification-style list, tap to expand

## Every Experience as a Feed

The key insight: **every experience type should have both an exploration mode AND a feed mode**.

| Experience | Exploration | Feed |
|---|---|---|
| LinkedIn | Faceted table + skill tree | "New candidate found matching your criteria" |
| MercadoLibre | Product grid + price charts | "Price drop on tracked item" |
| YouTube | Video browser + channel view | "New video from subscribed channel" |
| Places | Map + nearby list | "Trending restaurant in your area" |

## Definition of Done

- [ ] Feed data structure defined and stored
- [ ] Feed items generated after cron job completion
- [ ] At least 3 feed item types working (NEW, PRICE_DROP, CANDIDATE_MATCH)
- [ ] Feed renders as a card list in the desktop app
- [ ] Items can be read/dismissed
- [ ] Integrates with Telegram notifications (Bridge)
- [ ] Responsive: desktop cards + phone list
