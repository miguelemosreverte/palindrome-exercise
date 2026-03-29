import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Detect layout based on task name heuristics + data columns */
function detectLayout(taskName, columns) {
  const name = taskName.toLowerCase();
  if (name.includes('linkedin') || name.includes('devs')) return 'graph';
  if (name.includes('youtube') || name.includes('video') || name.includes('feed')) return 'feed';
  if (name.includes('mercado') || name.includes('shop') || name.includes('real-estate') || name.includes('product')) return 'grid';
  if (columns.includes('price') || columns.includes('seller')) return 'grid';
  if (columns.includes('channel') || columns.includes('views') || columns.includes('duration')) return 'feed';
  if (columns.includes('company') || columns.includes('seniority')) return 'graph';
  return 'table';
}

export async function generateReport(taskName) {
  const dataDir = join(ROOT, 'data', taskName);
  const outputDir = join(ROOT, 'output', taskName);
  mkdirSync(outputDir, { recursive: true });

  const metaPath = join(dataDir, 'meta.json');
  if (!existsSync(metaPath)) {
    console.log(`[${taskName}] No meta.json found — nothing to report`);
    return;
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const dbPath = join(dataDir, 'db.sqlite');
  if (!existsSync(dbPath)) {
    console.log(`[${taskName}] No database found — run normalize first`);
    return;
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));

  const colInfo = db.exec("PRAGMA table_info(records)");
  if (!colInfo.length) {
    console.log(`[${taskName}] No records table yet — skipping report`);
    db.close();
    return;
  }
  const columns = colInfo[0].values.map(r => r[1]).filter(c => !c.startsWith('_'));

  const iterRes = db.exec('SELECT _iteration, COUNT(*) as count FROM records GROUP BY _iteration ORDER BY _iteration');
  const iterCounts = iterRes.length ? iterRes[0].values.map(r => ({ _iteration: r[0], count: r[1] })) : [];

  let cumulative = 0;
  const growth = iterCounts.map(r => { cumulative += r.count; return cumulative; });

  // Get all records as objects (not just arrays)
  const recRes = db.exec(`SELECT ${columns.map(c => `"${c}"`).join(', ')} FROM records ORDER BY _id DESC LIMIT 500`);
  const records = recRes.length
    ? recRes[0].values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
    : [];

  db.close();

  const layout = detectLayout(taskName, columns);
  const now = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Build markdown with metadata comments
  let md = `<!-- layout: ${layout} -->\n`;
  md += `<!-- generated: ${new Date().toISOString()} -->\n`;
  md += `<!-- task: ${taskName} -->\n\n`;

  md += `# ${taskName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n`;
  md += `*${now} — ${meta.totalRecords} records across ${meta.iteration} iterations*\n\n`;

  // Timeline
  md += `## Edition History\n\n`;
  for (const h of (meta.history || []).slice(-10)) {
    const date = new Date(h.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    md += `- **#${h.iteration}** ${date} — ${h.records} records\n`;
  }
  md += `\n`;

  // Overview
  md += `## Overview\n\n`;
  md += `> Dataset of **${meta.totalRecords}** records collected over **${meta.iteration}** iterations. `;
  md += `Latest scrape: ${meta.history?.at(-1)?.records || 0} records.\n\n`;

  // Charts — WSJ palette
  md += `## Growth\n\n`;
  md += '```chartjs\n';
  md += JSON.stringify({
    type: 'line',
    data: {
      labels: iterCounts.map(r => `#${r._iteration}`),
      datasets: [{
        label: 'Total Records',
        data: growth,
        borderColor: '#c0392b',
        backgroundColor: 'rgba(192,57,43,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#c0392b',
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, title: { display: true, text: 'Dataset Growth', font: { family: 'Georgia, serif', size: 16 } } },
      scales: { y: { beginAtZero: true, grid: { color: '#e0d8cf' } }, x: { grid: { display: false } } }
    }
  }, null, 2);
  md += '\n```\n\n';

  md += '```chartjs\n';
  md += JSON.stringify({
    type: 'bar',
    data: {
      labels: iterCounts.map(r => `#${r._iteration}`),
      datasets: [{
        label: 'Per Iteration',
        data: iterCounts.map(r => r.count),
        backgroundColor: '#2c3e50',
        borderRadius: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: '#e0d8cf' } }, x: { grid: { display: false } } }
    }
  }, null, 2);
  md += '\n```\n\n';

  // Data — emit as JSON block for custom rendering, plus markdown table as fallback
  md += `## Data\n\n`;
  md += `<!-- data:json\n${JSON.stringify({ columns, records: records.slice(0, 200), layout })}\n-->\n\n`;

  // Markdown table fallback
  md += `| ${columns.join(' | ')} |\n`;
  md += `| ${columns.map(() => '---').join(' | ')} |\n`;
  for (const rec of records.slice(0, 200)) {
    const vals = columns.map(c => String(rec[c] || '').replace(/\|/g, '\\|').substring(0, 100));
    md += `| ${vals.join(' | ')} |\n`;
  }

  const mdPath = join(outputDir, 'report.md');
  writeFileSync(mdPath, md);
  console.log(`[${taskName}] Report written to ${mdPath}`);
  return mdPath;
}

// CLI (when run directly)
if (process.argv[1]?.endsWith('report.js')) {
  const task = process.argv.find(a => a.startsWith('--task='))?.split('=')[1];
  if (task) {
    const htmlPath = await generateReport(task);
    if (htmlPath) {
      const { md2html } = await import('./md2html.js');
      const outDir = join(ROOT, 'output', task);
      md2html(join(outDir, 'report.md'), join(outDir, 'index.html'));
    }
  }
}
