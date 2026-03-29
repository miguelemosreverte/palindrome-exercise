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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  ${layout === 'graph' ? '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>' : ''}
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
      ${html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')}
    </article>
  </div>
  ${dataRenderer}
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
  if (layout === 'graph') return buildGraph(records, columns);
  return ''; // table is already in markdown
}

function buildGrid(records, columns) {
  const titleCol = columns.find(c => /title|name/i.test(c)) || columns[0];
  const priceCol = columns.find(c => /price|precio/i.test(c));
  const locCol = columns.find(c => /location|ubicacion/i.test(c));
  const sellerCol = columns.find(c => /seller|vendedor/i.test(c));
  const shippingCol = columns.find(c => /shipping|envio/i.test(c));
  const urlCol = columns.find(c => /url|link|href/i.test(c));
  const conditionCol = columns.find(c => /condition|condicion/i.test(c));

  const cards = records.map(r => {
    const title = r[titleCol] || '';
    const price = r[priceCol] || '';
    const loc = r[locCol] || '';
    const seller = r[sellerCol] || '';
    const shipping = r[shippingCol] || '';
    const url = r[urlCol] || '#';
    const cond = r[conditionCol] || '';
    return `<a href="${escHtml(url)}" class="card" target="_blank">
      <div class="card-price">${escHtml(price)}</div>
      <h3 class="card-title">${escHtml(title.substring(0, 80))}</h3>
      <div class="card-meta">
        ${loc ? `<span class="tag">${escHtml(loc)}</span>` : ''}
        ${shipping ? `<span class="tag tag-ship">${escHtml(shipping)}</span>` : ''}
        ${cond ? `<span class="tag tag-cond">${escHtml(cond)}</span>` : ''}
      </div>
      ${seller ? `<div class="card-seller">${escHtml(seller)}</div>` : ''}
    </a>`;
  }).join('\n');

  return `<section class="layout-section"><h2 class="section-title">Listings</h2><div class="grid-cards">${cards}</div></section>`;
}

function buildFeed(records, columns) {
  const titleCol = columns.find(c => /title|name/i.test(c)) || columns[0];
  const channelCol = columns.find(c => /channel|author|creator/i.test(c));
  const viewsCol = columns.find(c => /views|vistas/i.test(c));
  const pubCol = columns.find(c => /published|date|time|ago/i.test(c));
  const durCol = columns.find(c => /duration|duracion|length/i.test(c));
  const urlCol = columns.find(c => /url|link|href/i.test(c));
  const descCol = columns.find(c => /description|desc|snippet/i.test(c));

  const items = records.map(r => {
    const title = r[titleCol] || '';
    const channel = r[channelCol] || '';
    const views = r[viewsCol] || '';
    const pub = r[pubCol] || '';
    const dur = r[durCol] || '';
    const url = r[urlCol] || '#';
    const desc = r[descCol] || '';
    const meta = [channel, views, pub].filter(Boolean).join(' · ');

    return `<a href="${escHtml(url)}" class="feed-item" target="_blank">
      <div class="feed-thumb">${dur ? `<span class="feed-dur">${escHtml(dur)}</span>` : '<span class="feed-play">▶</span>'}</div>
      <div class="feed-body">
        <h3 class="feed-title">${escHtml(title)}</h3>
        <div class="feed-meta">${escHtml(meta)}</div>
        ${desc ? `<p class="feed-desc">${escHtml(desc.substring(0, 150))}</p>` : ''}
      </div>
    </a>`;
  }).join('\n');

  return `<section class="layout-section"><h2 class="section-title">Feed</h2><div class="feed">${items}</div></section>`;
}

