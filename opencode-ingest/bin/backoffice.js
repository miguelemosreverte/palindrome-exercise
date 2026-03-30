#!/usr/bin/env node
/**
 * Back Office — Observability Dashboard
 * Local web server that aggregates and visualizes pipeline metrics.
 * Reuses WSJ theme from md2html.js and chart components from charts.js.
 *
 * Usage: node bin/backoffice.js [--port 3457]
 */
import http from 'http';
import { collectAll, PRICING } from './metrics.js';
import { horizontalBar, chartRow, CHARTS_CSS } from './charts.js';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3457');

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtCost(n) { return '$' + n.toFixed(4); }

function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago';
  if (ms < 86_400_000) return Math.round(ms / 3_600_000) + 'h ago';
  return Math.round(ms / 86_400_000) + 'd ago';
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function statusBadge(s) {
  const colors = { completed: '#27ae60', idle: '#95a5a6', running: '#f39c12', error: '#e74c3c' };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.7rem;color:#fff;background:${colors[s]||'#95a5a6'}">${s}</span>`;
}

function buildDashboard(data) {
  const g = data.global;

  // --- Cards ---
  const cards = [
    { label: 'Tasks', value: g.tasks, icon: '📋' },
    { label: 'Records', value: fmt(g.records), icon: '💾' },
    { label: 'Tokens', value: fmt(g.totalTokens), icon: '🔤' },
    { label: 'Est. Cost', value: fmtCost(g.estimatedCost), icon: '💰' },
  ];
  const cardsHtml = cards.map(c => `
    <div class="stat-card">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>
  `).join('');

  // --- Pipeline time breakdown (stacked bar) ---
  const totalStageMs = Object.values(g.stageTimings).reduce((a, b) => a + b, 0) || 1;
  const stageColors = { htmlToText: '#3498db', extract: '#e74c3c', normalize: '#f39c12', postProcess: '#27ae60' };
  const stageNames = { htmlToText: 'HTML→Text', extract: 'Extract', normalize: 'Normalize', postProcess: 'PostProcess' };
  const stackedSegments = Object.entries(g.stageTimings).map(([k, v]) => {
    const pct = (v / totalStageMs * 100).toFixed(1);
    return `<div class="stack-seg" style="width:${pct}%;background:${stageColors[k]}" title="${stageNames[k]}: ${pct}% (${(v/1000).toFixed(1)}s)"></div>`;
  }).join('');
  const stackedLegend = Object.entries(g.stageTimings).map(([k, v]) => {
    const pct = (v / totalStageMs * 100).toFixed(1);
    return `<span class="legend-item"><span class="legend-dot" style="background:${stageColors[k]}"></span>${stageNames[k]}: ${pct}%</span>`;
  }).join('');

  // --- Token usage by model (horizontal bars) ---
  const modelBars = Object.entries(data.models).map(([model, s]) => ({
    label: model,
    value: s.tokensIn + s.tokensOut,
    color: PRICING[model] ? '#2c3e50' : '#27ae60',
  })).sort((a, b) => b.value - a.value);
  const modelChart = horizontalBar('Token Usage by Model', modelBars, { maxBars: 10 });

  // --- Model cost table ---
  const modelRows = Object.entries(data.models).map(([model, s]) => {
    const total = s.tokensIn + s.tokensOut;
    return `<tr>
      <td>${esc(model)}</td>
      <td>${fmt(s.tokensIn)}</td>
      <td>${fmt(s.tokensOut)}</td>
      <td>${fmt(total)}</td>
      <td>${fmtCost(s.cost)}</td>
    </tr>`;
  }).join('');

  // --- Per-task table ---
  const taskRows = data.tasks.map(t => `<tr>
    <td><strong>${esc(t.name)}</strong></td>
    <td>${t.records}</td>
    <td>${t.iterations}</td>
    <td>${timeAgo(t.lastRun)}</td>
    <td>${statusBadge(t.status)}</td>
    <td>${esc(t.model || '—')}</td>
  </tr>`).join('');

  // --- Benchmark section ---
  let benchmarkHtml = '';
  if (Object.keys(data.benchmark).length) {
    const benchBars = Object.entries(data.benchmark).map(([model, b]) => ({
      label: `${model} (${b.queries}q, ${b.issues} issues)`,
      value: Math.round(b.totalMs / b.queries),
    })).sort((a, b) => a.value - b.value);
    benchmarkHtml = horizontalBar('NL Benchmark — Avg Latency (ms)', benchBars, { maxBars: 10, barColor: '#8e44ad' });
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Ingest — Back Office</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #f8f5f0; color: #1a1a1a; line-height: 1.6; }
    .page { max-width: 1100px; margin: 0 auto; padding: 1rem; }
    .masthead { text-align: center; padding: 1.5rem 0 1rem; }
    .masthead-rule { border-top: 3px double #1a1a1a; margin: 0.3rem 0; }
    .masthead-title { font-family: 'Playfair Display', Georgia, serif; font-size: 0.85rem; letter-spacing: 0.3em; text-transform: uppercase; color: #666; }
    .masthead-sub { font-size: 0.75rem; color: #999; margin-top: 0.2rem; }
    h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 2.2rem; font-weight: 900; line-height: 1.15; margin-bottom: 0.3rem; border-bottom: 2px solid #1a1a1a; padding-bottom: 0.5rem; }
    h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.3rem; font-weight: 700; margin: 2rem 0 0.8rem; padding-bottom: 0.3rem; border-bottom: 1px solid #d4cdc4; color: #2c3e50; }

    /* Stat cards */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; margin: 1rem 0; }
    .stat-card { background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 1rem; text-align: center; }
    .stat-icon { font-size: 1.5rem; margin-bottom: 0.3rem; }
    .stat-value { font-family: 'Playfair Display', Georgia, serif; font-size: 1.8rem; font-weight: 900; color: #2c3e50; }
    .stat-label { font-size: 0.75rem; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }

    /* Stacked bar */
    .stack-bar { display: flex; height: 28px; border-radius: 4px; overflow: hidden; margin: 0.5rem 0; }
    .stack-seg { transition: width 0.4s ease; }
    .stack-seg:hover { opacity: 0.8; }
    .legend { display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.75rem; color: #666; margin-top: 0.4rem; }
    .legend-item { display: flex; align-items: center; gap: 0.3rem; }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.82rem; }
    th { background: #2c3e50; color: #fff; text-align: left; padding: 0.5rem 0.6rem; font-weight: 500; }
    td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e0d8cf; }
    tr:hover { background: #f0ebe4; }
    .table-wrap { border: 1px solid #e0d8cf; border-radius: 6px; overflow: auto; margin: 0.5rem 0; }

    /* Refresh indicator */
    .refresh-bar { display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: #999; margin-top: 1rem; padding-top: 0.5rem; border-top: 1px solid #e0d8cf; }
    .refresh-dot { width: 6px; height: 6px; border-radius: 50%; background: #27ae60; display: inline-block; margin-right: 4px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

    ${CHARTS_CSS}

    @media (max-width: 640px) {
      .page { padding: 0.5rem; }
      h1 { font-size: 1.5rem; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="masthead">
      <div class="masthead-rule"></div>
      <div class="masthead-title">OPENCODE INGEST</div>
      <div class="masthead-sub">Back Office — Observability Dashboard</div>
      <div class="masthead-rule"></div>
    </div>

    <h1>Pipeline Overview</h1>

    <div class="stats-grid">${cardsHtml}</div>

    <h2>Pipeline Time Breakdown</h2>
    <div class="stack-bar">${stackedSegments}</div>
    <div class="legend">${stackedLegend}</div>

    <h2>Token Usage &amp; Cost</h2>
    ${chartRow([modelChart])}
    <div class="table-wrap">
      <table>
        <tr><th>Model</th><th>Input Tokens</th><th>Output Tokens</th><th>Total</th><th>Cost</th></tr>
        ${modelRows || '<tr><td colspan="5" style="text-align:center;color:#999">No model data yet</td></tr>'}
      </table>
    </div>

    <h2>Tasks</h2>
    <div class="table-wrap">
      <table>
        <tr><th>Task</th><th>Records</th><th>Iterations</th><th>Last Run</th><th>Status</th><th>Model</th></tr>
        ${taskRows}
      </table>
    </div>

    ${benchmarkHtml ? `<h2>NL Benchmark</h2>${chartRow([benchmarkHtml])}` : ''}

    <div class="refresh-bar">
      <span><span class="refresh-dot"></span>Auto-refreshing every 10s</span>
      <span>Last updated: ${new Date().toLocaleTimeString()}</span>
    </div>
  </div>

  <script>
    setTimeout(() => location.reload(), 10000);
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/metrics') {
      const data = await collectAll();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // Dashboard HTML
    const data = await collectAll();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildDashboard(data));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Back Office dashboard: http://localhost:${PORT}`);
  console.log(`Metrics API:           http://localhost:${PORT}/api/metrics`);
  console.log('Press Ctrl+C to stop.');
});
