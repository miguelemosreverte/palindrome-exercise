import { marked } from 'marked';
import { readFileSync, writeFileSync } from 'fs';

/**
 * Universal Markdown → HTML converter with:
 * - WSJ/newspaper aesthetic (light, serif headlines, clean)
 * - Domain-specific data layouts (grid, feed, graph, table)
 * - Mobile-first responsive design
 * - Chart.js + D3.js support
 */
export function md2html(inputPath, outputPath) {
  let md = readFileSync(inputPath, 'utf8');

  // Extract layout hint
  const layoutMatch = md.match(/<!-- layout: (\w+) -->/);
  const layout = layoutMatch ? layoutMatch[1] : 'table';
  const taskMatch = md.match(/<!-- task: ([^\s]+) -->/);
  const taskName = taskMatch?.[1] || inputPath.split('/').at(-2) || '';

  // Extract JSON data block
  let dataBlock = null;
  md = md.replace(/<!-- data:json\n([\s\S]*?)\n-->/g, (_, json) => {
    try { dataBlock = JSON.parse(json); } catch {}
    return '<div id="data-root"></div>';
  });

  // Extract chartjs blocks
  const charts = [];
  md = md.replace(/```chartjs\n([\s\S]*?)```/g, (_, json) => {
    const id = `chart-${charts.length}`;
    charts.push({ id, config: json.trim() });
    return `<div class="chart-wrap"><canvas id="${id}"></canvas></div>`;
  });

  const html = marked.parse(md);

  const chartScripts = charts.map(c =>
    `new Chart(document.getElementById('${c.id}'), ${c.config});`
  ).join('\n');

  // Build data renderer based on layout
  const dataRenderer = dataBlock ? buildDataRenderer(layout, dataBlock) : '';
  const dataScript = dataBlock ? buildDataScript(layout, dataBlock) : '';

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${inputPath.split('/').pop().replace('.md', '')}</title>
  <meta name="task" content="${taskName}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>${CSS_BASE}${CSS_LAYOUTS}</style>
</head>
<body>
  <div class="page">
    <div class="masthead">
      <div class="masthead-rule"></div>
      <div class="masthead-title">OPENCODE INGEST</div>
      <div class="masthead-rule"></div>
    </div>
    <article class="content">
      ${(() => {
        let h = dataBlock && layout !== 'table'
          ? html.replace(/<table>/g, '<div class="table-wrap" style="display:none"><table>').replace(/<\/table>/g, '</table></div>')
          : html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
        // Inject custom layout where #data-root placeholder is
        if (dataRenderer) h = h.replace('<div id="data-root"></div>', dataRenderer);
        return h;
      })()}
    </article>
  </div>
  <script>
    ${chartScripts}
    ${dataScript}
  </script>
</body>
</html>`;

  writeFileSync(outputPath, page);
  console.log(`HTML written to ${outputPath}`);
}

function buildDataRenderer(layout, data) {
  if (!data?.records?.length) return '';
  const records = data.records;
  const columns = data.columns || Object.keys(records[0] || {});

  if (layout === 'grid') return buildGrid(records, columns);
  if (layout === 'feed') return buildFeed(records, columns);
  if (layout === 'graph') return buildGraph(records, columns, data.showcaseResults);
  return ''; // table is already in markdown
}

function buildGrid(records, columns) {
  const col = (pattern) => columns.find(c => pattern.test(c));
  const titleCol = col(/^title$/i) || columns[0];
  const priceCol = col(/^price$/i);
  const origPriceCol = col(/original_price/i);
  const discountCol = col(/discount/i);
  const urlCol = col(/^url$/i);
  const imageCol = col(/image/i);
  const sellerCol = col(/seller/i);
  const brandCol = col(/brand/i);
  const shippingCol = col(/^shipping$/i);
  const freeShipCol = col(/free_shipping/i);
  const installCol = col(/installment/i);
  const ratingCol = col(/rating/i);
  const reviewsCol = col(/reviews/i);
  const couponCol = col(/coupon/i);

  const cards = records.map(r => {
    const title = r[titleCol] || '';
    const price = r[priceCol] || '';
    const origPrice = r[origPriceCol] || '';
    const discount = r[discountCol] || '';
    const url = r[urlCol] || '#';
    const image = r[imageCol] || '';
    const seller = r[sellerCol] || '';
    const brand = r[brandCol] || '';
    const shipping = r[shippingCol] || '';
    const freeShip = r[freeShipCol];
    const installments = r[installCol] || '';
    const rating = parseFloat(r[ratingCol]) || 0;
    const reviews = parseInt(r[reviewsCol]) || 0;
    const coupon = r[couponCol] || '';

    const stars = rating > 0 ? `<span class="card-stars">${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))} <small>${rating}</small></span>` : '';

    return `<a href="${escHtml(url)}" class="card" target="_blank">
      ${image ? `<div class="card-img"><img src="${escHtml(image)}" alt="" loading="lazy"></div>` : ''}
      <div class="card-body">
        <div class="card-price-row">
          <span class="card-price">${escHtml(price)}</span>
          ${discount ? `<span class="card-discount">${escHtml(discount)}</span>` : ''}
        </div>
        ${origPrice && discount ? `<span class="card-orig-price">${escHtml(origPrice)}</span>` : ''}
        ${installments ? `<div class="card-installments">${escHtml(installments)}</div>` : ''}
        <h3 class="card-title">${escHtml(title.substring(0, 90))}</h3>
        ${stars}
        <div class="card-meta">
          ${freeShip ? `<span class="tag tag-ship">Envío gratis</span>` : (shipping ? `<span class="tag">${escHtml(shipping)}</span>` : '')}
          ${coupon ? `<span class="tag tag-coupon">${escHtml(coupon)}</span>` : ''}
        </div>
        ${seller || brand ? `<div class="card-seller">${escHtml(brand || seller)}</div>` : ''}
      </div>
    </a>`;
  }).join('\n');

  return `<section class="layout-section"><h2 class="section-title">Listings</h2><div class="grid-cards">${cards}</div></section>`;
}

function buildFeed(records, columns) {
  const col = (pattern) => columns.find(c => pattern.test(c));
  const titleCol = col(/^title$/i) || columns[0];
  const channelCol = col(/^channel$/i);
  const channelAvatarCol = col(/channelAvatar/i);
  const viewsCol = col(/^views$/i);
  const shortViewsCol = col(/shortViews/i);
  const pubCol = col(/published/i);
  const durCol = col(/^duration$/i);
  const urlCol = col(/^url$/i);
  const descCol = col(/description/i);
  const thumbCol = col(/^thumbnail$/i);
  const badgesCol = col(/badges/i);

  const items = records.map(r => {
    const title = r[titleCol] || '';
    const channel = r[channelCol] || '';
    const channelAvatar = r[channelAvatarCol] || '';
    const views = r[shortViewsCol] || r[viewsCol] || '';
    const pub = r[pubCol] || '';
    const dur = r[durCol] || '';
    const url = r[urlCol] || '#';
    const desc = r[descCol] || '';
    const thumb = r[thumbCol] || '';
    const badges = r[badgesCol] || '';

    const badgeHtml = badges ? badges.split(',').map(b => `<span class="feed-badge">${escHtml(b.trim())}</span>`).join('') : '';

    return `<a href="${escHtml(url)}" class="feed-item" target="_blank">
      <div class="feed-thumb"${thumb ? ` style="background-image:url('${escHtml(thumb)}');background-size:cover;background-position:center"` : ''}>
        ${dur ? `<span class="feed-dur">${escHtml(dur)}</span>` : '<span class="feed-play">▶</span>'}
        ${badgeHtml ? `<div class="feed-badges">${badgeHtml}</div>` : ''}
      </div>
      <div class="feed-body">
        <h3 class="feed-title">${escHtml(title)}</h3>
        <div class="feed-channel">
          ${channelAvatar ? `<img class="feed-avatar" src="${escHtml(channelAvatar)}" alt="">` : ''}
          <span>${escHtml(channel)}</span>
        </div>
        <div class="feed-meta">${escHtml([views, pub].filter(Boolean).join(' · '))}</div>
        ${desc ? `<p class="feed-desc">${escHtml(desc.substring(0, 180))}</p>` : ''}
      </div>
    </a>`;
  }).join('\n');

  return `<section class="layout-section"><h2 class="section-title">Feed</h2><div class="feed">${items}</div></section>`;
}

function buildGraph(records, columns, showcaseResults) {
  // Collect facet values from labeled data
  const facets = {
    domain: {}, seniority_level: {}, city: {},
  };
  const allTechStack = {};
  const allIndustries = {};
  const skillTree = {};  // parent → Set of children

  records.forEach(r => {
    for (const f of Object.keys(facets)) {
      const v = r[f];
      if (v && v.length > 0) facets[f][v] = (facets[f][v] || 0) + 1;
    }
    // skills_normalized: [{path:"Parent|Child", confidence, source}] — pipe-delimited hierarchy
    try {
      const parsed = JSON.parse(r.skills_normalized || r.tech_stack || '[]');
      parsed.forEach(t => {
        if (typeof t === 'string') {
          // Old format: plain string
          allTechStack[t] = (allTechStack[t] || 0) + 1;
        } else if (t.path) {
          // New format: pipe-delimited path
          const parts = t.path.split('|');
          const leaf = parts[parts.length - 1];
          const parent = parts.length > 1 ? parts[0] : 'Other';
          allTechStack[leaf] = (allTechStack[leaf] || 0) + 1;
          if (!skillTree[parent]) skillTree[parent] = new Set();
          skillTree[parent].add(leaf);
        } else if (t.name) {
          // Old {name, parent} format
          allTechStack[t.name] = (allTechStack[t.name] || 0) + 1;
          if (t.parent) { if (!skillTree[t.parent]) skillTree[t.parent] = new Set(); skillTree[t.parent].add(t.name); }
        }
      });
    } catch {}
    try { JSON.parse(r.industries || '[]').forEach(t => { allIndustries[t] = (allIndustries[t] || 0) + 1; }); } catch {}
  });

  const isLabeled = records.some(r => r.domain);

  // Stat cards
  const stats = `<div class="stat-cards">
    <div class="stat-card"><div class="stat-number">${records.length}</div><div class="stat-label">Professionals</div></div>
    <div class="stat-card"><div class="stat-number">${Object.keys(facets.city).length}</div><div class="stat-label">Cities</div></div>
    <div class="stat-card"><div class="stat-number">${Object.keys(allTechStack).length}</div><div class="stat-label">Technologies</div></div>
  </div>`;

  // Build facet dropdowns
  const dropdown = (id, label, values) => {
    const opts = Object.entries(values).sort((a,b) => b[1]-a[1])
      .map(([v, c]) => `<option value="${escHtml(v)}">${escHtml(v)} (${c})</option>`).join('');
    return `<select class="facet-select" data-facet="${id}"><option value="">All ${label}</option>${opts}</select>`;
  };

  // Build skill tree pills — parent nodes are clickable to expand children
  const treeEntries = Object.entries(skillTree).sort((a,b) => b[1].size - a[1].size);
  const techPills = treeEntries.map(([parent, children]) => {
    const childArr = [...children].sort();
    const childPills = childArr.map(c => {
      const count = allTechStack[c] || 0;
      return `<button class="facet-tag facet-tag-child" data-facet="tech_stack" data-value="${escHtml(c)}" style="display:none">${escHtml(c)} <small>${count}</small></button>`;
    }).join('');
    const totalCount = childArr.reduce((s, c) => s + (allTechStack[c] || 0), 0);
    return `<span class="skill-group"><button class="facet-tag facet-tag-parent" data-group="${escHtml(parent)}">${escHtml(parent)} <small>${totalCount}</small></button>${childPills}</span>`;
  }).join('');

  const topIndustries = Object.entries(allIndustries).sort((a,b) => b[1]-a[1]).slice(0, 15);
  const industryPills = topIndustries.map(([t, c]) =>
    `<button class="facet-tag" data-facet="industries" data-value="${escHtml(t)}">${escHtml(t)} <small>${c}</small></button>`
  ).join('');

  const tableData = JSON.stringify({ allRecords: records, columns });

  return `<section class="layout-section">
    ${stats}

    ${isLabeled ? `<div class="facets">
      <div class="facet-row">
        ${dropdown('domain', 'Domains', facets.domain)}
        ${dropdown('seniority_level', 'Seniority', facets.seniority_level)}
        ${dropdown('city', 'Cities', facets.city)}
        <button id="facet-clear" class="facet-clear">Clear all</button>
      </div>
      <div class="facet-row">
        <label class="slider-label">Seniority Score: <span id="slider-val">0</span>+</label>
        <input type="range" id="facet-seniority-score" class="facet-slider" min="0" max="100" value="0">
      </div>
      ${techPills ? `<div class="facet-tags"><span class="facet-tags-label">Stack:</span> ${techPills}</div>` : ''}
      ${industryPills ? `<div class="facet-tags"><span class="facet-tags-label">Industry:</span> ${industryPills}</div>` : ''}
      <div id="active-filters" class="active-filters"></div>
    </div>` : '<p style="color:#999;font-size:0.85rem">Run <code>node bin/label.js ar-senior-devs-linkedin</code> to enable faceted filters</p>'}

    <div class="query-section">
      <div style="display:flex;justify-content:flex-end;margin-bottom:0.5rem">
        <button id="query-export" class="query-btn-export" title="Export CSV">Export CSV</button>
      </div>
      <div id="query-table" class="query-table"></div>
      <div id="query-pagination" class="query-pagination"></div>
    </div>
  </section>
  <script id="table-data" type="application/json">${tableData}</script>`;
}

function buildDataScript(layout, data) {
  if (layout !== 'graph') return '';
  // Client-side table engine with sort, paginate, query showcase
  return TABLE_ENGINE_JS;
}

const TABLE_ENGINE_JS = `
(function() {
  const dataEl = document.getElementById('table-data');
  if (!dataEl) return;
  const DATA = JSON.parse(dataEl.textContent);
  const tableEl = document.getElementById('query-table');
  const paginationEl = document.getElementById('query-pagination');
  const sqlEl = document.getElementById('query-sql');
  const selectEl = document.getElementById('query-showcase');
  const exportBtn = document.getElementById('query-export');

  let currentRows = DATA.allRecords;
  let currentCols = DATA.columns.filter(c => !c.startsWith('_') && c !== 'source');
  let sortCol = null, sortDir = 1;
  let page = 0, perPage = 25;
  let currentLabel = 'All records';

  // Column display config
  const imgCols = new Set(['photo', 'companyLogo', 'image', 'thumbnail', 'channelAvatar', 'richThumbnail']);
  const urlCols = new Set(['url', 'profileUrl', 'channelUrl']);
  const tagCols = new Set(['skills', 'badges']);
  const hideCols = new Set(['headline', 'description', 'companyLogo', 'richThumbnail']);

  function visibleCols() { return currentCols.filter(c => !hideCols.has(c)); }

  function renderCell(val, col) {
    if (!val) return '<span class="cell-empty">—</span>';
    const s = String(val);
    if (imgCols.has(col) && s.startsWith('http')) return '<img class="cell-img" src="' + s + '" loading="lazy">';
    if (urlCols.has(col) && s.startsWith('http')) return '<a href="' + s + '" target="_blank" class="cell-link">View →</a>';
    if (tagCols.has(col)) return s.split(',').map(t => '<span class="cell-tag">' + t.trim() + '</span>').join(' ');
    if (s.length > 80) return '<span title="' + s.replace(/"/g, '&quot;') + '">' + s.substring(0, 80) + '…</span>';
    return s;
  }

  function render() {
    const cols = visibleCols();
    const sorted = [...currentRows];
    if (sortCol !== null) {
      sorted.sort((a, b) => {
        const va = a[sortCol] || '', vb = b[sortCol] || '';
        const na = parseFloat(va), nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) return (na - nb) * sortDir;
        return String(va).localeCompare(String(vb)) * sortDir;
      });
    }

    const start = page * perPage;
    const pageRows = sorted.slice(start, start + perPage);
    const totalPages = Math.ceil(sorted.length / perPage);

    let html = '<table class="qt"><thead><tr>';
    for (const col of cols) {
      const arrow = sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : ' ↕';
      html += '<th data-col="' + col + '">' + col + '<span class="sort-arrow">' + arrow + '</span></th>';
    }
    html += '</tr></thead><tbody>';

    for (const row of pageRows) {
      html += '<tr>';
      for (const col of cols) {
        html += '<td data-label="' + col + '">' + renderCell(row[col], col) + '</td>';
      }
      html += '</tr>';
    }
    if (pageRows.length === 0) html += '<tr><td colspan="' + cols.length + '" class="cell-empty" style="text-align:center;padding:2rem">No results</td></tr>';
    html += '</tbody></table>';

    tableEl.innerHTML = html;

    // Pagination
    paginationEl.innerHTML = '<div class="pag-info">' + currentLabel + ' — ' +
      sorted.length + ' results, page ' + (page + 1) + '/' + Math.max(totalPages, 1) + '</div>' +
      '<div class="pag-controls">' +
      '<button class="pag-btn" id="pag-prev"' + (page === 0 ? ' disabled' : '') + '>← Prev</button>' +
      '<select id="pag-size">' + [25,50,100,500].map(n => '<option' + (n===perPage?' selected':'') + '>' + n + '</option>').join('') + '</select>' +
      '<button class="pag-btn" id="pag-next"' + (page >= totalPages - 1 ? ' disabled' : '') + '>Next →</button>' +
      '</div>';

    // Sort click handlers
    tableEl.querySelectorAll('th').forEach(th => {
      th.style.cursor = 'pointer';
      th.onclick = () => {
        const col = th.dataset.col;
        if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
        render();
      };
    });

    // Pagination handlers
    document.getElementById('pag-prev')?.addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
    document.getElementById('pag-next')?.addEventListener('click', () => { page = Math.min(totalPages - 1, page + 1); render(); });
    document.getElementById('pag-size')?.addEventListener('change', (e) => { perPage = parseInt(e.target.value); page = 0; render(); });
  }

  // ─── Faceted Filtering ───

  const activeFilters = {};  // { facetName: value | Set }

  function applyFilters() {
    let filtered = DATA.allRecords;

    for (const [facet, value] of Object.entries(activeFilters)) {
      if (!value || (value instanceof Set && value.size === 0)) continue;

      if (facet === 'seniority_score_min') {
        filtered = filtered.filter(r => parseInt(r.seniority_score) >= value);
      } else if (facet === 'skill_category') {
        // OR within categories: person has ANY skill in ANY selected category
        const cats = value; // Set of parent category names
        filtered = filtered.filter(r => {
          try {
            const arr = JSON.parse(r.skills_normalized || r.tech_stack || '[]');
            return [...cats].some(cat => arr.some(s => {
              if (s.path) return s.path.split('|')[0] === cat;
              if (s.parent) return s.parent === cat;
              return false;
            }));
          } catch { return false; }
        });
      } else if (facet === 'tech_stack') {
        const tags = value; // Set
        filtered = filtered.filter(r => {
          const skills = (r.skills || '').toLowerCase();
          try {
            const arr = JSON.parse(r.skills_normalized || r.tech_stack || '[]');
            const names = arr.map(s => {
              if (s.path) return s.path.split('|').pop().toLowerCase();
              if (typeof s === 'string') return s.toLowerCase();
              return (s.name || '').toLowerCase();
            });
            return [...tags].every(t => names.some(n => n.includes(t.toLowerCase())) || skills.includes(t.toLowerCase()));
          } catch {
            return [...tags].every(t => skills.includes(t.toLowerCase()));
          }
        });
      } else if (facet === 'industries') {
        const tags = value;
        filtered = filtered.filter(r => {
          try {
            const arr = JSON.parse(r[facet] || '[]').map(s => s.toLowerCase());
            return [...tags].every(t => arr.some(a => a.includes(t.toLowerCase())));
          } catch { return false; }
        });
      } else {
        // Enum: exact match
        filtered = filtered.filter(r => r[facet] === value);
      }
    }

    currentRows = filtered;
    currentLabel = Object.entries(activeFilters)
      .filter(([,v]) => v && (!(v instanceof Set) || v.size > 0))
      .map(([k,v]) => v instanceof Set ? [...v].join('+') : v)
      .join(', ') || 'All records';
    page = 0;
    render();
    renderActiveFilters();
  }

  // Dropdown facets
  document.querySelectorAll('.facet-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const facet = sel.dataset.facet;
      activeFilters[facet] = sel.value || undefined;
      if (!sel.value) delete activeFilters[facet];
      applyFilters();
    });
  });

  // Skill tree parent click → immediately filter by category + expand children
  document.querySelectorAll('.facet-tag-parent').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const children = btn.parentElement.querySelectorAll('.facet-tag-child');

      // Always expand children on click
      children.forEach(c => c.style.display = 'inline-block');
      btn.classList.add('expanded');

      // Toggle category filter
      if (!activeFilters.skill_category) activeFilters.skill_category = new Set();
      if (activeFilters.skill_category.has(group)) {
        activeFilters.skill_category.delete(group);
        btn.classList.remove('active');
        // Collapse if deselecting
        children.forEach(c => { c.style.display = 'none'; c.classList.remove('active'); });
        btn.classList.remove('expanded');
      } else {
        activeFilters.skill_category.add(group);
        btn.classList.add('active');
      }
      if (activeFilters.skill_category.size === 0) delete activeFilters.skill_category;
      applyFilters();
    });
  });

  // Tag pills (toggle) — only child tags, not parent group buttons
  document.querySelectorAll('.facet-tag[data-facet]').forEach(btn => {
    if (btn.classList.contains('facet-tag-parent')) return;
    btn.addEventListener('click', () => {
      const facet = btn.dataset.facet;
      const value = btn.dataset.value;
      if (!activeFilters[facet]) activeFilters[facet] = new Set();
      if (activeFilters[facet].has(value)) {
        activeFilters[facet].delete(value);
        btn.classList.remove('active');
      } else {
        activeFilters[facet].add(value);
        btn.classList.add('active');
      }
      applyFilters();
    });
  });

  // Seniority slider
  const slider = document.getElementById('facet-seniority-score');
  const sliderVal = document.getElementById('slider-val');
  slider?.addEventListener('input', () => {
    const v = parseInt(slider.value);
    sliderVal.textContent = v;
    if (v > 0) activeFilters.seniority_score_min = v;
    else delete activeFilters.seniority_score_min;
    applyFilters();
  });

  // Clear all
  document.getElementById('facet-clear')?.addEventListener('click', () => {
    for (const key of Object.keys(activeFilters)) delete activeFilters[key];
    document.querySelectorAll('.facet-select').forEach(s => s.value = '');
    document.querySelectorAll('.facet-tag.active').forEach(b => b.classList.remove('active'));
    if (slider) { slider.value = 0; sliderVal.textContent = '0'; }
    applyFilters();
  });

  // Render active filter chips
  function renderActiveFilters() {
    const el = document.getElementById('active-filters');
    if (!el) return;
    const chips = [];
    for (const [k, v] of Object.entries(activeFilters)) {
      if (!v || (v instanceof Set && v.size === 0)) continue;
      if (v instanceof Set) {
        for (const t of v) chips.push('<span class="filter-chip">' + k + ': ' + t + ' <button data-facet="' + k + '" data-value="' + t + '">×</button></span>');
      } else if (k === 'seniority_score_min') {
        chips.push('<span class="filter-chip">Score ≥ ' + v + ' <button data-facet="__score">×</button></span>');
      } else {
        chips.push('<span class="filter-chip">' + k + ': ' + v + ' <button data-facet="' + k + '">×</button></span>');
      }
    }
    el.innerHTML = chips.length ? chips.join('') + ' <span class="filter-count">' + currentRows.length + ' results</span>' : '';
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.facet;
        if (f === '__score') { delete activeFilters.seniority_score_min; if (slider) slider.value = 0; if (sliderVal) sliderVal.textContent = '0'; }
        else if (activeFilters[f] instanceof Set) { activeFilters[f].delete(btn.dataset.value); document.querySelector('.facet-tag[data-value=\"'+btn.dataset.value+'\"]')?.classList.remove('active'); }
        else { delete activeFilters[f]; document.querySelector('.facet-select[data-facet=\"'+f+'\"]').value = ''; }
        applyFilters();
      });
    });
  }

  // CSV export
  exportBtn?.addEventListener('click', () => {
    const cols = visibleCols();
    const csv = [cols.join(','), ...currentRows.map(r => cols.map(c => '"' + String(r[c] || '').replace(/"/g, '""') + '"').join(','))].join('\\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'export.csv'; a.click();
  });


  // Initial render — show all
  render();
})();
`;

// Dead code — kept signature for compatibility
function _oldBuildDataScript(layout, data) {
  if (layout !== 'graph' || !data?.records?.length) return '';

  const records = data.records;
  const companyCol = data.columns?.find(c => /company|org/i.test(c));
  const nameCol = data.columns?.find(c => /^name$/i.test(c)) || data.columns?.[0];
  const titleCol = data.columns?.find(c => /^title$/i.test(c));
  const skillsCol = data.columns?.find(c => /skills/i.test(c));
  const urlCol = data.columns?.find(c => /url|profileUrl/i.test(c));
  const seniorityCol = data.columns?.find(c => /seniority/i.test(c));
  if (!companyCol) return '';

  // Build graph data — include ALL people, even solo companies
  const nodes = [];
  const links = [];
  const nodeMap = {};
  const companyCounts = {};

  records.forEach(r => {
    const co = r[companyCol];
    if (co && co.length > 1) companyCounts[co] = (companyCounts[co] || 0) + 1;
  });

  records.forEach(r => {
    const name = r[nameCol];
    const company = r[companyCol];
    const title = r[titleCol] || '';
    const skills = r[skillsCol] || '';
    const url = r[urlCol] || '';
    const seniority = r[seniorityCol] || '';
    if (!name || name.length < 3) return;

    if (!nodeMap[name]) {
      const n = { id: name, type: 'person', title, skills, url, seniority, count: 1 };
      nodeMap[name] = n;
      nodes.push(n);
    }
    if (company && company.length > 1) {
      if (!nodeMap[company]) {
        const n = { id: company, type: 'company', count: companyCounts[company] };
        nodeMap[company] = n;
        nodes.push(n);
      }
      links.push({ source: name, target: company });
    }
  });

  return `
(function() {
  const container = document.getElementById('network-graph');
  if (!container || typeof d3 === 'undefined') return;
  const width = container.offsetWidth || 900;
  const height = 650;
  const nodes = ${JSON.stringify(nodes)};
  const links = ${JSON.stringify(links)};

  // Detail panel
  const detail = document.createElement('div');
  detail.className = 'graph-detail';
  detail.innerHTML = '<p style="color:#999;font-style:italic">Click a node to see details</p>';
  container.parentNode.insertBefore(detail, container.nextSibling);

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height)
    .attr('class', 'graph-svg');

  const g = svg.append('g');

  // Zoom + pan
  const zoom = d3.zoom().scaleExtent([0.15, 6])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(50).strength(0.7))
    .force('charge', d3.forceManyBody().strength(d => d.type === 'company' ? -200 - (d.count || 1) * 40 : -30))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.type === 'company' ? 10 + (d.count || 1) * 5 : 8))
    .force('x', d3.forceX(width / 2).strength(0.05))
    .force('y', d3.forceY(height / 2).strength(0.05));

  const link = g.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', '#d4cdc4').attr('stroke-width', 1).attr('class', 'graph-link');

  const nodeG = g.append('g').selectAll('g').data(nodes).join('g')
    .attr('class', d => 'graph-node graph-node--' + d.type)
    .style('cursor', 'pointer')
    .call(d3.drag().on('start', ds).on('drag', dd).on('end', de));

  nodeG.append('circle')
    .attr('r', d => d.type === 'company' ? 8 + (d.count || 1) * 4 : 5)
    .attr('fill', d => d.type === 'company' ? '#c0392b' : '#5a7d9a')
    .attr('stroke', d => d.type === 'company' ? '#fff' : 'none')
    .attr('stroke-width', d => d.type === 'company' ? 2 : 0);

  // Company labels always visible
  nodeG.filter(d => d.type === 'company').append('text')
    .text(d => d.id.length > 22 ? d.id.substring(0, 22) + '…' : d.id)
    .attr('dy', d => -(12 + (d.count || 1) * 3))
    .attr('text-anchor', 'middle')
    .attr('font-size', d => 9 + Math.min((d.count || 1), 6))
    .attr('font-weight', '600')
    .attr('fill', '#2c3e50')
    .style('pointer-events', 'none');

  // Person labels (smaller, shown on hover)
  nodeG.filter(d => d.type === 'person').append('text')
    .text(d => d.id.split(' ')[0])
    .attr('dy', -10).attr('text-anchor', 'middle')
    .attr('font-size', 8).attr('fill', '#888')
    .style('pointer-events', 'none').style('opacity', 0).attr('class', 'person-label');

  // Click: highlight connections + show detail
  let selected = null;
  nodeG.on('click', (event, d) => {
    event.stopPropagation();
    selected = d.id;

    // Reset all
    nodeG.select('circle').attr('opacity', 0.2);
    link.attr('opacity', 0.05).attr('stroke-width', 1);
    nodeG.selectAll('.person-label').style('opacity', 0);

    // Highlight connected
    const connected = new Set();
    connected.add(d.id);
    links.forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === d.id) connected.add(t);
      if (t === d.id) connected.add(s);
    });

    nodeG.select('circle').attr('opacity', nd => connected.has(nd.id) ? 1 : 0.1);
    nodeG.selectAll('.person-label').style('opacity', nd => connected.has(nd.id) ? 1 : 0);
    link.attr('opacity', l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return (s === d.id || t === d.id) ? 1 : 0.03;
    }).attr('stroke-width', l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return (s === d.id || t === d.id) ? 2.5 : 1;
    });

    // Detail panel
    if (d.type === 'company') {
      const people = nodes.filter(n => n.type === 'person' && connected.has(n.id));
      detail.innerHTML = '<h3>' + d.id + '</h3><p>' + (d.count||0) + ' people</p>' +
        '<div class="detail-people">' + people.map(p =>
          '<a href="' + (p.url||'#') + '" target="_blank" class="detail-person">' +
          '<strong>' + p.id + '</strong>' +
          (p.title ? '<br><span>' + p.title + '</span>' : '') +
          (p.seniority ? '<br><small>' + p.seniority + '</small>' : '') +
          '</a>'
        ).join('') + '</div>';
    } else {
      detail.innerHTML =
        '<h3>' + d.id + '</h3>' +
        (d.title ? '<p>' + d.title + '</p>' : '') +
        (d.seniority ? '<p><strong>Seniority:</strong> ' + d.seniority + '</p>' : '') +
        (d.skills ? '<p><strong>Skills:</strong> ' + d.skills + '</p>' : '') +
        (d.url ? '<a href="' + d.url + '" target="_blank">View Profile →</a>' : '');
    }
  });

  // Click background to reset
  svg.on('click', () => {
    selected = null;
    nodeG.select('circle').attr('opacity', 1);
    link.attr('opacity', 0.6).attr('stroke-width', 1);
    nodeG.selectAll('.person-label').style('opacity', 0);
    detail.innerHTML = '<p style="color:#999;font-style:italic">Click a node to see details</p>';
  });

  simulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeG.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });

  // Fit to content after simulation settles
  simulation.on('end', () => {
    const bounds = g.node().getBBox();
    const scale = Math.min(width / (bounds.width + 60), height / (bounds.height + 60), 1.5);
    const tx = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const ty = (height - bounds.height * scale) / 2 - bounds.y * scale;
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  });

  function ds(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  function dd(event, d) { d.fx = event.x; d.fy = event.y; }
  function de(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
})();`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Styles ──────────────────────────────────────────────────────────────

const CSS_BASE = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #f8f5f0; color: #1a1a1a; line-height: 1.6; }
  .page { max-width: 1100px; margin: 0 auto; padding: 1rem; }

  /* Masthead */
  .masthead { text-align: center; padding: 1.5rem 0 1rem; }
  .masthead-rule { border-top: 3px double #1a1a1a; margin: 0.3rem 0; }
  .masthead-title { font-family: 'Playfair Display', Georgia, serif; font-size: 0.85rem; letter-spacing: 0.3em; text-transform: uppercase; color: #666; }

  /* Typography */
  h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 2.2rem; font-weight: 900; line-height: 1.15; margin-bottom: 0.3rem; border-bottom: 2px solid #1a1a1a; padding-bottom: 0.5rem; }
  h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.3rem; font-weight: 700; margin: 2rem 0 0.8rem; padding-bottom: 0.3rem; border-bottom: 1px solid #d4cdc4; color: #2c3e50; }
  h3 { font-size: 1rem; font-weight: 600; margin: 1rem 0 0.4rem; }
  p, li { margin-bottom: 0.4rem; font-size: 0.95rem; }
  em { color: #666; }
  strong { color: #c0392b; font-weight: 600; }
  a { color: #c0392b; text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote { border-left: 3px solid #c0392b; padding: 0.8rem 1rem; background: #f0ebe4; margin: 1rem 0; font-style: italic; color: #444; border-radius: 0 4px 4px 0; }
  ul { padding-left: 1.2rem; list-style: disc; }

  /* Charts */
  .chart-wrap { background: #fff; border: 1px solid #e0d8cf; border-radius: 6px; padding: 1rem; margin: 1rem 0; }
  canvas { max-height: 350px; }

  /* Tables (fallback) */
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.82rem; }
  th { background: #2c3e50; color: #fff; text-align: left; padding: 0.5rem 0.6rem; font-weight: 500; position: sticky; top: 0; z-index: 1; }
  td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e0d8cf; }
  tr:hover { background: #f0ebe4; }
  .table-wrap { max-height: 70vh; overflow: auto; border: 1px solid #e0d8cf; border-radius: 6px; margin: 1rem 0; }

  /* Section title */
  .section-title { font-family: 'Playfair Display', Georgia, serif; font-size: 1.3rem; border-bottom: 1px solid #d4cdc4; padding-bottom: 0.3rem; margin: 2rem 0 1rem; }
  .layout-section { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }

  /* Comments — hide metadata */
  [style*="display:none"] { display: none; }

  @media (max-width: 640px) {
    .page { padding: 0.5rem; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.1rem; }
    .chart-wrap { padding: 0.5rem; }
    canvas { max-height: 250px; }
  }
`;

