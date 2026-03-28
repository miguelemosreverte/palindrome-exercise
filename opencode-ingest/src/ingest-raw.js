import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { normalize } from './normalize.js';
import { generateReport } from './report.js';
import { md2html } from './md2html.js';
import { Graph } from './graph.js';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Agent-driven ingestion: accepts raw JSON records from stdin or a file.
 * The agent uses Playwright MCP to navigate and extract, then pipes data here.
 *
 * Usage:
 *   echo '[{...}]' | node src/ingest-raw.js --task=ar-senior-devs
 *   node src/ingest-raw.js --task=ar-senior-devs --file=extracted.json
 *   node src/ingest-raw.js --task=ar-senior-devs --url="https://..." --records='[{...}]'
 */
async function main() {
  const args = process.argv.slice(2);
  const taskName = args.find(a => a.startsWith('--task='))?.split('=')[1];
  const filePath = args.find(a => a.startsWith('--file='))?.split('=')[1];
  const url = args.find(a => a.startsWith('--url='))?.split('=')[1] || '';
  const inlineRecords = args.find(a => a.startsWith('--records='))?.split('=').slice(1).join('=');

  if (!taskName) {
    console.error('Usage: node src/ingest-raw.js --task=<name> [--file=data.json | --records=\'[...]\'] [--url=source-url]');
    process.exit(1);
  }

  const dataDir = join(ROOT, 'data', taskName);
  const outputDir = join(ROOT, 'output', taskName);
  const rawDir = join(dataDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  // Read records from file, inline, or stdin
  let records;
  if (inlineRecords) {
    records = JSON.parse(inlineRecords);
  } else if (filePath) {
    records = JSON.parse(readFileSync(filePath, 'utf8'));
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    records = JSON.parse(Buffer.concat(chunks).toString());
  }

  if (!Array.isArray(records) || records.length === 0) {
    console.error('No records provided');
    process.exit(1);
  }

  // Load or create meta
  const metaPath = join(dataDir, 'meta.json');
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : { task: taskName, iteration: 0, cursor: null, sources: [], totalRecords: 0, history: [] };

  // Save raw
  meta.iteration++;
  const rawFile = join(rawDir, `${String(meta.iteration).padStart(3, '0')}.jsonl`);
  writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

  meta.totalRecords += records.length;
  meta.history.push({
    iteration: meta.iteration,
    date: new Date().toISOString(),
    url: url || 'agent-driven',
    records: records.length,
  });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`[${taskName}] Iteration ${meta.iteration}: saved ${records.length} records`);

  // Neo4j sync
  const graph = new Graph();
  const graphOk = await graph.connect();
  if (graphOk) await graph.ingestBatch(records);
  await graph.close();

  // Normalize + report
  await normalize(taskName, dataDir);
  const mdPath = await generateReport(taskName);
  if (mdPath) md2html(mdPath, join(outputDir, 'index.html'));

  console.log(`Done! View report: output/${taskName}/index.html`);
}

main().catch(err => { console.error(err); process.exit(1); });
