/**
 * Reusable Leaflet map HTML generator (like bin/charts.js).
 *
 * Returns HTML + JS strings for embedding in reports.
 * Uses Leaflet.js + Leaflet.markercluster from CDN.
 * OpenStreetMap tiles (free, no API key).
 *
 * Components:
 *   - renderMapContainer() — the HTML div + CDN links
 *   - renderMapScript(geocodeTable, config) — client-side JS for markers + clustering
 *   - MAP_CSS — responsive map styles
 */

/**
 * CDN links for Leaflet + MarkerCluster.
 * Injected into <head> of the report.
 */
export const MAP_CDN = `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
`;

/**
 * The map container HTML. Sits between charts and table.
 */
export function renderMapContainer() {
  return `<div class="map-section">
    <h4 class="chart-title" style="margin-bottom:0.5rem">Geographic Distribution</h4>
    <div id="data-map"></div>
    <div id="map-legend" class="map-legend"></div>
  </div>`;
}

/**
 * Client-side JS that initializes the map, renders markers, and integrates with filters.
 *
 * @param {object} geocodeTable — { "Argentina|Córdoba": {lat, lng}, ... }
 * @param {object} config — { colorField, sizeField, popupFields, defaultCenter, defaultZoom }
 */
export function renderMapScript(geocodeTable, config = {}) {
  const {
    colorField = 'domain',
    sizeField = 'seniority_score',
    popupFields = ['name', 'title', 'company', 'photo'],
    defaultCenter = [-34.6, -58.4],
    defaultZoom = 5,
  } = config;

  return `
  // ─── Leaflet Map ───
  (function() {
    const GEOCODE = ${JSON.stringify(geocodeTable)};
    const mapEl = document.getElementById('data-map');
    if (!mapEl || typeof L === 'undefined') return;

    const map = L.map('data-map', { scrollWheelZoom: true }).setView([${defaultCenter[0]}, ${defaultCenter[1]}], ${defaultZoom});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    // Domain color palette
    const DOMAIN_COLORS = {
      'Engineering': '#2c3e50',
      'Management': '#5a7d9a',
      'HR': '#c0392b',
      'Data': '#27ae60',
      'Consulting': '#8e44ad',
      'Education': '#f39c12',
      'Design': '#e67e22',
      'Marketing': '#1abc9c',
      'Finance': '#34495e',
      'Operations': '#d35400',
      'Sales': '#16a085',
      'Legal': '#7f8c8d',
      'Research': '#2980b9',
    };
    const FALLBACK_COLOR = '#5a7d9a';
    let assignedColors = {};
    let colorIdx = 0;
    const EXTRA_COLORS = ['#e74c3c','#3498db','#9b59b6','#1abc9c','#e67e22','#95a5a6','#d35400','#c0392b'];

    function domainColor(domain) {
      if (!domain) return FALLBACK_COLOR;
      if (DOMAIN_COLORS[domain]) return DOMAIN_COLORS[domain];
      if (assignedColors[domain]) return assignedColors[domain];
      assignedColors[domain] = EXTRA_COLORS[colorIdx++ % EXTRA_COLORS.length];
      return assignedColors[domain];
    }

    let clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let size = 'small', dim = 30;
        if (count >= 10) { size = 'medium'; dim = 40; }
        if (count >= 50) { size = 'large'; dim = 50; }
        return L.divIcon({
          html: '<div><span>' + count + '</span></div>',
          className: 'marker-cluster marker-cluster-' + size,
          iconSize: L.point(dim, dim)
        });
      }
    });
    map.addLayer(clusterGroup);

    function escPopup(s) { return s ? String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

    function updateMap(records) {
      clusterGroup.clearLayers();
      const popupFields = ${JSON.stringify(popupFields)};
      const colorField = ${JSON.stringify(colorField)};
      const sizeField = ${JSON.stringify(sizeField)};

      records.forEach(function(r) {
        const city = r.city;
        if (!city) return;
        // Try exact match, then country-only fallback
        let coords = GEOCODE[city];
        if (!coords) {
          const country = city.split('|')[0];
          coords = GEOCODE[country];
        }
        if (!coords) return;

        // Jitter to avoid exact overlaps in same city
        const jlat = coords.lat + (Math.random() - 0.5) * 0.015;
        const jlng = coords.lng + (Math.random() - 0.5) * 0.015;

        const score = parseInt(r[sizeField]) || 50;
        const radius = 5 + score / 15;
        const color = domainColor(r[colorField]);

        const marker = L.circleMarker([jlat, jlng], {
          radius: Math.min(radius, 14),
          color: color,
          fillColor: color,
          fillOpacity: 0.7,
          weight: 1.5,
          opacity: 0.9,
        });

        // Build popup
        let popup = '<div class="map-popup">';
        if (r.photo) popup += '<img src="' + escPopup(r.photo) + '" class="map-popup-img">';
        if (r.name) popup += '<strong>' + escPopup(r.name) + '</strong>';
        if (r.title) popup += '<div class="map-popup-title">' + escPopup(r.title) + '</div>';
        if (r.company) popup += '<div class="map-popup-company">' + escPopup(r.company) + '</div>';
        if (r[colorField]) popup += '<div class="map-popup-domain" style="color:' + color + '">' + escPopup(r[colorField]) + '</div>';
        if (r.profileUrl) popup += '<a href="' + escPopup(r.profileUrl) + '" target="_blank" class="map-popup-link">View Profile</a>';
        popup += '</div>';
        marker.bindPopup(popup);

        clusterGroup.addLayer(marker);
      });

      // Auto-zoom to fit markers
      if (clusterGroup.getLayers().length > 0) {
        try { map.fitBounds(clusterGroup.getBounds().pad(0.1)); } catch(e) {}
      }

      // Update legend
      renderLegend(records, colorField);
    }

    function renderLegend(records, colorField) {
      const legendEl = document.getElementById('map-legend');
      if (!legendEl) return;
      const domains = {};
      records.forEach(function(r) {
        const d = r[colorField];
        if (d && GEOCODE[r.city]) domains[d] = (domains[d]||0) + 1;
      });
      const sorted = Object.entries(domains).sort(function(a,b){ return b[1]-a[1]; });
      if (sorted.length === 0) { legendEl.innerHTML = ''; return; }
      legendEl.innerHTML = sorted.map(function(e) {
        return '<span class="map-legend-item"><span class="map-legend-dot" style="background:' + domainColor(e[0]) + '"></span>' + e[0] + ' (' + e[1] + ')</span>';
      }).join('');
    }

    // Expose globally so applyFilters() can call it
    window.__updateMap = updateMap;

    // Initial render with all data
    var dataEl = document.getElementById('table-data');
    if (dataEl) {
      try {
        var initData = JSON.parse(dataEl.textContent);
        updateMap(initData.allRecords);
      } catch(e) {}
    }

    // Fix map tiles not loading due to container size (Leaflet quirk)
    setTimeout(function() { map.invalidateSize(); }, 200);
  })();
  `;
}

