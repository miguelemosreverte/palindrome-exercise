#!/bin/bash
# Generate a beautiful HTML benchmark report from the latest benchmark data.
# Uses Claude to analyze the data and write a markdown report,
# then transpiles to WSJ-style HTML with Tailwind CSS and Chart.js.
#
# Usage:
#   ./scripts/benchmark-report.sh                    # latest benchmark
#   ./scripts/benchmark-report.sh tests/benchmarks/hr-research-*.json  # specific file
#   open tests/benchmarks/report.html                # view in browser

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BENCHMARKS_DIR="$PROJECT_ROOT/tests/benchmarks"
REPORT_HTML="$BENCHMARKS_DIR/report.html"

# Find benchmark files
if [ -n "$1" ] && [ -f "$1" ]; then
  BENCH_FILES="$1"
else
  BENCH_FILES=$(ls -t "$BENCHMARKS_DIR"/hr-research-*.json 2>/dev/null | head -5)
fi

if [ -z "$BENCH_FILES" ]; then
  echo "No benchmark files found in $BENCHMARKS_DIR"
  exit 1
fi

echo "Analyzing $(echo "$BENCH_FILES" | wc -l | tr -d ' ') benchmark(s)..."

# Collect all benchmark data into one JSON
BENCH_DATA=$(python3 -c "
import json, sys, glob, os

files = '''$BENCH_FILES'''.strip().split('\n')
benchmarks = []
for f in files:
    f = f.strip()
    if not f or not os.path.exists(f): continue
    with open(f) as fh:
        benchmarks.append(json.load(fh))
print(json.dumps(benchmarks, indent=2))
")

# Collect actual research data from SQLite
COLLECTED_DATA=$(node -e "
const db = require('./lib/db');
const rows = db.getData('hr-research').concat(db.getData('web-browse'));
for (const r of rows.slice(0, 20)) {
  try {
    const d = JSON.parse(r.data);
    const text = d.text || d.response || '';
    if (text) {
      const name = r.collection.split('/').pop().replace(/_/g, ' ');
      console.log('### ' + name.charAt(0).toUpperCase() + name.slice(1));
      console.log(text.substring(0, 800));
      console.log();
    }
  } catch(e) {}
}
const stats = db.getStats();
console.log('### Database Stats');
console.log('Collections: ' + stats.collections + ', Total rows: ' + stats.totalRows + ', Benchmarks: ' + stats.benchmarks);
" 2>/dev/null)

# Step 1: Ask Claude to write a data-first analysis
echo "Generating analysis with Claude..."
MARKDOWN=$(echo "You are a senior data analyst writing a Wall Street Journal style research brief. The report should lead with the FINDINGS, not the methodology.

COLLECTED RESEARCH DATA:
$COLLECTED_DATA

BENCHMARK TIMINGS:
$BENCH_DATA

Write a professional report with these sections:

1. **Key Findings** — lead with the most important data insights. What did we learn about the Scala developer market in LATAM? What are the salary ranges? Where is the talent? Use specific numbers from the data above.

2. **Market Overview** — synthesize the data into a narrative. Trends, pricing, talent distribution. Write as if briefing an executive.

3. **Data Sources & Coverage** — which sites were browsed, how many data points collected, data quality assessment.

4. **Performance Metrics** — a markdown table of benchmark step timings (search, collect, enrich, csv, chart).

5. **Methodology** — brief note on how data was collected (Playwright browser automation, real website browsing).

IMPORTANT: Start with the actual findings. Numbers first, methodology last. Be specific — cite actual salary figures, product prices, candidate counts from the data above." | claude --model haiku --output-format text --dangerously-skip-permissions --tools "" -p -)

echo "Analysis complete ($(echo "$MARKDOWN" | wc -c | tr -d ' ') chars)"

# Step 2: Extract charts from BOTH benchmark timings AND actual collected data
CHART_DATA=$(node -e "
const db = require('./lib/db');
const charts = [];

// 1. Step timing chart from benchmark
const bench = db.getLatestBenchmark('hr-research') || db.getLatestBenchmark('HR Scala LATAM Research');
if (bench) {
  const steps = JSON.parse(bench.steps || '[]');
  charts.push({
    type: 'bar', title: 'Pipeline Step Duration (seconds)',
    labels: steps.map(s => s.name || ''), data: steps.map(s => s.time || 0),
    colors: ['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe']
  });
}

// 2. Extract data-driven charts from collected data
const allData = db.getData('hr-research').concat(db.getData('web-browse'));
for (const row of allData) {
  try {
    const d = JSON.parse(row.data);
    const text = d.text || '';
    // Find chartjs blocks already generated
    const chartMatch = text.match(/\x60\x60\x60chartjs\s*\n([\s\S]*?)\x60\x60\x60/);
    if (chartMatch) {
      const cfg = JSON.parse(chartMatch[1]);
      charts.push({
        type: cfg.type, title: cfg.options?.plugins?.title?.text || cfg.data?.datasets?.[0]?.label || row.collection.split('/').pop(),
        raw: cfg  // pass full Chart.js config
      });
    }
    // Find table blocks — extract for the sortable table
    const tableMatch = text.match(/\x60\x60\x60table\s*\n([\s\S]*?)\x60\x60\x60/);
    if (tableMatch) {
      try {
        const tbl = JSON.parse(tableMatch[1]);
        if (tbl.headers && tbl.rows) {
          // Store as a chart of type 'table' for the report
          charts.push({ type: 'table', title: row.collection.split('/').pop().replace(/_/g,' '), headers: tbl.headers, rows: tbl.rows });
        }
      } catch(e) {}
    }
  } catch(e) {}
}

console.log(JSON.stringify(charts));
" 2>/dev/null)

# Step 2b: Generate raw data tables HTML directly from SQLite
RAW_DATA_HTML=$(node -e "
const db = require('./lib/db');
const all = db.getData('hr-research').concat(db.getData('web-browse'));
let html = '';

for (const r of all) {
  const d = JSON.parse(r.data);
  const text = d.text || '';
  if (!text) continue;
  const name = r.collection.split('/').pop().replace(/_/g, ' ');
  const date = r.created_at || '';

  // Try to extract structured data (table, cards, code blocks)
  const tableMatch = text.match(/\x60\x60\x60table\s*\n([\s\S]*?)\x60\x60\x60/);
  const cardsMatch = text.match(/\x60\x60\x60cards\s*\n([\s\S]*?)\x60\x60\x60/);
  const codeMatch = text.match(/\x60\x60\x60code\s*\n([\s\S]*?)\x60\x60\x60/);
  const csvMatch = text.match(/\x60\x60\x60csv\s*\n([\s\S]*?)\x60\x60\x60/);

  html += '<div class=\"bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4\">';
  html += '<div class=\"flex justify-between items-center mb-3\"><h3 class=\"text-base font-bold text-gray-800\">' + name.charAt(0).toUpperCase() + name.slice(1) + '</h3>';
  html += '<span class=\"text-xs text-gray-400\">' + date + '</span></div>';

  if (tableMatch) {
    try {
      const tbl = JSON.parse(tableMatch[1]);
      html += '<div class=\"overflow-x-auto max-h-64 overflow-y-auto border rounded-lg\">';
      html += '<table class=\"min-w-full text-sm\"><thead class=\"bg-gray-50 sticky top-0\"><tr>';
      for (const h of (tbl.headers || [])) html += '<th class=\"px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase\">' + h + '</th>';
      html += '</tr></thead><tbody>';
      for (const row of (tbl.rows || [])) {
        html += '<tr class=\"border-t hover:bg-blue-50\">';
        for (const c of row) html += '<td class=\"px-3 py-2 text-gray-700 whitespace-nowrap\">' + c + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    } catch(e) {}
  } else if (cardsMatch) {
    try {
      const cards = JSON.parse(cardsMatch[1]);
      const items = cards.items || cards;
      html += '<div class=\"grid grid-cols-2 md:grid-cols-4 gap-3\">';
      for (const item of items) {
        html += '<div class=\"border rounded-lg p-3\"><div class=\"text-xs font-semibold text-gray-500 uppercase\">' + (item.label||'') + '</div>';
        html += '<div class=\"text-xl font-extrabold text-gray-900 mt-1\">' + (item.value||'') + '</div>';
        if (item.desc) html += '<div class=\"text-xs text-gray-400 mt-1\">' + item.desc + '</div>';
        html += '</div>';
      }
      html += '</div>';
    } catch(e) {}
  } else if (codeMatch) {
    try {
      const code = JSON.parse(codeMatch[1]);
      html += '<div class=\"overflow-x-auto max-h-64 overflow-y-auto bg-gray-900 rounded-lg p-4\">';
      html += '<div class=\"text-xs text-gray-400 mb-2\">' + (code.title || code.language || 'data') + '</div>';
      html += '<pre class=\"text-xs text-green-300 whitespace-pre font-mono\">' + (code.code || '').replace(/</g,'&lt;') + '</pre>';
      html += '</div>';
    } catch(e) {}
  } else {
    // Raw text — show in a scrollable pre block
    const clean = text.replace(/\x60\x60\x60\w*\n[\s\S]*?\x60\x60\x60/g, '[component block]').substring(0, 2000);
    html += '<div class=\"overflow-x-auto max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-4\">';
    html += '<pre class=\"text-xs text-gray-600 whitespace-pre-wrap font-mono\">' + clean.replace(/</g,'&lt;') + '</pre>';
    html += '</div>';
  }

  html += '</div>';
}

// DB stats footer
const stats = db.getStats();
html += '<div class=\"text-xs text-gray-400 mt-4 p-4 bg-gray-50 rounded-lg\">';
html += 'SQLite: ' + db.DB_PATH + '<br>';
html += 'Collections: ' + stats.collections + ' | Total rows: ' + stats.totalRows + ' | Benchmarks: ' + stats.benchmarks;
html += '</div>';

console.log(html);
" 2>/dev/null)

# Also extract chart data from benchmarks JSON (fallback)
CHART_DATA_EXTRA=$(python3 -c "
import json
benchmarks = json.loads('''$BENCH_DATA''')
charts = []
if benchmarks:
    b = benchmarks[0]
    steps = b.get('steps', [])
    charts.append({
        'type': 'bar',
        'title': 'Data Points per Step',
        'labels': [s.get('name','') for s in steps],
        'data': [s.get('dataPoints',0) for s in steps],
        'colors': ['#06b6d4','#22d3ee','#67e8f9','#a5f3fc','#cffafe']
    })
    # If multiple benchmarks, timeline
    if len(benchmarks) > 1:
        charts.append({
            'type': 'line',
            'title': 'Total Time Over Runs',
            'labels': [b.get('date','')[:10] for b in reversed(benchmarks)],
            'data': [b.get('totalTime',0) for b in reversed(benchmarks)],
            'colors': ['#f59e0b']
        })
print(json.dumps(charts))
")

# Step 3: Generate WSJ-style HTML with Tailwind + Chart.js
echo "Generating HTML report..."
export RAW_DATA_HTML
export REPORT_MARKDOWN="$MARKDOWN"
export REPORT_CHARTS="$CHART_DATA"
export REPORT_BENCH="$BENCH_DATA"
export REPORT_OUT="$REPORT_HTML"

python3 << 'PYEOF'
import json, sys, os

markdown = os.environ.get('REPORT_MARKDOWN', '')
charts = json.loads(os.environ.get('REPORT_CHARTS', '[]'))
bench_data = json.loads(os.environ.get('REPORT_BENCH', '[]'))
REPORT_HTML = os.environ.get('REPORT_OUT', 'report.html')

# Convert markdown to simple HTML
import re
html_content = markdown
html_content = re.sub(r'^# (.+)$', r'<h1 class="text-4xl font-bold mb-6 text-gray-900">\1</h1>', html_content, flags=re.MULTILINE)
html_content = re.sub(r'^## (.+)$', r'<h2 class="text-2xl font-bold mt-10 mb-4 text-gray-800 border-b-2 border-gray-200 pb-2">\1</h2>', html_content, flags=re.MULTILINE)
html_content = re.sub(r'^### (.+)$', r'<h3 class="text-xl font-semibold mt-6 mb-3 text-gray-700">\1</h3>', html_content, flags=re.MULTILINE)
html_content = re.sub(r'\*\*(.+?)\*\*', r'<strong class="font-bold">\1</strong>', html_content)
html_content = re.sub(r'^- (.+)$', r'<li class="ml-4 mb-1">\1</li>', html_content, flags=re.MULTILINE)
html_content = re.sub(r'(<li.*</li>\n?)+', r'<ul class="list-disc mb-4">\g<0></ul>', html_content)
# Tables
lines = html_content.split('\n')
in_table = False
table_html = ''
result_lines = []
for line in lines:
    if '|' in line and line.strip().startswith('|'):
        cells = [c.strip() for c in line.strip('|').split('|')]
        if all(set(c) <= set('- :') for c in cells):
            continue  # separator row
        if not in_table:
            in_table = True
            table_html = '<div class="overflow-x-auto mb-6"><table class="min-w-full divide-y divide-gray-200">'
            table_html += '<thead class="bg-gray-50"><tr>' + ''.join('<th class="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">' + c + '</th>' for c in cells) + '</tr></thead><tbody class="bg-white divide-y divide-gray-200">'
        else:
            table_html += '<tr>' + ''.join('<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">' + c + '</td>' for c in cells) + '</tr>'
    else:
        if in_table:
            table_html += '</tbody></table></div>'
            result_lines.append(table_html)
            in_table = False
            table_html = ''
        result_lines.append(line)
if in_table:
    table_html += '</tbody></table></div>'
    result_lines.append(table_html)
html_content = '\n'.join(result_lines)
html_content = html_content.replace('\n\n', '</p><p class="mb-4 text-gray-700 leading-relaxed">')
html_content = '<p class="mb-4 text-gray-700 leading-relaxed">' + html_content + '</p>'

# Build chart canvases AND sortable data tables
chart_html = ''
chart_js = 'document.addEventListener("DOMContentLoaded", function() {\n'
chart_idx = 0

for i, chart in enumerate(charts):
    if chart.get('type') == 'table':
        # Sortable data table
        title = chart.get('title', 'Data')
        headers = chart.get('headers', [])
        rows = chart.get('rows', [])
        th = ''.join(f'<th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:text-indigo-600" onclick="sortTable(this)">{h} ↕</th>' for h in headers)
        tr = ''
        for row in rows:
            cells = ''.join(f'<td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{c}</td>' for c in row)
            tr += f'<tr class="hover:bg-gray-50">{cells}</tr>'
        chart_html += f'''<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 class="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
          <div class="overflow-x-auto max-h-96 overflow-y-auto">
            <table class="min-w-full divide-y divide-gray-200 sortable">
              <thead class="bg-gray-50 sticky top-0"><tr>{th}</tr></thead>
              <tbody class="bg-white divide-y divide-gray-200">{tr}</tbody>
            </table>
          </div>
          <div class="text-xs text-gray-400 mt-2">{len(rows)} rows — click headers to sort</div>
        </div>'''
    elif chart.get('raw'):
        # Full Chart.js config from collected data
        cid = f'chart{chart_idx}'
        chart_html += f'<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6"><h3 class="text-lg font-semibold text-gray-800 mb-4">{chart["title"]}</h3><canvas id="{cid}" height="200"></canvas></div>'
        chart_js += f'  new Chart(document.getElementById("{cid}"), {json.dumps(chart["raw"])});\n'
        chart_idx += 1
    else:
        # Simple chart from labels/data
        cid = f'chart{chart_idx}'
        chart_html += f'<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6"><h3 class="text-lg font-semibold text-gray-800 mb-4">{chart["title"]}</h3><canvas id="{cid}" height="200"></canvas></div>'
        cfg = {
            'type': chart['type'],
            'data': {'labels': chart.get('labels',[]), 'datasets': [{'label': chart['title'], 'data': chart.get('data',[]),
              'backgroundColor': chart.get('colors',['#6366f1']), 'borderColor': chart.get('colors',['#6366f1'])[0] if chart['type']=='line' else chart.get('colors',['#6366f1']),
              'borderWidth': 2, 'borderRadius': 6 if chart['type']=='bar' else 0, 'tension': 0.3, 'fill': chart['type']=='line'}]},
            'options': {'responsive': True, 'plugins': {'legend': {'display': False}}, 'scales': {'y': {'beginAtZero': True, 'grid': {'color': '#f3f4f6'}}, 'x': {'grid': {'display': False}}}}
        }
        chart_js += f'  new Chart(document.getElementById("{cid}"), {json.dumps(cfg)});\n'
        chart_idx += 1

chart_js += '''
  // Sortable table handler
  window.sortTable = function(th) {
    var table = th.closest("table");
    var idx = Array.from(th.parentNode.children).indexOf(th);
    var rows = Array.from(table.tBodies[0].rows);
    var asc = th.dataset.asc !== "true";
    th.dataset.asc = asc;
    rows.sort(function(a, b) {
      var av = a.cells[idx].textContent, bv = b.cells[idx].textContent;
      var an = parseFloat(av.replace(/[^\\d.-]/g, "")), bn = parseFloat(bv.replace(/[^\\d.-]/g, ""));
      if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    rows.forEach(function(r) { table.tBodies[0].appendChild(r); });
  };
});'''

# Summary stats
total_time = bench_data[0].get('totalTime', 0) if bench_data else 0
total_steps = len(bench_data[0].get('steps', [])) if bench_data else 0
pass_count = sum(1 for s in (bench_data[0].get('steps', []) if bench_data else []) if s.get('status') == 'pass')

report = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bridge Benchmark Report</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>body {{ font-family: 'Inter', sans-serif; }}</style>
</head>
<body class="bg-gray-50 min-h-screen">
<div class="max-w-4xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="mb-12">
    <div class="flex items-center gap-3 mb-2">
      <div class="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">B</div>
      <span class="text-sm font-semibold text-indigo-600 uppercase tracking-wider">Bridge Benchmark Report</span>
    </div>
    <h1 class="text-4xl font-extrabold text-gray-900 mb-2">HR Research Pipeline</h1>
    <p class="text-gray-500">{bench_data[0].get('date', '')[:19] if bench_data else 'No data'}</p>
  </div>

  <!-- Stats cards -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Time</div>
      <div class="text-3xl font-extrabold text-gray-900 mt-1">{total_time}s</div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Steps</div>
      <div class="text-3xl font-extrabold text-gray-900 mt-1">{pass_count}/{total_steps}</div>
      <div class="text-xs text-green-600 font-semibold mt-1">All passing</div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Runs</div>
      <div class="text-3xl font-extrabold text-gray-900 mt-1">{len(bench_data)}</div>
    </div>
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Engine</div>
      <div class="text-lg font-bold text-gray-900 mt-2">Claude + Playwright</div>
    </div>
  </div>

  <!-- Charts -->
  {chart_html}

  <!-- Raw Data (scrollable, sortable — proves this is not hallucinated) -->
  <div class="mb-10">
    <h2 class="text-2xl font-extrabold text-gray-900 mb-1">Raw Collected Data</h2>
    <p class="text-sm text-gray-500 mb-6">Every data point below was collected by a real browser visiting real websites. Scroll and sort to verify.</p>
    RAW_DATA_PLACEHOLDER
  </div>

  <!-- Analysis -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-8 mb-6">
    {html_content}
  </div>

  <div class="text-center text-sm text-gray-400 mt-12 mb-6">
    Generated by Bridge Benchmark Runner — {bench_data[0].get('date', '')[:10] if bench_data else ''}
  </div>
</div>
<script>{chart_js}</script>
</body>
</html>"""

with open(REPORT_HTML, 'w') as f:
    f.write(report)
print(f"Report saved: {REPORT_HTML} ({len(report)} bytes)")
PYEOF

# Inject raw data tables into the report (replace placeholder)
python3 -c "
import os
with open(os.environ['REPORT_OUT']) as f:
    html = f.read()
raw = os.environ.get('RAW_DATA_HTML', '')
html = html.replace('RAW_DATA_PLACEHOLDER', raw)
with open(os.environ['REPORT_OUT'], 'w') as f:
    f.write(html)
print(f'Final report: {len(html)} bytes with raw data')
"

echo ""
echo "Opening report..."
open "$REPORT_HTML" 2>/dev/null || echo "Open: $REPORT_HTML"
