import { marked } from 'marked';
import { readFileSync, writeFileSync } from 'fs';

/**
 * Universal Markdown → HTML converter.
 * Handles ```chartjs``` blocks by rendering them as Chart.js canvases.
 * Works for ANY markdown file, not just ingestion reports.
 */
export function md2html(inputPath, outputPath) {
  let md = readFileSync(inputPath, 'utf8');

  // Extract chartjs blocks before marked processes them
  const charts = [];
  md = md.replace(/```chartjs\n([\s\S]*?)```/g, (_, json) => {
    const id = `chart-${charts.length}`;
    charts.push({ id, config: json.trim() });
    return `<canvas id="${id}" style="max-height:400px;margin:1em 0"></canvas>`;
  });

  const html = marked.parse(md);

  const chartScripts = charts.map(c =>
    `new Chart(document.getElementById('${c.id}'), ${c.config});`
  ).join('\n');

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${inputPath.split('/').pop().replace('.md', '')}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --border: #30363d; --card: #161b22; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.4rem; color: var(--accent); margin: 2rem 0 1rem; }
    p, li { color: var(--fg); margin-bottom: 0.5rem; }
    ul { padding-left: 1.5rem; }
    blockquote { border-left: 3px solid var(--accent); padding: 0.5rem 1rem; background: var(--card); border-radius: 4px; margin: 1rem 0; color: var(--muted); }
    code { background: var(--card); padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
    canvas { background: var(--card); border-radius: 8px; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.85rem; }
    th { background: var(--card); color: var(--accent); text-align: left; padding: 0.6rem; border: 1px solid var(--border); position: sticky; top: 0; }
    td { padding: 0.4rem 0.6rem; border: 1px solid var(--border); }
    tr:nth-child(even) { background: var(--card); }
    tr:hover { background: #1c2333; }
    strong { color: var(--accent); }
    .table-wrap { max-height: 80vh; overflow: auto; border-radius: 8px; border: 1px solid var(--border); }
    .table-wrap::-webkit-scrollbar { width: 8px; height: 8px; }
    .table-wrap::-webkit-scrollbar-track { background: var(--card); }
    .table-wrap::-webkit-scrollbar-thumb { background: #484f58; border-radius: 4px; }
    .table-wrap::-webkit-scrollbar-thumb:hover { background: #6e7681; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  ${html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>')}
  <script>${chartScripts}</script>
</body>
</html>`;

  writeFileSync(outputPath, page);
  console.log(`HTML written to ${outputPath}`);
}

// CLI: node lib/md2html.js input.md output.html
if (process.argv[1]?.endsWith('md2html.js')) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (args.length >= 2) {
    md2html(args[0], args[1]);
  } else if (args.length === 1) {
    md2html(args[0], args[0].replace('.md', '.html'));
  }
}
