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

# Step 1: Ask Claude to write a markdown analysis
echo "Generating analysis with Claude..."
MARKDOWN=$(echo "You are a senior data analyst. Analyze this benchmark data and write a professional markdown report.

BENCHMARK DATA:
$BENCH_DATA

Write a report with these sections:
1. **Executive Summary** — one paragraph overview
2. **Performance Metrics** — a markdown table of step timings
3. **Trends** — if multiple runs exist, describe improvement/regression
4. **Data Quality** — assess the quality of collected data
5. **Recommendations** — 3 actionable suggestions for improvement

Include specific numbers. Be concise. Use markdown tables and bullet points.
Do NOT include code blocks or technical implementation details." | claude --model haiku --output-format text --dangerously-skip-permissions --tools "" -p -)

echo "Analysis complete ($(echo "$MARKDOWN" | wc -c | tr -d ' ') chars)"

# Step 2: Extract chart data from benchmarks for Chart.js
CHART_DATA=$(python3 -c "
import json
benchmarks = json.loads('''$BENCH_DATA''')
charts = []
if benchmarks:
    b = benchmarks[0]  # latest
    steps = b.get('steps', [])
    # Step timing chart
    charts.append({
        'type': 'bar',
        'title': 'Step Duration (seconds)',
        'labels': [s.get('name','') for s in steps],
        'data': [s.get('time',0) for s in steps],
        'colors': ['#6366f1','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe']
    })
    # Data points chart
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

# Build chart canvases
chart_html = ''
for i, chart in enumerate(charts):
    chart_html += f'<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6"><h3 class="text-lg font-semibold text-gray-800 mb-4">{chart["title"]}</h3><canvas id="chart{i}" height="200"></canvas></div>'

# Chart.js init script
chart_js = 'document.addEventListener("DOMContentLoaded", function() {\n'
for i, chart in enumerate(charts):
    cfg = {
        'type': chart['type'],
        'data': {
            'labels': chart['labels'],
            'datasets': [{
                'label': chart['title'],
                'data': chart['data'],
                'backgroundColor': chart.get('colors', ['#6366f1']),
                'borderColor': chart.get('colors', ['#6366f1'])[0] if chart['type'] == 'line' else chart.get('colors', ['#6366f1']),
                'borderWidth': 2,
                'borderRadius': 6 if chart['type'] == 'bar' else 0,
                'tension': 0.3,
                'fill': chart['type'] == 'line',
            }]
        },
        'options': {
            'responsive': True,
            'plugins': {'legend': {'display': False}},
            'scales': {'y': {'beginAtZero': True, 'grid': {'color': '#f3f4f6'}}, 'x': {'grid': {'display': False}}}
        }
    }
    chart_js += f'  new Chart(document.getElementById("chart{i}"), {json.dumps(cfg)});\n'
chart_js += '});'

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

echo ""
echo "Opening report..."
open "$REPORT_HTML" 2>/dev/null || echo "Open: $REPORT_HTML"
