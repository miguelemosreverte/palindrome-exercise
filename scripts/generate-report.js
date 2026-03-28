#!/usr/bin/env node
/**
 * Generate HTML benchmark report from SQLite data.
 * Usage: node scripts/generate-report.js <collection> [output.html]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../lib/db');

const collection = process.argv[2] || 'hr-scala-latam';
const outFile = process.argv[3] || `tests/benchmarks/report-${collection}.html`;

console.log(`Generating report for: ${collection}`);

// 1. Get all data
const records = db.getData(collection);
const benchmarks = db.getBenchmarks(collection, 50).concat(db.getBenchmarks('hr-real', 50));

// Parse records — handle both JSON and raw text
const tables = [];
const rawTexts = [];
let totalRows = 0;
const allUrls = new Set();

for (const r of records) {
  const name = r.collection.split('/').pop().replace(/_/g, ' ');
  let text = r.data;
  try { const d = JSON.parse(r.data); text = d.text || r.data; if (d.headers && d.rows) { tables.push({ name, headers: d.headers, rows: d.rows }); totalRows += d.rows.length; continue; } } catch (e) {}

  // Parse CSV blocks from text
  const csvMatch = text.match(/```csv\s*\n([\s\S]*?)```/);
  if (csvMatch) {
    const lines = csvMatch[1].trim().split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(l => {
        const cells = []; let cur = '', inQ = false;
        for (const ch of l) { if (ch === '"') { inQ = !inQ; continue; } if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; } cur += ch; }
        cells.push(cur.trim()); return cells;
      });
      tables.push({ name, headers, rows });
      totalRows += rows.length;
    }
  }
  // Extract URLs
  const urls = text.match(/https?:\/\/[^\s"',\]]+/g);
  if (urls) urls.forEach(u => allUrls.add(u));
  rawTexts.push({ name, text: text.substring(0, 2000), date: r.created_at });
}

// 2. Build history from benchmarks
let cumulative = 0;
const history = benchmarks.reverse().map(b => {
  const r = JSON.parse(b.results || '{}');
  cumulative += (r.totalRows || 0);
  return { date: b.created_at, time: b.total_time_ms / 1000, rows: r.totalRows || 0, cumulative, engine: r.engine || '?' };
});

// 3. Generate analysis with Claude
let analysis = '';
try {
  let prompt = 'You are a senior analyst. Write a concise Wall Street Journal style brief. Numbers first.\n\n';
  for (const t of tables) {
    prompt += `TABLE: ${t.name}\n${t.headers.join(' | ')}\n`;
    for (const r of t.rows.slice(0, 15)) prompt += r.join(' | ') + '\n';
    if (t.rows.length > 15) prompt += `... (${t.rows.length} total rows)\n`;
    prompt += '\n';
  }
  prompt += '\nWrite: 1. Key Findings (specific numbers) 2. Market Insights 3. Data Quality. Concise markdown.';
  analysis = execSync('claude --model haiku --output-format text --dangerously-skip-permissions --tools "" -p -',
    { input: prompt, encoding: 'utf8', timeout: 60000 });
} catch (e) { analysis = 'Analysis generation failed.'; }

// 4. Convert analysis to HTML
let analysisHtml = analysis
  .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3 text-gray-800 border-b border-gray-200 pb-2">$1</h2>')
  .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2 text-gray-700">$1</h3>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/^- (.+)$/gm, '<li class="ml-4 mb-1 text-gray-700">$1</li>')
  .replace(/\n\n/g, '<br><br>');

// 5. Build HTML
const dataSize = Buffer.byteLength(JSON.stringify(records.map(r => r.data)), 'utf8');

// Table HTML
let tablesHtml = '';
for (const t of tables) {
  const th = t.headers.map(h => `<th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:text-indigo-600" onclick="sortTbl(this)">${h} ↕</th>`).join('');
  const tr = t.rows.map(r => `<tr class="border-t hover:bg-blue-50">${r.map(c => `<td class="px-3 py-2 text-sm text-gray-700">${String(c).replace(/</g,'&lt;')}</td>`).join('')}</tr>`).join('');
  tablesHtml += `<div class="bg-white rounded-xl shadow-sm border p-6 mb-4">
    <h3 class="text-base font-bold text-gray-800 mb-3">${t.name} <span class="text-xs text-gray-400 font-normal">(${t.rows.length} rows)</span></h3>
    <div class="overflow-x-auto max-h-72 overflow-y-auto border rounded-lg">
      <table class="min-w-full text-sm"><thead class="bg-gray-50 sticky top-0"><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
    </div></div>`;
}

// Raw text HTML
let rawHtml = '';
for (const r of rawTexts) {
  rawHtml += `<div class="bg-white rounded-xl shadow-sm border p-6 mb-4">
    <div class="flex justify-between mb-2"><h3 class="text-base font-bold text-gray-800">${r.name}</h3><span class="text-xs text-gray-400">${r.date || ''}</span></div>
    <div class="overflow-x-auto max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-4">
      <pre class="text-xs text-gray-600 whitespace-pre-wrap font-mono">${r.text.replace(/</g, '&lt;')}</pre>
    </div></div>`;
}

// History chart data
const historyJson = JSON.stringify(history);

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bridge Report: ${collection}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif}</style>
</head><body class="bg-gray-50 min-h-screen">
<div class="max-w-5xl mx-auto px-6 py-12">
  <div class="mb-10">
    <div class="flex items-center gap-3 mb-2">
      <div class="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">B</div>
      <span class="text-sm font-semibold text-indigo-600 uppercase tracking-wider">Task Report</span>
    </div>
    <h1 class="text-3xl font-extrabold text-gray-900 mb-1">${collection}</h1>
    <p class="text-gray-500 text-sm">${new Date().toISOString().slice(0, 19)} · ${totalRows} rows · ${allUrls.size} URLs · ${Math.round(dataSize / 1024)}KB</p>
  </div>

  <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Runs</div><div class="text-2xl font-extrabold mt-1">${history.length}</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Total Rows</div><div class="text-2xl font-extrabold mt-1">${totalRows}</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Source URLs</div><div class="text-2xl font-extrabold mt-1">${allUrls.size}</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Data Size</div><div class="text-2xl font-extrabold mt-1">${Math.round(dataSize / 1024)}KB</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Tables</div><div class="text-2xl font-extrabold mt-1">${tables.length}</div></div>
  </div>

  ${history.length > 1 ? `
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
    <div class="bg-white rounded-xl shadow-sm border p-6">
      <h3 class="text-base font-bold text-gray-800 mb-3">Data Growth Over Time</h3>
      <canvas id="growthChart" height="200"></canvas>
    </div>
    <div class="bg-white rounded-xl shadow-sm border p-6">
      <h3 class="text-base font-bold text-gray-800 mb-3">Time Per Run</h3>
      <canvas id="timeChart" height="200"></canvas>
    </div>
  </div>` : ''}

  <div class="bg-white rounded-xl shadow-sm border p-8 mb-8">
    <h2 class="text-xl font-extrabold text-gray-900 mb-4">Analysis</h2>
    <div class="text-gray-700 leading-relaxed">${analysisHtml}</div>
  </div>

  <h2 class="text-xl font-extrabold text-gray-900 mb-4">Collected Data</h2>
  <p class="text-sm text-gray-500 mb-4">Every row was scraped from a real website. Click column headers to sort.</p>
  ${tablesHtml}

  ${rawTexts.length > 0 ? `
  <h2 class="text-xl font-extrabold text-gray-900 mb-4 mt-10">Raw Responses</h2>
  ${rawHtml}` : ''}

  <div class="text-center text-xs text-gray-400 mt-12 mb-6">
    Generated by Bridge · SQLite: ${db.DB_PATH}
  </div>
</div>
<script>
document.addEventListener('DOMContentLoaded',function(){
  var hist = ${historyJson};
  if (hist.length > 1) {
    new Chart(document.getElementById('growthChart'),{type:'line',data:{labels:hist.map(function(h,i){return '#'+(i+1)}),datasets:[{label:'Cumulative Rows',data:hist.map(function(h){return h.cumulative}),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.1)',fill:true,tension:0.3,pointRadius:6}]},options:{responsive:true,scales:{y:{beginAtZero:true}}}});
    new Chart(document.getElementById('timeChart'),{type:'bar',data:{labels:hist.map(function(h,i){return '#'+(i+1)}),datasets:[{label:'Time (s)',data:hist.map(function(h){return h.time}),backgroundColor:'#f59e0b',borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  }
});
window.sortTbl=function(th){var t=th.closest('table'),i=Array.from(th.parentNode.children).indexOf(th),rows=Array.from(t.tBodies[0].rows),a=th.dataset.a!=='1';th.dataset.a=a?'1':'0';rows.sort(function(x,y){var av=x.cells[i].textContent,bv=y.cells[i].textContent,an=parseFloat(av.replace(/[^\\d.-]/g,'')),bn=parseFloat(bv.replace(/[^\\d.-]/g,''));if(!isNaN(an)&&!isNaN(bn))return a?an-bn:bn-an;return a?av.localeCompare(bv):bv.localeCompare(av)});rows.forEach(function(r){t.tBodies[0].appendChild(r)})};
</script>
</body></html>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`Report: ${outFile} (${html.length} bytes, ${tables.length} tables, ${totalRows} rows)`);
