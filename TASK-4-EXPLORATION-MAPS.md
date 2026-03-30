# Task 4: Leaflet Map Experience — Spatial Exploration of Ingested Data

## Problem

Data is currently tables and charts. But much of it is inherently geographic — LinkedIn candidates are in cities, restaurants have addresses, MercadoLibre sellers are in locations. A map makes this data explorable in a way tables never can.

## Vision

A **Leaflet.js map** embedded in the report that shows ingested data as pins/markers. Like Apple Maps but for your data — candidates on a map of Argentina, bikes for sale near you, restaurants to visit.

This is **not abstract** — it uses real latitude/longitude coordinates geocoded from the `city` field in the pipeline.

## Implementation

### Geocoding

The labeling pipeline already produces hierarchical cities: `Argentina|Córdoba`, `Argentina|Buenos Aires`. We need a geocoding lookup:

```javascript
const GEOCODE = {
  'Argentina': { lat: -34.6, lng: -58.4 },
  'Argentina|Córdoba': { lat: -31.416, lng: -64.183 },
  'Argentina|Buenos Aires': { lat: -34.603, lng: -58.381 },
  'Argentina|Rosario': { lat: -32.947, lng: -60.639 },
  'Argentina|Mendoza': { lat: -32.889, lng: -68.845 },
  'Argentina|Tucumán': { lat: -26.808, lng: -65.217 },
  // Expand as new cities appear in data
  'Brazil|São Paulo': { lat: -23.55, lng: -46.633 },
  'Chile|Santiago': { lat: -33.447, lng: -70.673 },
};
```

For unknown cities: use a free geocoding API (Nominatim/OpenStreetMap) as fallback, cache results.

### Map Component

```html
<!-- Leaflet CSS + JS from CDN -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9/dist/leaflet.js"></script>

<div id="map" style="height: 500px; border-radius: 8px;"></div>
```

### Marker Types (per vendor)

| Vendor | Marker | Popup |
|---|---|---|
| LinkedIn | Circle, size=seniority, color=domain | Name, title, company, photo, skills |
| MercadoLibre | Pin with price label | Product image, price, seller, link |
| YouTube | Pin with play icon | Thumbnail, title, channel, views |
| Restaurants | Pin with rating stars | Name, cuisine, rating, address |

### Clustering

With 500+ data points, individual markers overlap. Use `Leaflet.markercluster`:
- Zoom out: clusters with count badges ("23 developers in Córdoba")
- Zoom in: individual markers with popups
- Click cluster: zoom to show individuals

### Filter Integration

The map reacts to the same faceted filters:
- Select domain "engineering" → only engineering pins visible
- Select city "Córdoba" → map auto-zooms to Córdoba
- Click a skill tag → markers filter in real-time

The map and the table show the SAME filtered dataset — they're two views of one filter state.

## Architecture

```
bin/map.js              ← Reusable map HTML generator (like bin/charts.js)
bin/geocode.js          ← City→coordinates lookup + Nominatim fallback
bin/md2html.js          ← Updated: embed map between charts and table
```

### map.js API

```javascript
import { renderMap } from './map.js';

// Returns HTML string with Leaflet map + markers
const mapHtml = renderMap({
  records: filteredRecords,
  coordField: 'city',        // field containing Country|City
  popupFields: ['name', 'title', 'company', 'photo'],
  colorField: 'domain',
  sizeField: 'seniority_score',
});
```

### Report Integration

The map sits between the charts and the table:

```
[NL Input]
[Dropdowns + Skill Tree]
[Charts: Domain | Seniority | Skills Cloud]
[MAP — Leaflet with clustered markers]      ← NEW
[Table with faceted data]
```

The map updates on every filter change, just like the charts.

### Client-Side (in TABLE_ENGINE_JS)

```javascript
// Initialize Leaflet map
const map = L.map('data-map').setView([-34.6, -58.4], 5); // Argentina center
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Marker layer (updated on filter)
let markerLayer = L.markerClusterGroup();

function updateMap(filtered) {
  markerLayer.clearLayers();
  filtered.forEach(r => {
    const coords = GEOCODE[r.city];
    if (!coords) return;
    const marker = L.circleMarker([coords.lat, coords.lng], {
      radius: 6 + (r.seniority_score || 50) / 20,
      color: DOMAIN_COLORS[r.domain] || '#2c3e50',
    });
    marker.bindPopup(`<b>${r.name}</b><br>${r.title}<br>${r.company}`);
    markerLayer.addLayer(marker);
  });
  map.addLayer(markerLayer);
  if (markerLayer.getLayers().length) map.fitBounds(markerLayer.getBounds());
}
```

## Feed Mode (Task 5 integration)

The map also works in feed mode:
- New pins pulse/animate when fresh data arrives
- "3 new candidates in Córdoba since yesterday" — map highlights them
- Click notification → map zooms to that cluster

## Responsive

- Desktop: 500px height map, full controls
- Tablet: 400px, simplified controls
- Phone: 300px, tap-to-expand to full screen

## Dependencies

- Leaflet.js (CDN, no npm install needed)
- Leaflet.markercluster (CDN)
- OpenStreetMap tiles (free, no API key)
- Optional: Nominatim for geocoding unknown cities

## Files to Create

| File | Purpose |
|------|---------|
| `bin/map.js` | Reusable Leaflet map HTML generator |
| `bin/geocode.js` | City → coordinates lookup with cache |
| Update `bin/md2html.js` | Embed map in graph layout reports |

## Definition of Done

- [ ] Map renders with Leaflet + OSM tiles
- [ ] Markers positioned from geocoded city field
- [ ] Marker clustering works (zoom in/out)
- [ ] Popups show relevant data per vendor
- [ ] Map reacts to faceted filter changes
- [ ] Filter by city auto-zooms the map
- [ ] Responsive: desktop, tablet, phone
- [ ] Works for LinkedIn data (tested with 18 profiles)
- [ ] Reusable for MercadoLibre, YouTube, restaurants
