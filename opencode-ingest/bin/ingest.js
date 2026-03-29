#!/usr/bin/env node

/**
 * ingest — CLI for browser-based data ingestion.
 *
 * The user's Chrome session is the universal API.
 * This tool leverages it for authenticated scraping,
 * normalization, and live report generation.
 *
 * Usage:
 *   ingest run <task> [--iterations=N]
 *   ingest feed <task> [--file=data.json | --records='[...]' | stdin]
 *   ingest report <task>
 *   ingest render <file.md> [output.html]
 *   ingest browse <url> [--domain=.example.com]
 *   ingest cookies <domain>
 *   ingest list
 *   ingest new <name>
 *   ingest status <task>
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TASKS_DIR = join(ROOT, 'tasks');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT_DIR = join(ROOT, 'output');

const [cmd, ...args] = process.argv.slice(2);
const getFlag = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const positional = args.filter(a => !a.startsWith('--'));

const commands = {
  // ─── Core ──────────────────────────────────────────────────

  async run() {
    const taskName = positional[0];
    const iterations = parseInt(getFlag('iterations') || '1', 10);
    if (!taskName) return usage('run <task> [--iterations=N]');

    const taskPath = join(TASKS_DIR, `${taskName}.js`);
    if (!existsSync(taskPath)) {
      console.error(`Task not found: ${taskPath}`);
      console.error(`Run 'ingest list' to see available tasks or 'ingest new ${taskName}' to create one.`);
      process.exit(1);
    }

    const { normalize } = await import('../lib/normalize.js');
    const { generateReport } = await import('../lib/report.js');
    const { md2html } = await import('../lib/md2html.js');
    const { Graph } = await import('../lib/graph.js');

    const dataDir = join(DATA_DIR, taskName);
    const outputDir = join(OUTPUT_DIR, taskName);
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const { default: TaskScraper } = await import(taskPath);
    const scraper = new TaskScraper(taskName, dataDir);

    const graph = new Graph();
    const graphOk = await graph.connect();

    for (let i = 0; i < iterations; i++) {
      if (scraper.isDone) {
        console.log(`[${taskName}] All pages scraped.`);
        break;
      }
      console.log(`\n── Iteration ${i + 1}/${iterations} ──`);
      const result = await scraper.next();
      console.log(`[${taskName}] Got ${result.records.length} records. Has more: ${result.hasNext}`);
      if (graphOk) await graph.ingestBatch(result.records);
      if (!result.hasNext) break;
    }

    await graph.close();
    await normalize(taskName, dataDir);
    const mdPath = await generateReport(taskName);
    if (mdPath) md2html(mdPath, join(outputDir, 'index.html'));
    console.log(`\nDone! View report: output/${taskName}/index.html`);
  },

  async feed() {
    const taskName = positional[0];
    if (!taskName) return usage('feed <task> [--file=data.json | --records=\'[...]\'] [--url=source-url]');

    const filePath = getFlag('file');
    const url = getFlag('url') || '';
    const inlineRecords = getFlag('records');

    let records;
    if (inlineRecords) {
      records = JSON.parse(inlineRecords);
    } else if (filePath) {
      records = JSON.parse(readFileSync(filePath, 'utf8'));
    } else {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      records = JSON.parse(Buffer.concat(chunks).toString());
    }

    if (!Array.isArray(records) || records.length === 0) {
      console.error('No records provided');
      process.exit(1);
    }

    const dataDir = join(DATA_DIR, taskName);
    const outputDir = join(OUTPUT_DIR, taskName);
    const rawDir = join(dataDir, 'raw');
    mkdirSync(rawDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const metaPath = join(dataDir, 'meta.json');
    const meta = existsSync(metaPath)
      ? JSON.parse(readFileSync(metaPath, 'utf8'))
      : { task: taskName, iteration: 0, cursor: null, sources: [], totalRecords: 0, history: [] };

    meta.iteration++;
    const rawFile = join(rawDir, `${String(meta.iteration).padStart(3, '0')}.jsonl`);
    writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    meta.totalRecords += records.length;
    meta.history.push({ iteration: meta.iteration, date: new Date().toISOString(), url: url || 'feed', records: records.length });
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`[${taskName}] Iteration ${meta.iteration}: saved ${records.length} records`);

    const { normalize } = await import('../lib/normalize.js');
    const { generateReport } = await import('../lib/report.js');
    const { md2html } = await import('../lib/md2html.js');

    await normalize(taskName, dataDir);
    const mdPath = await generateReport(taskName);
    if (mdPath) md2html(mdPath, join(outputDir, 'index.html'));
    console.log(`Done! View report: output/${taskName}/index.html`);
  },

  async report() {
    const taskName = positional[0];
    if (!taskName) return usage('report <task>');

    const { generateReport } = await import('../lib/report.js');
    const { md2html } = await import('../lib/md2html.js');

    const mdPath = await generateReport(taskName);
    if (mdPath) {
      md2html(mdPath, join(OUTPUT_DIR, taskName, 'index.html'));
    }
  },

  async render() {
    const input = positional[0];
    const output = positional[1] || input?.replace('.md', '.html');
    if (!input) return usage('render <file.md> [output.html]');

    const { md2html } = await import('../lib/md2html.js');
    md2html(input, output);
  },

  // ─── Browser session ───────────────────────────────────────

  async browse() {
    const url = positional[0];
    const domain = getFlag('domain');
    if (!url) return usage('browse <url> [--domain=.example.com]');

    const { createBrowser } = await import('../lib/browser.js');
    const { page } = await createBrowser({ domain, headless: false });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`Browser open at ${url}. Press Ctrl+C to close.`);
    await new Promise(() => {}); // keep alive
  },

  async cookies() {
    const domain = positional[0];
    if (!domain) return usage('cookies <domain>  (e.g. .linkedin.com)');

    const { getChromeCookes } = await import('../lib/chrome-cookies.js');
    const cookies = await getChromeCookes(domain);
    for (const c of cookies) {
      console.log(`  ${c.name.padEnd(30)} = ${c.value.substring(0, 60)}${c.value.length > 60 ? '...' : ''}`);
    }
    console.log(`\n${cookies.length} cookies for ${domain}`);
  },

  // ─── Task management ───────────────────────────────────────

  async list() {
    const tasks = readdirSync(TASKS_DIR).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
    console.log('Available tasks:\n');
    for (const t of tasks) {
      const metaPath = join(DATA_DIR, t, 'meta.json');
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        console.log(`  ${t.padEnd(30)} ${meta.totalRecords} records, ${meta.iteration} iterations`);
      } else {
        console.log(`  ${t.padEnd(30)} (no data yet)`);
      }
    }
  },

  async new() {
    const name = positional[0];
    if (!name) return usage('new <name>');

    const taskPath = join(TASKS_DIR, `${name}.js`);
    if (existsSync(taskPath)) {
      console.error(`Task already exists: ${taskPath}`);
      process.exit(1);
    }

    const template = `import { Scraper } from '../lib/scraper.js';

/**
 * ${name} — Ingestion Task
 *
 * Created: ${new Date().toISOString().split('T')[0]}
 * Usage: ingest run ${name}
 */