/** CSS for the map component */
export const MAP_CSS = `
  /* Map container */
  .map-section { margin: 1rem 0; }
  #data-map {
    height: 500px;
    border-radius: 8px;
    border: 1px solid #e0d8cf;
    z-index: 1;
  }

  /* Popup */
  .map-popup { font-family: 'Inter', sans-serif; font-size: 0.8rem; max-width: 220px; }
  .map-popup img.map-popup-img { width: 48px; height: 48px; border-radius: 50%; float: left; margin-right: 8px; margin-bottom: 4px; object-fit: cover; }
  .map-popup strong { display: block; font-size: 0.85rem; color: #2c3e50; }
  .map-popup-title { color: #555; font-size: 0.75rem; margin-top: 2px; }
  .map-popup-company { color: #888; font-size: 0.72rem; }
  .map-popup-domain { font-size: 0.7rem; font-weight: 600; margin-top: 3px; }
  .map-popup-link { display: inline-block; margin-top: 4px; font-size: 0.72rem; color: #c0392b; }

  /* Legend */
  .map-legend { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.4rem; padding: 0.3rem 0; }
  .map-legend-item { display: flex; align-items: center; gap: 4px; font-size: 0.72rem; color: #555; }
  .map-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

  /* Cluster overrides for theme */
  .marker-cluster-small { background-color: rgba(93,165,207,0.4); }
  .marker-cluster-small div { background-color: rgba(93,165,207,0.7); }
  .marker-cluster-medium { background-color: rgba(44,62,80,0.4); }
  .marker-cluster-medium div { background-color: rgba(44,62,80,0.7); }
  .marker-cluster-large { background-color: rgba(192,57,43,0.4); }
  .marker-cluster-large div { background-color: rgba(192,57,43,0.7); }
  .marker-cluster div { width: 30px; height: 30px; margin-left: 5px; margin-top: 5px; text-align: center; border-radius: 15px; font: 12px 'Inter', sans-serif; color: #fff; font-weight: 600; line-height: 30px; }

  /* Responsive */
  @media (max-width: 768px) {
    #data-map { height: 400px; }
  }
  @media (max-width: 480px) {
    #data-map { height: 300px; border-radius: 4px; }
    .map-popup { max-width: 180px; }
    .map-popup img.map-popup-img { width: 36px; height: 36px; }
  }
`;