function buildGraph(records, columns) {
  const nameCol = columns.find(c => /^name$/i.test(c)) || columns[0];
  const companyCol = columns.find(c => /company|org/i.test(c));
  const titleCol = columns.find(c => /title|role|headline/i.test(c));
  const seniorityCol = columns.find(c => /seniority|level/i.test(c));
  const skillsCol = columns.find(c => /skills|tech/i.test(c));
  const urlCol = columns.find(c => /url|profileUrl|link/i.test(c));

  // Build stats
  const companies = {};
  const seniorities = {};
  const allSkills = {};
  records.forEach(r => {
    const co = r[companyCol] || 'Unknown';
    companies[co] = (companies[co] || 0) + 1;
    const sen = r[seniorityCol] || 'senior';
    seniorities[sen] = (seniorities[sen] || 0) + 1;
    (r[skillsCol] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
      allSkills[s] = (allSkills[s] || 0) + 1;
    });
  });

  const topCompanies = Object.entries(companies).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topSkills = Object.entries(allSkills).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // Stat cards HTML
  const statCards = `<div class="stat-cards">
    <div class="stat-card">
      <div class="stat-number">${records.length}</div>
      <div class="stat-label">Professionals</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${Object.keys(companies).length}</div>
      <div class="stat-label">Companies</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${Object.keys(allSkills).length}</div>
      <div class="stat-label">Unique Skills</div>
    </div>
  </div>`;

  // Top companies list
  const companyList = topCompanies.map(([name, count]) =>
    `<div class="rank-item"><span class="rank-name">${escHtml(name)}</span><span class="rank-bar" style="width:${Math.round(count / topCompanies[0][1] * 100)}%"></span><span class="rank-count">${count}</span></div>`
  ).join('');

  // Skills cloud
  const maxSkill = topSkills[0]?.[1] || 1;
  const skillCloud = topSkills.map(([name, count]) => {
    const size = 0.7 + (count / maxSkill) * 1.0;
    const opacity = 0.5 + (count / maxSkill) * 0.5;
    return `<span class="skill-tag" style="font-size:${size}rem;opacity:${opacity}">${escHtml(name)}</span>`;
  }).join(' ');

  // Seniority breakdown
  const senBreakdown = Object.entries(seniorities).sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `<span class="tag tag-sen">${escHtml(name)} (${count})</span>`).join(' ');

  // Profile cards
  const profileCards = records.slice(0, 50).map(r => {
    const name = r[nameCol] || '';
    const title = r[titleCol] || '';
    const company = r[companyCol] || '';
    const url = r[urlCol] || '#';
    return `<a href="${escHtml(url)}" class="profile-card" target="_blank">
      <div class="profile-name">${escHtml(name)}</div>
      <div class="profile-title">${escHtml(title.substring(0, 60))}</div>
      ${company ? `<div class="profile-company">${escHtml(company.substring(0, 40))}</div>` : ''}
    </a>`;
  }).join('\n');

  return `<section class="layout-section">
    ${statCards}
    <div class="graph-panels">
      <div class="panel">
        <h3 class="panel-title">Top Companies</h3>
        <div class="rank-list">${companyList}</div>
      </div>
      <div class="panel">
        <h3 class="panel-title">Skills</h3>
        <div class="skill-cloud">${skillCloud}</div>
      </div>
    </div>
    <div class="seniority-row"><strong>Seniority:</strong> ${senBreakdown}</div>
    <div id="network-graph"></div>
    <h2 class="section-title">Profiles</h2>
    <div class="profile-grid">${profileCards}</div>
  </section>`;
}

