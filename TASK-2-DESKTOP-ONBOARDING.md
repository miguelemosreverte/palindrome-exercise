# Task 2: Desktop App — Welcome Experience & User Onboarding

## Problem

The desktop app (Electron, in `desktop-app/`) exists but has no onboarding flow. A new user opens it and sees... nothing. No guidance, no showcase, no personality. We need a Windows XP-style first-run experience that makes the user feel welcomed and sets up their workspace.

## Vision

Think: **macOS Setup Assistant meets a video game character creation screen.**

1. **Welcome screen** — animated, WebGPU-enhanced intro. Company branding, smooth transitions.
2. **User setup** — name, avatar, preferences (like Windows XP user accounts)
3. **Interest catalog** — "What are you interested in?" Cards for each experience:
   - 🏍️ Marketplace (MercadoLibre — bikes, products, deals)
   - 📺 Video Feed (YouTube — tutorials, channels)
   - 👔 Talent Search (LinkedIn — recruiting, networking)
   - 🍽️ Places (restaurants, points of interest)
   - ✈️ Travel (flights, hotels)
   - 📰 News & Updates
4. **First task setup** — guided wizard for the first experience they pick
5. **Dashboard** — lands on a personalized home with their chosen feeds

## Architecture

```
desktop-app/
├── src/
│   ├── onboarding/
│   │   ├── Welcome.jsx        ← animated welcome screen
│   │   ├── UserSetup.jsx      ← name, avatar, preferences
│   │   ├── Catalog.jsx        ← experience cards to pick from
│   │   ├── TaskWizard.jsx     ← guided first-task setup
│   │   └── animations/        ← WebGPU/CSS animations
│   ├── dashboard/
│   │   ├── Home.jsx           ← personalized home with feeds
│   │   ├── FeedCard.jsx       ← reusable feed item component
│   │   └── ExperienceView.jsx ← full-screen experience browser
│   └── store/
│       ├── user.js            ← user profile + preferences
│       └── experiences.js     ← active experiences + their state
├── public/
│   └── assets/                ← onboarding images, animations
```

## User Profile (persisted locally)

```json
{
  "name": "Miguel",
  "avatar": "default-1",
  "interests": ["marketplace", "talent", "video"],
  "experiences": [
    { "id": "mercado-libre-bikes", "task": "mercado-libre-bikes-cordoba", "schedule": "daily" },
    { "id": "linkedin-scala", "task": "linkedin-scala-senior-argentina", "schedule": "weekly" }
  ],
  "onboarded": true,
  "createdAt": "2026-03-30T..."
}
```

## Experience Catalog

Each experience is a card with:
- Icon/illustration
- Title + description
- "Set up" button → opens TaskWizard
- Preview of what the report looks like (screenshot or live embed)

The catalog maps to vendors:
| Experience | Vendor | Default Task |
|---|---|---|
| Marketplace | mercadolibre | Custom search query + location |
| Video Feed | youtube | Custom search query |
| Talent Search | linkedin | Custom role + location |
| Places | (new vendor) | Google Maps / TripAdvisor |
| Travel | (new vendor) | Flights / hotels |

## Onboarding Flow

```
App launch (first time)
  → Welcome animation (3-5 seconds, skippable)
  → "What should we call you?" (name input)
  → "Pick your interests" (catalog cards, multi-select)
  → For first picked interest: TaskWizard
    → "What are you looking for?" (search query)
    → "Where?" (location)
    → "How often?" (schedule: daily/weekly/manual)
  → "All set! Here's your dashboard."
  → Dashboard with first feed loading
```

## Technical Details

- Electron app already exists at `desktop-app/`
- Uses web technologies (HTML/CSS/JS) — our report renderer already works
- Reports from `output/` can be embedded as iframes or native views
- Cron jobs (Task 1) provide the data updates
- Bridge system provides notifications to phone

## Responsive

The onboarding must work on:
- Desktop (Electron window, 1200px+)
- Tablet (web view, 768px)
- Phone (future PWA, 375px)

## Definition of Done

- [ ] First launch shows welcome animation
- [ ] User enters name + picks interests
- [ ] At least 3 experience cards in catalog (Marketplace, Video, Talent)
- [ ] TaskWizard creates a task + schedules it
- [ ] Dashboard shows feeds from active experiences
- [ ] Subsequent launches go straight to dashboard
- [ ] Works in Electron + browser
