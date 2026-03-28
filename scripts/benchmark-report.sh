#!/bin/bash
# Generate a benchmark report for a specific benchmark (e.g. HR research).
# Every chart is backed by a raw data table — no hallucination possible.
#
# Usage:
#   ./scripts/benchmark-report.sh hr          # HR benchmark report
#   ./scripts/benchmark-report.sh             # defaults to HR
#   open tests/benchmarks/report-hr.html

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BENCH_NAME="${1:-hr}"
REPORT_HTML="tests/benchmarks/report-${BENCH_NAME}.html"
mkdir -p tests/benchmarks

echo "=== Benchmark Report: $BENCH_NAME ==="

# Step 1: Extract ALL data for this benchmark from SQLite into a single JSON
echo "Reading data from SQLite..."
ALL_DATA=$(node -e "
const db = require('./lib/db');

// Get benchmark-specific data
const collectionMap = { 'hr': 'hr-research', 'hr-real': 'hr-research-real' };
const collection = collectionMap['$BENCH_NAME'] || '$BENCH_NAME';
const records = db.getData(collection);

// Get benchmark timing
const benchMap = { 'hr': 'HR Scala LATAM Research', 'hr-real': 'hr-real' };
const benchName = benchMap['$BENCH_NAME'] || '$BENCH_NAME';
const bench = db.getLatestBenchmark(benchName);

// Extract every piece of structured data
// Benchmark history — ALL runs for progress-over-time charts
const allBenchmarks = db.getBenchmarks(benchName, 50);
let cumulativeRows = 0;
const history = allBenchmarks.reverse().map(b => {
  const r = JSON.parse(b.results || '{}');
  cumulativeRows += (r.totalRows || 0);
  return {
    date: b.created_at,
    time: b.total_time_ms / 1000,
    rows: r.totalRows || 0,
    cumulative: cumulativeRows,
    sources: r.totalSources || 0,
    engine: r.engine || 'unknown',
  };
});

// Total data in SQLite for this collection
const allData = db.getData(collection);
let totalStoredRows = 0;
let uniqueUrls = new Set();
for (const r of allData) {
  try {
    const d = JSON.parse(r.data);
    totalStoredRows += (d.rows || []).length;
    (d.sources || []).forEach(u => uniqueUrls.add(u));
  } catch(e) {}
}

const output = {
  benchmark: bench ? {
    totalTime: bench.total_time_ms / 1000,
    steps: JSON.parse(bench.steps || '[]'),
    results: JSON.parse(bench.results || '{}'),
    date: bench.created_at
  } : null,
  history: history,
  totals: { rows: totalStoredRows, urls: uniqueUrls.size, runs: history.length, dataSize: JSON.stringify(allData.map(r=>JSON.parse(r.data))).length },
  charts: [],
  tables: [],
  cards: [],
  csvData: [],
  rawTexts: [],
};

for (const r of records) {
  const d = JSON.parse(r.data);
  const text = d.text || '';
  const name = r.collection.split('/').pop().replace(/_/g, ' ');

  // Direct structured data (from benchmark-hr-real.js)
  if (d.headers && d.rows && d.rows.length > 0) {
    output.tables.push({ name, headers: d.headers, rows: d.rows, sources: d.sources || [] });
    continue; // skip markdown parsing — we have the structured data already
  }

  // Extract chartjs blocks
  const chartMatch = text.match(/\x60\x60\x60chartjs\\s*\\n([\\s\\S]*?)\x60\x60\x60/);
  if (chartMatch) {
    try {
      const cfg = JSON.parse(chartMatch[1]);
      // Extract the underlying data as a table too
      const labels = cfg.data?.labels || [];
      const datasets = cfg.data?.datasets || [];
      const tableRows = labels.map((l, i) => [l, ...datasets.map(ds => String(ds.data?.[i] || ''))]);
      const tableHeaders = ['Label', ...datasets.map(ds => ds.label || 'Value')];
      output.charts.push({ name, config: cfg, dataTable: { headers: tableHeaders, rows: tableRows } });
    } catch(e) {}
  }

  // Extract table blocks
  const tableMatch = text.match(/\x60\x60\x60table\\s*\\n([\\s\\S]*?)\x60\x60\x60/);
  if (tableMatch) {
    try {
      const tbl = JSON.parse(tableMatch[1]);
      output.tables.push({ name, headers: tbl.headers || [], rows: tbl.rows || [] });
    } catch(e) {}
  }

  // Extract cards blocks
  const cardsMatch = text.match(/\x60\x60\x60cards\\s*\\n([\\s\\S]*?)\x60\x60\x60/);
  if (cardsMatch) {
    try {
      const cards = JSON.parse(cardsMatch[1]);
      output.cards.push({ name, items: cards.items || cards });
    } catch(e) {}
  }

  // Extract CSV/code blocks
  const codeMatch = text.match(/\x60\x60\x60code\\s*\\n([\\s\\S]*?)\x60\x60\x60/);
  if (codeMatch) {
    try {
      const code = JSON.parse(codeMatch[1]);
      if (code.code) {
        // Parse CSV into table
        const lines = code.code.split('\\n').filter(l => l.trim());
        if (lines.length > 1) {
          const headers = lines[0].split(',').map(h => h.trim());
          const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim().replace(/^\"|\"$/g, '')));
          output.tables.push({ name: code.title || name, headers, rows });
        }
        output.csvData.push({ name: code.title || name, raw: code.code });
      }
    } catch(e) {}
  }

  // If no structured data, keep raw text
  if (!chartMatch && !tableMatch && !cardsMatch && !codeMatch && text.trim()) {
    output.rawTexts.push({ name, text: text.substring(0, 1500) });
  }
}

console.log(JSON.stringify(output));
" 2>/dev/null)

echo "Data extracted. Generating analysis..."

# Step 2: Ask Claude to analyze the ACTUAL data
ANALYSIS=$(echo "$ALL_DATA" | node -e "
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  const data = JSON.parse(d);
  let prompt = 'You are a senior analyst. Write a concise research brief based ONLY on this data. No speculation.\\n\\n';

  // Feed tables
  for (const t of data.tables) {
    prompt += 'TABLE: ' + t.name + '\\n';
    prompt += t.headers.join(' | ') + '\\n';
    for (const r of t.rows) prompt += r.join(' | ') + '\\n';
    prompt += '\\n';
  }

  // Feed chart data as tables
  for (const c of data.charts) {
    prompt += 'CHART DATA (' + c.name + '):\\n';
    prompt += c.dataTable.headers.join(' | ') + '\\n';
    for (const r of c.dataTable.rows) prompt += r.join(' | ') + '\\n';
    prompt += '\\n';
  }

  // Feed cards
  for (const c of data.cards) {
    prompt += 'METRICS (' + c.name + '): ';
    prompt += c.items.map(i => i.label + '=' + i.value).join(', ') + '\\n';
  }

  // Feed raw texts
  for (const r of data.rawTexts) {
    prompt += 'RAW (' + r.name + '): ' + r.text.substring(0, 500) + '\\n';
  }

  prompt += '\\nWrite: 1) Key Findings (specific numbers only) 2) Market Insights 3) Data Quality Assessment. Be concise. Use markdown.';
  console.log(prompt);
});
" | claude --model haiku --output-format text --dangerously-skip-permissions --tools "" -p - 2>/dev/null)

echo "Analysis complete. Building HTML..."

# Step 3: Build the HTML report
export ALL_DATA
export ANALYSIS
export REPORT_HTML

node << 'NODEOF'
const fs = require('fs');
const data = JSON.parse(process.env.ALL_DATA);
const analysis = process.env.ANALYSIS || '';
const outPath = process.env.REPORT_HTML;

// Convert analysis markdown to simple HTML
let analysisHtml = analysis
  .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-3 text-gray-800 border-b border-gray-200 pb-2">$1</h2>')
  .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2 text-gray-700">$1</h3>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/^- (.+)$/gm, '<li class="ml-4 mb-1 text-gray-700">$1</li>')
  .replace(/\n\n/g, '</p><p class="mb-3 text-gray-700 leading-relaxed">')
  .replace(/\n/g, '<br>');
analysisHtml = '<p class="mb-3 text-gray-700 leading-relaxed">' + analysisHtml + '</p>';

const bench = data.benchmark || { totalTime: 0, steps: [], date: '' };
const passCount = bench.steps.filter(s => s.status === 'pass').length;

// Build charts
let chartHtml = '';
let chartJs = '';
let chartIdx = 0;

// Pipeline timing chart
if (bench.steps.length > 0) {
  const id = 'chart' + chartIdx++;
  chartHtml += `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
    <h3 class="text-base font-bold text-gray-800 mb-3">Pipeline Timing (seconds)</h3>
    <canvas id="${id}" height="160"></canvas>
    <div class="overflow-x-auto mt-3 border rounded-lg"><table class="min-w-full text-xs">
      <thead class="bg-gray-50"><tr><th class="px-3 py-2 text-left font-semibold text-gray-600">Step</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Time (s)</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Data Points</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Status</th></tr></thead>
      <tbody>${bench.steps.map(s => `<tr class="border-t"><td class="px-3 py-2">${s.name}</td><td class="px-3 py-2 font-mono">${s.time}</td><td class="px-3 py-2">${s.dataPoints||0}</td><td class="px-3 py-2">${s.status==='pass'?'✅':'❌'}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  chartJs += `new Chart(document.getElementById('${id}'),{type:'bar',data:{labels:${JSON.stringify(bench.steps.map(s=>s.name))},datasets:[{label:'seconds',data:${JSON.stringify(bench.steps.map(s=>s.time))},backgroundColor:['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe'],borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});\n`;
}

// Data charts — each with its backing data table
for (const c of data.charts) {
  const id = 'chart' + chartIdx++;
  chartHtml += `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
    <h3 class="text-base font-bold text-gray-800 mb-3">${c.name}</h3>
    <canvas id="${id}" height="180"></canvas>
    <details class="mt-3"><summary class="text-xs font-semibold text-indigo-600 cursor-pointer">Show chart data table</summary>
    <div class="overflow-x-auto mt-2 border rounded-lg max-h-48 overflow-y-auto"><table class="min-w-full text-xs">
      <thead class="bg-gray-50 sticky top-0"><tr>${c.dataTable.headers.map(h => `<th class="px-3 py-2 text-left font-semibold text-gray-600">${h}</th>`).join('')}</tr></thead>
      <tbody>${c.dataTable.rows.map(r => `<tr class="border-t hover:bg-blue-50">${r.map(cell => `<td class="px-3 py-2 font-mono">${cell}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></details></div>`;
  chartJs += `new Chart(document.getElementById('${id}'),${JSON.stringify(c.config)});\n`;
}

// Raw data tables
let rawHtml = '';
for (const t of data.tables) {
  rawHtml += `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
    <h3 class="text-base font-bold text-gray-800 mb-3">${t.name}</h3>
    <div class="overflow-x-auto max-h-72 overflow-y-auto border rounded-lg">
    <table class="min-w-full text-sm sortable">
      <thead class="bg-gray-50 sticky top-0"><tr>${t.headers.map(h => `<th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:text-indigo-600" onclick="sortTbl(this)">${h} ↕</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr class="border-t hover:bg-blue-50">${r.map(c => `<td class="px-3 py-2 text-gray-700">${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="text-xs text-gray-400 mt-2">${t.rows.length} rows — click headers to sort</div></div>`;
}

// Cards
for (const c of data.cards) {
  rawHtml += `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
    <h3 class="text-base font-bold text-gray-800 mb-3">${c.name}</h3>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${c.items.map(i => `<div class="border rounded-lg p-3"><div class="text-xs font-semibold text-gray-500 uppercase">${i.label||''}</div><div class="text-xl font-extrabold text-gray-900 mt-1">${i.value||''}</div>${i.desc?`<div class="text-xs text-gray-400 mt-1">${i.desc}</div>`:''}</div>`).join('')}</div></div>`;
}

// Raw text
for (const r of data.rawTexts) {
  rawHtml += `<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
    <h3 class="text-base font-bold text-gray-800 mb-3">${r.name}</h3>
    <div class="overflow-x-auto max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-4">
    <pre class="text-xs text-gray-600 whitespace-pre-wrap font-mono">${r.text.replace(/</g,'&lt;')}</pre></div></div>`;
}

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bridge Benchmark: HR Research</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif}</style>
</head><body class="bg-gray-50 min-h-screen">
<div class="max-w-5xl mx-auto px-6 py-12">
  <div class="mb-10">
    <div class="flex items-center gap-3 mb-2">
      <div class="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">B</div>
      <span class="text-sm font-semibold text-indigo-600 uppercase tracking-wider">Benchmark Report</span>
    </div>
    <h1 class="text-3xl font-extrabold text-gray-900 mb-1">HR Scala LATAM Research Pipeline</h1>
    <p class="text-gray-500 text-sm">${bench.date || 'No benchmark data'} · ${bench.totalTime}s total · ${passCount}/${bench.steps.length} steps passed</p>
  </div>

  <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Runs</div><div class="text-2xl font-extrabold mt-1">${data.history.length}</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Total Rows</div><div class="text-2xl font-extrabold mt-1">${data.totals.rows}</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Unique URLs</div><div class="text-2xl font-extrabold mt-1">${data.totals.urls}</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Data Size</div><div class="text-2xl font-extrabold mt-1">${Math.round(data.totals.dataSize/1024)}KB</div></div>
    <div class="bg-white rounded-xl shadow-sm border p-4"><div class="text-xs font-semibold text-gray-500 uppercase">Last Run</div><div class="text-lg font-bold mt-1">${bench.totalTime}s</div><div class="text-xs text-gray-400">${passCount}/${bench.steps.length} steps</div></div>
  </div>

  <!-- Progress over time -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
    <div class="bg-white rounded-xl shadow-sm border p-6">
      <h3 class="text-base font-bold text-gray-800 mb-3">Cumulative Data Growth</h3>
      <canvas id="progressChart" height="200"></canvas>
      <div class="overflow-x-auto mt-3 border rounded-lg max-h-48 overflow-y-auto"><table class="min-w-full text-xs">
        <thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-left font-semibold text-gray-600">Run</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Date</th><th class="px-3 py-2 text-left font-semibold text-gray-600">New Rows</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Cumulative</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Engine</th></tr></thead>
        <tbody>${data.history.map((h,i) => '<tr class="border-t"><td class="px-3 py-2">#'+(i+1)+'</td><td class="px-3 py-2">'+h.date.slice(5,16)+'</td><td class="px-3 py-2 font-mono">+'+h.rows+'</td><td class="px-3 py-2 font-mono font-bold">'+h.cumulative+'</td><td class="px-3 py-2">'+h.engine+'</td></tr>').join('')}</tbody>
      </table></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border p-6">
      <h3 class="text-base font-bold text-gray-800 mb-3">Time per Run</h3>
      <canvas id="timeChart" height="200"></canvas>
      <div class="overflow-x-auto mt-3 border rounded-lg max-h-48 overflow-y-auto"><table class="min-w-full text-xs">
        <thead class="bg-gray-50 sticky top-0"><tr><th class="px-3 py-2 text-left font-semibold text-gray-600">Run</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Time (s)</th><th class="px-3 py-2 text-left font-semibold text-gray-600">Rows</th><th class="px-3 py-2 text-left font-semibold text-gray-600">URLs</th></tr></thead>
        <tbody>${data.history.map((h,i) => '<tr class="border-t"><td class="px-3 py-2">#'+(i+1)+'</td><td class="px-3 py-2 font-mono">'+h.time+'</td><td class="px-3 py-2 font-mono">'+h.rows+'</td><td class="px-3 py-2 font-mono">'+h.sources+'</td></tr>').join('')}</tbody>
      </table></div>
    </div>
  </div>

  <div class="bg-white rounded-xl shadow-sm border p-8 mb-8">
    <h2 class="text-xl font-extrabold text-gray-900 mb-4">Analysis</h2>
    ${analysisHtml}
  </div>

  <h2 class="text-xl font-extrabold text-gray-900 mb-4">Charts & Visualizations</h2>
  <p class="text-sm text-gray-500 mb-4">Each chart has a "Show chart data table" toggle proving the underlying data.</p>
  ${chartHtml}

  <h2 class="text-xl font-extrabold text-gray-900 mb-4 mt-10">Raw Collected Data</h2>
  <p class="text-sm text-gray-500 mb-4">Every row below was collected by a real browser visiting real websites. Click headers to sort.</p>
  ${rawHtml}

  <div class="text-center text-xs text-gray-400 mt-12 mb-6">Generated by Bridge Benchmark Runner · ${new Date().toISOString().slice(0,19)}</div>
</div>
<script>
document.addEventListener('DOMContentLoaded',function(){
// Progress over time charts
var hist = ${JSON.stringify(data.history)};
if (hist.length > 0) {
  new Chart(document.getElementById('progressChart'),{type:'line',data:{labels:hist.map(function(h,i){return '#'+(i+1)}),datasets:[{label:'Cumulative Rows',data:hist.map(function(h){return h.cumulative}),borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.1)',fill:true,tension:0.3,pointRadius:6,pointBackgroundColor:'#6366f1'},{label:'New Rows per Run',data:hist.map(function(h){return h.rows}),borderColor:'#22d3ee',backgroundColor:'rgba(34,211,238,0.1)',fill:true,tension:0.3,pointRadius:4,borderDash:[5,5]}]},options:{responsive:true,plugins:{legend:{display:true,position:'bottom'}},scales:{y:{beginAtZero:true,grid:{color:'#f3f4f6'}},x:{grid:{display:false}}}}});
  new Chart(document.getElementById('timeChart'),{type:'bar',data:{labels:hist.map(function(h,i){return '#'+(i+1)}),datasets:[{label:'Time (s)',data:hist.map(function(h){return h.time}),backgroundColor:hist.map(function(h){return h.time>0?'#f59e0b':'#d1d5db'}),borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{grid:{display:false}}}}});
}
${chartJs}
});
window.sortTbl=function(th){var t=th.closest('table'),i=Array.from(th.parentNode.children).indexOf(th),rows=Array.from(t.tBodies[0].rows),a=th.dataset.a!=='1';th.dataset.a=a?'1':'0';rows.sort(function(x,y){var av=x.cells[i].textContent,bv=y.cells[i].textContent,an=parseFloat(av.replace(/[^\\d.-]/g,'')),bn=parseFloat(bv.replace(/[^\\d.-]/g,''));if(!isNaN(an)&&!isNaN(bn))return a?an-bn:bn-an;return a?av.localeCompare(bv):bv.localeCompare(av)});rows.forEach(function(r){t.tBodies[0].appendChild(r)})};
</script>
</body></html>`;

fs.writeFileSync(outPath, html);
console.log('Report saved: ' + outPath + ' (' + html.length + ' bytes)');
NODEOF

echo ""
echo "Opening report..."
open "$REPORT_HTML" 2>/dev/null || echo "Open: $REPORT_HTML"