export default class ${name.replace(/-./g, m => m[1].toUpperCase()).replace(/^./, m => m.toUpperCase())}Scraper extends Scraper {
  // Uncomment to inject Chrome cookies for authenticated sites:
  // get cookieDomain() { return '.example.com'; }

  sources() {
    return [
      { name: 'Source', url: 'https://example.com' },
    ];
  }

  async extract(page) {
    // Return an array of record objects from the current page
    return page.evaluate(() => {
      return []; // TODO: implement extraction
    });
  }

  async nextPage(page) {
    // Navigate to next page, return false if no more pages
    if (this.meta.iteration >= 100) return false;
    // TODO: implement pagination
    return false;
  }
}
`;
    writeFileSync(taskPath, template);
    console.log(`Created: ${taskPath}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Edit tasks/${name}.js — set sources(), extract(), nextPage()`);
    console.log(`  2. ingest run ${name}`);
  },

  async status() {
    const taskName = positional[0];
    if (!taskName) return usage('status <task>');

    const metaPath = join(DATA_DIR, taskName, 'meta.json');
    if (!existsSync(metaPath)) {
      console.log(`No data for task "${taskName}"`);
      return;
    }

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    console.log(`Task:       ${meta.task}`);
    console.log(`Iterations: ${meta.iteration}`);
    console.log(`Records:    ${meta.totalRecords}`);
    console.log(`Cursor:     ${meta.cursor || '(done)'}`);
    console.log(`\nHistory:`);
    for (const h of meta.history.slice(-10)) {
      const date = new Date(h.date).toLocaleString();
      console.log(`  #${h.iteration} (${date}): ${h.records} records from ${h.url?.substring(0, 60)}`);
    }
  },
};

function usage(example) {
  console.log(`
  ingest — Browser-based data ingestion CLI

  Commands:
    run <task> [--iterations=N]           Run scraper iterations
    feed <task> [--file=... | stdin]      Feed external JSON records
    report <task>                         Regenerate report
    render <file.md> [output.html]        Convert markdown to HTML

    browse <url> [--domain=...]           Open URL with Chrome session
    cookies <domain>                      Show extracted Chrome cookies

    list                                  List available tasks
    new <name>                            Scaffold a new task
    status <task>                         Show task metadata
  `);
  if (example) console.log(`  Usage: ingest ${example}\n`);
  process.exit(1);
}

if (!cmd || !commands[cmd]) {
  usage();
} else {
  commands[cmd]().catch(err => { console.error(err.message || err); process.exit(1); });
}
