# Task 4: Apple Maps-Style Exploration Experience

## Problem

Current reports are tables and charts — functional but not exploratory. Users should be able to **discover** data spatially, like browsing Apple Maps for restaurants or points of interest. The experience should feel like exploration, not querying.

## Vision

An **interactive map/canvas** where data points are positioned spatially and can be explored by zooming, panning, and tapping. Different from the table view — this is for serendipitous discovery.

### For LinkedIn (Talent)
- Map of Argentina with dots for each candidate
- Dot size = seniority, color = domain
- Click a dot → profile card pops up
- Cluster zoom: Buenos Aires cluster → zoom in → see individuals

### For MercadoLibre (Marketplace)
- Price landscape: cheap on left, expensive on right
- Vertical axis: rating or relevance
- Each point is a product with image thumbnail
- Hover → price + title, click → product card

### For YouTube (Video)
- Timeline: videos positioned by publish date
- Size = view count
- Color = channel
- Click → embedded player

### For Restaurants/Places
- Actual geographic map (Leaflet/Mapbox)
- Pins with ratings, cuisine type
- Street View integration
- "Near me" filter

## Architecture

```
Experience Layer
├── MapView.js         ← Leaflet/Mapbox for geographic data
├── CanvasView.js      ← HTML Canvas/WebGL for abstract layouts
├── ExplorerShell.js   ← shared shell: zoom, pan, search, filters
└── cards/
    ├── ProfileCard.js ← LinkedIn candidate popup
    ├── ProductCard.js ← MercadoLibre item popup
    ├── VideoCard.js   ← YouTube video popup
    └── PlaceCard.js   ← Restaurant/POI popup
```

## Data Requirements

Each record needs spatial coordinates:
- **Geographic**: latitude/longitude (from city label → geocode)
- **Abstract**: computed from attributes (price vs rating, skills vs seniority)

The labeling pipeline already produces the attributes. Coordinates can be:
1. Geocoded from `city` field (Argentina|Córdoba → -31.4, -64.1)
2. Computed via dimensionality reduction (t-SNE/UMAP on skill vectors)
3. Simple axis mapping (price on X, rating on Y)

## Responsive

- Desktop: full canvas with sidebar filters
- Tablet: canvas with bottom sheet for cards
- Phone: list view with "map" toggle button

## Shared Components

The explorer shell is reusable across all experience types:
- Zoom/pan controls
- Search bar (NL→Controls)
- Filter pills (from faceted UI)
- Card popup system
- Responsive layout

## Definition of Done

- [ ] At least one experience renders as a spatial view
- [ ] Zoom, pan, click-to-inspect work
- [ ] Cards show relevant data on click
- [ ] Responsive: desktop canvas + phone list
- [ ] Integrates with existing filter system
- [ ] Data flows from the same SQLite/JSONL pipeline