function buildDataScript(layout, data) {
  if (layout !== 'graph' || !data?.records?.length) return '';

  // D3.js force graph: people → companies
  const records = data.records;
  const companyCol = data.columns?.find(c => /company|org/i.test(c));
  const nameCol = data.columns?.find(c => /^name$/i.test(c)) || data.columns?.[0];
  if (!companyCol) return '';

  const nodes = [];
  const links = [];
  const nodeSet = new Set();

  records.forEach(r => {
    const name = r[nameCol];
    const company = r[companyCol];
    if (!name) return;
    if (!nodeSet.has(name)) { nodeSet.add(name); nodes.push({ id: name, type: 'person' }); }
    if (company && !nodeSet.has(company)) { nodeSet.add(company); nodes.push({ id: company, type: 'company' }); }
    if (company) links.push({ source: name, target: company });
  });

  return `
(function() {
  const container = document.getElementById('network-graph');
  if (!container || typeof d3 === 'undefined') return;
  const width = container.offsetWidth || 800;
  const height = 500;
  const nodes = ${JSON.stringify(nodes)};
  const links = ${JSON.stringify(links)};

  const svg = d3.select(container).append('svg').attr('viewBox', [0, 0, width, height]).attr('class', 'graph-svg');
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(20));

  const link = svg.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', '#ccc').attr('stroke-width', 1);

  const node = svg.append('g').selectAll('circle').data(nodes).join('circle')
    .attr('r', d => d.type === 'company' ? 10 : 5)
    .attr('fill', d => d.type === 'company' ? '#c0392b' : '#2c3e50')
    .call(d3.drag().on('start', dragstart).on('drag', dragged).on('end', dragend));

  node.append('title').text(d => d.id);

  const label = svg.append('g').selectAll('text').data(nodes.filter(d => d.type === 'company')).join('text')
    .text(d => d.id.substring(0, 20)).attr('font-size', 9).attr('fill', '#666').attr('dx', 14);

  simulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('cx', d => d.x).attr('cy', d => d.y);
    label.attr('x', d => d.x).attr('y', d => d.y);
  });

  function dragstart(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragend(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
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
  .grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .card { display: block; background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 1rem; transition: box-shadow 0.2s, transform 0.15s; text-decoration: none !important; color: inherit; }
  .card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); transform: translateY(-2px); }
  .card-price { font-family: 'Playfair Display', Georgia, serif; font-size: 1.4rem; font-weight: 700; color: #2c3e50; margin-bottom: 0.3rem; }
  .card-title { font-size: 0.85rem; font-weight: 500; color: #333; line-height: 1.35; margin-bottom: 0.5rem; min-height: 2.4rem; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.4rem; }
  .tag { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 3px; background: #f0ebe4; color: #666; }
  .tag-ship { background: #d4edda; color: #155724; }
  .tag-cond { background: #fff3cd; color: #856404; }
  .card-seller { font-size: 0.75rem; color: #999; }

  @media (max-width: 640px) {
    .grid-cards { grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .card { padding: 0.7rem; }
    .card-price { font-size: 1.1rem; }
    .card-title { font-size: 0.78rem; min-height: auto; }
  }
  @media (max-width: 380px) {
    .grid-cards { grid-template-columns: 1fr; }
  }

  /* ─── Feed (YouTube-style) ─── */
  .feed { max-width: 720px; margin: 0 auto; }
  .feed-item { display: flex; gap: 1rem; padding: 0.8rem 0; border-bottom: 1px solid #e0d8cf; text-decoration: none !important; color: inherit; transition: background 0.15s; }
  .feed-item:hover { background: #f0ebe4; border-radius: 6px; padding-left: 0.5rem; margin-left: -0.5rem; padding-right: 0.5rem; margin-right: -0.5rem; }
  .feed-thumb { flex-shrink: 0; width: 160px; height: 90px; background: #1a1a1a; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; position: relative; }
  .feed-dur { font-size: 0.75rem; background: rgba(0,0,0,0.8); padding: 0.15rem 0.4rem; border-radius: 3px; position: absolute; bottom: 4px; right: 4px; }
  .feed-play { font-size: 1.5rem; opacity: 0.7; }
  .feed-body { flex: 1; min-width: 0; }
  .feed-title { font-size: 0.95rem; font-weight: 600; line-height: 1.3; margin-bottom: 0.3rem; }
  .feed-meta { font-size: 0.8rem; color: #666; }
  .feed-desc { font-size: 0.8rem; color: #888; margin-top: 0.3rem; }

  @media (max-width: 640px) {
    .feed-thumb { width: 120px; height: 68px; }
    .feed-title { font-size: 0.85rem; }
  }
  @media (max-width: 380px) {
    .feed-item { flex-direction: column; }
    .feed-thumb { width: 100%; height: 180px; }
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

  #network-graph { margin: 1.5rem 0; }
  .graph-svg { width: 100%; height: 500px; background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; }

  .profile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.8rem; margin: 1rem 0; }
  .profile-card { display: block; background: #fff; border: 1px solid #e0d8cf; border-radius: 6px; padding: 0.8rem; text-decoration: none !important; color: inherit; transition: box-shadow 0.15s; }
  .profile-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .profile-name { font-weight: 600; font-size: 0.9rem; color: #2c3e50; }
  .profile-title { font-size: 0.8rem; color: #666; margin-top: 0.15rem; }
  .profile-company { font-size: 0.75rem; color: #c0392b; margin-top: 0.15rem; }

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
