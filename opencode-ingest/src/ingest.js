import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { normalize } from './normalize.js';
import { generateReport } from './report.js';
import { md2html } from './md2html.js';
import { Graph } from './graph.js';

const ROOT = new URL('..', import.meta.url).pathname;

async function main() {
  const taskName = process.argv.find(a => a.startsWith('--task='))?.split('=')[1];
  if (!taskName) {
    console.error('Usage: npm run ingest -- --task=<name>');
    console.error('Available tasks: create a file in src/tasks/<name>.js');
    process.exit(1);
  }

  const dataDir = join(ROOT, 'data', taskName);
  const outputDir = join(ROOT, 'output', taskName);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  // Load task scraper
  const taskPath = join(ROOT, 'src', 'tasks', `${taskName}.js`);
  if (!existsSync(taskPath)) {
    console.error(`Task file not found: ${taskPath}`);
    console.error(`Create it by extending the Scraper class. See src/tasks/example.js`);
    process.exit(1);
  }

  const { default: TaskScraper } = await import(taskPath);
  const scraper = new TaskScraper(taskName, dataDir);

  // Neo4j graph (optional — works without it)
  const graph = new Graph();
  const graphOk = await graph.connect();

  if (scraper.isDone) {
    console.log(`[${taskName}] All pages scraped. Regenerating report...`);
  } else {
    // Step 1: Scrape next page(s)
    const result = await scraper.next();
    console.log(`[${taskName}] Got ${result.records.length} records. Has more: ${result.hasNext}`);

    // Step 1b: Sync to Neo4j if available
    if (graphOk) await graph.ingestBatch(result.records);
  }

  // Step 2: Normalize raw → SQLite
  await normalize(taskName, dataDir);

  // Step 3: Generate report
  const mdPath = await generateReport(taskName);

  // Step 4: Render HTML
  if (mdPath) {
    md2html(mdPath, join(outputDir, 'index.html'));
  }

  await graph.close();
  console.log(`\nDone! View report: output/${taskName}/index.html`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