const CSS_LAYOUTS = `
  /* ─── Grid (MercadoLibre-style) ─── */
  .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.8rem; margin: 1rem 0; }
  .card { display: flex; flex-direction: column; background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; overflow: hidden; transition: box-shadow 0.2s, transform 0.15s; text-decoration: none !important; color: inherit; }
  .card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); transform: translateY(-2px); }
  .card-img { width: 100%; aspect-ratio: 1; overflow: hidden; background: #f0ebe4; display: flex; align-items: center; justify-content: center; }
  .card-img img { width: 100%; height: 100%; object-fit: cover; }
  .card-body { padding: 0.8rem; flex: 1; display: flex; flex-direction: column; }
  .card-price-row { display: flex; align-items: baseline; gap: 0.4rem; }
  .card-price { font-size: 1.3rem; font-weight: 600; color: #1a1a1a; }
  .card-discount { font-size: 0.8rem; font-weight: 600; color: #00a650; }
  .card-orig-price { font-size: 0.8rem; color: #999; text-decoration: line-through; display: block; margin-top: -0.1rem; }
  .card-installments { font-size: 0.75rem; color: #00a650; margin-top: 0.2rem; }
  .card-title { font-size: 0.82rem; font-weight: 400; color: #333; line-height: 1.35; margin: 0.4rem 0; flex: 1; }
  .card-stars { font-size: 0.75rem; color: #ff9900; margin-bottom: 0.3rem; display: block; }
  .card-stars small { color: #666; font-size: 0.7rem; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: auto; }
  .tag { font-size: 0.68rem; padding: 0.15rem 0.45rem; border-radius: 3px; background: #f0ebe4; color: #666; }
  .tag-ship { background: #d4edda; color: #00a650; font-weight: 500; }
  .tag-coupon { background: #fff3cd; color: #856404; }
  .card-seller { font-size: 0.72rem; color: #999; margin-top: 0.3rem; }

  @media (max-width: 640px) {
    .grid-cards { grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .card-body { padding: 0.5rem; }
    .card-price { font-size: 1rem; }
    .card-title { font-size: 0.75rem; }
  }
  @media (max-width: 380px) {
    .grid-cards { grid-template-columns: 1fr; }
    .card { flex-direction: row; }
    .card-img { width: 120px; aspect-ratio: 1; flex-shrink: 0; }
  }

  /* ─── Feed (YouTube-style) ─── */
  .feed { max-width: 800px; margin: 0 auto; }
  .feed-item { display: flex; gap: 1rem; padding: 0.8rem 0; border-bottom: 1px solid #e0d8cf; text-decoration: none !important; color: inherit; transition: background 0.15s; }
  .feed-item:hover { background: #f0ebe4; border-radius: 6px; padding-left: 0.5rem; margin-left: -0.5rem; padding-right: 0.5rem; margin-right: -0.5rem; }
  .feed-thumb { flex-shrink: 0; width: 320px; height: 180px; background: #0f0f0f; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; position: relative; overflow: hidden; }
  .feed-dur { font-size: 0.75rem; background: rgba(0,0,0,0.85); padding: 0.15rem 0.4rem; border-radius: 3px; position: absolute; bottom: 6px; right: 6px; color: #fff; font-weight: 500; }
  .feed-badges { position: absolute; top: 6px; left: 6px; display: flex; gap: 3px; }
  .feed-badge { font-size: 0.65rem; background: rgba(0,0,0,0.7); padding: 0.1rem 0.35rem; border-radius: 2px; color: #fff; }
  .feed-play { font-size: 2rem; opacity: 0.7; }
  .feed-body { flex: 1; min-width: 0; padding-top: 0.1rem; }
  .feed-title { font-size: 1rem; font-weight: 600; line-height: 1.3; margin-bottom: 0.4rem; color: #1a1a1a; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .feed-channel { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; font-size: 0.85rem; color: #555; }
  .feed-avatar { width: 24px; height: 24px; border-radius: 50%; }
  .feed-meta { font-size: 0.8rem; color: #888; }
  .feed-desc { font-size: 0.8rem; color: #888; margin-top: 0.3rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  @media (max-width: 640px) {
    .feed-thumb { width: 168px; height: 94px; border-radius: 8px; }
    .feed-title { font-size: 0.88rem; }
    .feed-channel { font-size: 0.78rem; }
    .feed-desc { display: none; }
  }
  @media (max-width: 480px) {
    .feed-item { flex-direction: column; gap: 0.5rem; }
    .feed-thumb { width: 100%; height: 0; padding-bottom: 56.25%; }
  }

  /* ─── Graph (LinkedIn-style) ─── */
  .stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
  .stat-card { background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 1.2rem; text-align: center; }
  .stat-number { font-family: 'Playfair Display', Georgia, serif; font-size: 2rem; font-weight: 900; color: #c0392b; }
  .stat-label { font-size: 0.8rem; color: #666; margin-top: 0.2rem; }

  .graph-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1.5rem 0; }
  .panel { background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 1rem; }
  .panel-title { font-family: 'Playfair Display', Georgia, serif; font-size: 1rem; margin-bottom: 0.8rem; border-bottom: 1px solid #e0d8cf; padding-bottom: 0.3rem; }

  .rank-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .rank-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; }
  .rank-name { flex-shrink: 0; width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-bar { height: 6px; background: #c0392b; border-radius: 3px; flex-shrink: 0; min-width: 4px; }
  .rank-count { color: #999; font-size: 0.75rem; flex-shrink: 0; }

  .skill-cloud { line-height: 2; }
  .skill-tag { display: inline-block; padding: 0.15rem 0.5rem; margin: 0.15rem; background: #f0ebe4; border-radius: 3px; color: #2c3e50; }

  .seniority-row { margin: 1rem 0; display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; font-size: 0.85rem; }
  .tag-sen { background: #2c3e50; color: #fff; padding: 0.2rem 0.6rem; border-radius: 3px; font-size: 0.75rem; }

  /* ─── Faceted Filters ─── */
  .facets { background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 0.8rem; margin: 1rem 0; }
  .facet-row { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-bottom: 0.5rem; }
  .facet-select { padding: 0.4rem 0.6rem; border: 1px solid #d4cdc4; border-radius: 6px; font-size: 0.8rem; background: #fff; }
  .facet-clear { padding: 0.4rem 0.7rem; border: 1px solid #d4cdc4; border-radius: 6px; background: #fff; cursor: pointer; font-size: 0.75rem; color: #c0392b; }
  .facet-clear:hover { background: #fef2f2; }
  .facet-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin-bottom: 0.5rem; }
  .facet-tags-label { font-size: 0.75rem; font-weight: 600; color: #666; margin-right: 0.3rem; }
  .facet-tag { padding: 0.2rem 0.5rem; border: 1px solid #d4cdc4; border-radius: 4px; font-size: 0.72rem; cursor: pointer; background: #fff; color: #555; transition: all 0.15s; }
  .facet-tag:hover { border-color: #2c3e50; color: #2c3e50; }
  .facet-tag.active { background: #2c3e50; color: #fff; border-color: #2c3e50; }
  .facet-tag small { opacity: 0.6; margin-left: 2px; }
  .facet-tag-parent { background: #2c3e50; color: #fff; border-color: #2c3e50; font-weight: 500; }
  .facet-tag-parent:hover { background: #34495e; }
  .facet-tag-parent.expanded { background: #1a252f; }
  .facet-tag-parent small { opacity: 0.7; }
  .facet-tag-child { margin-left: 0; }
  .skill-group { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
  .slider-label { font-size: 0.78rem; color: #666; margin-right: 0.5rem; }
  .slider-label span { font-weight: 600; color: #c0392b; }
  .facet-slider { flex: 1; max-width: 300px; accent-color: #c0392b; }
  .active-filters { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin-top: 0.4rem; }
  .filter-chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 4px; font-size: 0.72rem; color: #3730a3; }
  .filter-chip button { background: none; border: none; cursor: pointer; color: #6366f1; font-size: 0.85rem; padding: 0; line-height: 1; }
  .filter-count { font-size: 0.75rem; color: #666; font-weight: 500; margin-left: 0.5rem; }

  .query-section { margin: 1rem 0; }
  .query-btn-export { padding: 0.4rem 0.7rem; border: 1px solid #d4cdc4; border-radius: 6px; background: #fff; cursor: pointer; font-size: 0.78rem; font-weight: 500; }
  .query-btn-export:hover { background: #f0ebe4; }

  @media (max-width: 640px) {
    .facet-row { flex-direction: column; align-items: stretch; }
    .facet-select { width: 100%; }
    .facet-slider { max-width: 100%; }
  }

  .qt { width: 100%; border-collapse: collapse; font-size: 0.82rem; background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; overflow: hidden; }
  .qt thead { position: sticky; top: 0; z-index: 2; }
  .qt th { background: #2c3e50; color: #fff; text-align: left; padding: 0.55rem 0.7rem; font-weight: 500; font-size: 0.78rem; white-space: nowrap; user-select: none; }
  .qt th:hover { background: #34495e; }
  .sort-arrow { font-size: 0.65rem; margin-left: 3px; opacity: 0.6; }
  .qt td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #f0ebe4; vertical-align: middle; }
  .qt tr:hover { background: #faf9f7; }
  .qt tr:nth-child(even) { background: #fcfbf9; }
  .qt tr:nth-child(even):hover { background: #f5f0ea; }

  .cell-img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; vertical-align: middle; }
  .cell-link { color: #c0392b; text-decoration: none; font-weight: 500; font-size: 0.78rem; }
  .cell-link:hover { text-decoration: underline; }
  .cell-tag { display: inline-block; background: #f0ebe4; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.72rem; margin: 1px; color: #555; }
  .cell-empty { color: #ccc; }

  .query-pagination { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0; font-size: 0.8rem; color: #666; }
  .pag-info { font-weight: 500; }
  .pag-controls { display: flex; gap: 0.4rem; align-items: center; }
  .pag-btn { padding: 0.35rem 0.7rem; border: 1px solid #d4cdc4; border-radius: 4px; background: #fff; cursor: pointer; font-size: 0.78rem; }
  .pag-btn:hover:not(:disabled) { background: #f0ebe4; }
  .pag-btn:disabled { opacity: 0.4; cursor: default; }
  .pag-controls select { padding: 0.3rem 0.4rem; border: 1px solid #d4cdc4; border-radius: 4px; font-size: 0.78rem; }

  .query-table { overflow-x: auto; border-radius: 8px; max-height: 70vh; overflow-y: auto; }

  @media (max-width: 768px) {
    .query-input-row { flex-wrap: wrap; }
    .query-select { width: 100%; }
    .query-input { width: 100%; }
    .qt { font-size: 0.75rem; }
    .qt th, .qt td { padding: 0.35rem 0.5rem; }
    .cell-img { width: 24px; height: 24px; }
    .query-pagination { flex-direction: column; gap: 0.4rem; }
  }

  @media (max-width: 480px) {
    /* Card layout on phone */
    .qt thead { display: none; }
    .qt, .qt tbody, .qt tr, .qt td { display: block; }
    .qt tr { background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 0.6rem; margin-bottom: 0.5rem; }
    .qt td { padding: 0.2rem 0; border: none; }
    .qt td::before { content: attr(data-label); font-weight: 600; color: #2c3e50; display: block; font-size: 0.7rem; margin-bottom: 0.1rem; }
  }

  .profile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.8rem; margin: 1rem 0; }
  .profile-card { display: flex; align-items: center; gap: 0.7rem; background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 0.7rem; text-decoration: none !important; color: inherit; transition: box-shadow 0.15s; }
  .profile-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .profile-photo { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .profile-initials { display: flex; align-items: center; justify-content: center; background: #2c3e50; color: #fff; font-size: 0.85rem; font-weight: 600; }
  .profile-info { min-width: 0; }
  .profile-name { font-weight: 600; font-size: 0.88rem; color: #2c3e50; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profile-title { font-size: 0.78rem; color: #666; margin-top: 0.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profile-company { font-size: 0.73rem; color: #c0392b; margin-top: 0.1rem; }

  @media (max-width: 640px) {
    .graph-panels { grid-template-columns: 1fr; }
    .stat-cards { grid-template-columns: repeat(3, 1fr); }
    .stat-number { font-size: 1.5rem; }
    .profile-grid { grid-template-columns: 1fr 1fr; }
    .graph-svg { height: 350px; }
    .rank-name { width: 100px; }
  }
`;

// CLI: node lib/md2html.js input.md output.html
if (process.argv[1]?.endsWith('md2html.js')) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (args.length >= 2) {
    md2html(args[0], args[1]);
  } else if (args.length === 1) {
    md2html(args[0], args[0].replace('.md', '.html'));
  }
}
