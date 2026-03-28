import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

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

  // Get columns (excluding internal ones for display)
  const colInfo = db.exec("PRAGMA table_info(records)");
  if (!colInfo.length) {
    console.log(`[${taskName}] No records table yet — skipping report`);
    db.close();
    return;
  }
  const columns = colInfo[0].values.map(r => r[1]).filter(c => !c.startsWith('_'));

  // Get record counts per iteration for chart
  const iterRes = db.exec('SELECT _iteration, COUNT(*) as count FROM records GROUP BY _iteration ORDER BY _iteration');
  const iterCounts = iterRes.length ? iterRes[0].values.map(r => ({ _iteration: r[0], count: r[1] })) : [];

  // Cumulative growth
  let cumulative = 0;
  const growth = iterCounts.map(r => { cumulative += r.count; return cumulative; });

  // Get all records for table (last 200)
  const recRes = db.exec(`SELECT ${columns.map(c => `"${c}"`).join(', ')} FROM records ORDER BY _id DESC LIMIT 200`);
  const records = recRes.length ? recRes[0].values : [];

  db.close();

  // Build markdown
  let md = `# ${taskName} — Ingestion Report\n\n`;

  // Timeline
  md += `## Timeline\n\n`;
  for (const h of meta.history || []) {
    const date = new Date(h.date).toLocaleDateString();
    md += `- **Iteration ${h.iteration}** (${date}): Scraped ${h.records} records from \`${h.url}\`\n`;
  }
  md += `\n**Total: ${meta.totalRecords} records across ${meta.iteration} iterations**\n\n`;

  // Overview
  md += `## Overview\n\n`;
  md += `> _Agent insights will be added here as the dataset grows._\n\n`;

  // Charts
  md += `## Dataset Growth\n\n`;
  md += '```chartjs\n';
  md += JSON.stringify({
    type: 'line',
    data: {
      labels: iterCounts.map(r => `Iter ${r._iteration}`),
      datasets: [{
        label: 'Cumulative Records',
        data: growth,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.3,
      }]
    },
    options: { responsive: true, plugins: { title: { display: true, text: 'Dataset Growth Over Iterations' } } }
  }, null, 2);
  md += '\n```\n\n';

  md += `## Records Per Iteration\n\n`;
  md += '```chartjs\n';
  md += JSON.stringify({
    type: 'bar',
    data: {
      labels: iterCounts.map(r => `Iter ${r._iteration}`),
      datasets: [{
        label: 'Records',
        data: iterCounts.map(r => r.count),
        backgroundColor: '#8b5cf6',
      }]
    },
    options: { responsive: true }
  }, null, 2);
  md += '\n```\n\n';

  // Data table
  md += `## Data (latest ${Math.min(records.length, 200)} records)\n\n`;
  md += `| ${columns.join(' | ')} |\n`;
  md += `| ${columns.map(() => '---').join(' | ')} |\n`;
  for (const row of records) {
    const vals = row.map(v => String(v || '').replace(/\|/g, '\\|'));
    md += `| ${vals.join(' | ')} |\n`;
  }

  const mdPath = join(outputDir, 'report.md');
  writeFileSync(mdPath, md);
  console.log(`[${taskName}] Report written to ${mdPath}`);

  return mdPath;
}

// CLI
const task = process.argv.find(a => a.startsWith('--task='))?.split('=')[1];
if (task) {
  const htmlPath = await generateReport(task);
  if (htmlPath) {
    const { md2html } = await import('./md2html.js');
    const outDir = join(ROOT, 'output', task);
    md2html(join(outDir, 'report.md'), join(outDir, 'index.html'));
  }
}
