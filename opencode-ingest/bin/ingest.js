#!/usr/bin/env node

/**
 * ingest — Browser-based data ingestion CLI.
 *
 * `ingest run <task>` does everything:
 *   1. Fetch — save HTML per URL (skip URLs already in DB unless --refetch)
 *   2. Parse — HTML → structured records (vendor's parse.js)
 *   3. Clean — normalize records (vendor's clean.js)
 *   4. Store — records → SQLite
 *   5. Report — SQLite → HTML report
 *
 * The URL is the primary key. Re-running adds new pages, skips known ones.
 * Reports are the deliverable. SQLite/JSONL are side effects.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TASKS_DIR = join(ROOT, 'tasks');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT_DIR = join(ROOT, 'output');

const [cmd, ...args] = process.argv.slice(2);
const getFlag = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const hasFlag = (name) => args.some(a => a === `--${name}`);
const positional = args.filter(a => !a.startsWith('--'));

// ─── Vendor resolution ────────────────────────────────────────────────

function vendorForTask(taskName) {
  const n = taskName.toLowerCase();
  if (n.includes('linkedin') || n.includes('devs')) return 'linkedin';
  if (n.includes('mercado')) return 'mercadolibre';
  if (n.includes('youtube') || n.includes('video')) return 'youtube';
  if (n.includes('github')) return 'github';
  return null;
}

async function loadVendor(taskName) {
  const vendor = vendorForTask(taskName);
  if (!vendor) return {};
  const base = join(ROOT, 'vendors', vendor);
  const mods = {};
  try { mods.parse = await import(join(base, 'parse.js')); } catch {}
  try { mods.clean = await import(join(base, 'clean.js')); } catch {}
  return mods;
}

// ─── Parse pipeline (offline: HTML → clean records → JSONL) ───────────

async function parseTask(taskName) {
  const dataDir = join(DATA_DIR, taskName);
  const htmlDir = join(dataDir, 'html');
  const rawDir = join(dataDir, 'raw');
  if (!existsSync(htmlDir)) return 0;

  const vendor = await loadVendor(taskName);
  if (!vendor.parse) return 0;

  const htmlFiles = readdirSync(htmlDir).filter(f => f.endsWith('.html')).sort();
  if (!htmlFiles.length) return 0;
  mkdirSync(rawDir, { recursive: true });

  const vendorName = vendorForTask(taskName);
  const readFile = (f) => readFileSync(join(htmlDir, f), 'utf8');
  const cleaner = vendor.clean?.clean || ((r) => r);

  let allRecords;

  if (vendorName === 'linkedin' && vendor.parse.parseAll) {
    // LinkedIn: each HTML is one profile
    allRecords = vendor.parse.parseAll(htmlFiles, readFile).map(cleaner).filter(r => !r._deleted);
  } else if (vendor.parse.parsePage) {
    // Page-based vendors: each HTML is one search results page
    allRecords = [];
    for (const f of htmlFiles) {
      const records = vendor.parse.parsePage(readFile(f), f).map(cleaner).filter(r => !r._deleted);
      allRecords.push(...records);
    }
  } else {
    return 0;
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = allRecords.filter(r => {
    const key = r.url || r.profileUrl || r.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Write single JSONL
  const rawFile = join(rawDir, 'records.jsonl');
  writeFileSync(rawFile, unique.map(r => JSON.stringify(r)).join('\n') + '\n');

  // Clean up old numbered JSONL files
  for (const f of readdirSync(rawDir).filter(f => f !== 'records.jsonl' && f.endsWith('.jsonl'))) {
    unlinkSync(join(rawDir, f));
  }

  // Update meta
  const metaPath = join(dataDir, 'meta.json');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.totalRecords = unique.length;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  console.log(`[${taskName}] Parsed ${unique.length} records from ${htmlFiles.length} HTML files`);
  return unique.length;
}

// ─── Normalize (JSONL → SQLite) ───────────────────────────────────────

async function normalizeTask(taskName) {
  const { normalize } = await import('./normalize.js');
  await normalize(taskName, join(DATA_DIR, taskName));
}

// ─── Report (SQLite → HTML) ──────────────────────────────────────────

async function reportTask(taskName) {
  const { generateReport } = await import('./report.js');
  const { md2html } = await import('./md2html.js');
  const outputDir = join(OUTPUT_DIR, taskName);
  mkdirSync(outputDir, { recursive: true });
  const mdPath = await generateReport(taskName);
  if (mdPath) md2html(mdPath, join(outputDir, 'index.html'));
}

// ─── Commands ─────────────────────────────────────────────────────────

const commands = {
  async run() {
    const taskName = positional[0];
    const iterations = parseInt(getFlag('iterations') || '1', 10);
    const refetch = hasFlag('refetch');
    if (!taskName) return usage('run <task> [--iterations=N] [--refetch]');

    const taskPath = join(TASKS_DIR, `${taskName}.js`);
    if (!existsSync(taskPath)) {
      console.error(`Task not found: ${taskPath}\nRun 'ingest list' or 'ingest new ${taskName}'`);
      process.exit(1);
    }

    const dataDir = join(DATA_DIR, taskName);
    mkdirSync(dataDir, { recursive: true });

    // 1. Fetch — save HTML (skip known URLs unless --refetch)
    const { default: TaskScraper } = await import(taskPath);
    const scraper = new TaskScraper(taskName, dataDir);

    for (let i = 0; i < iterations; i++) {
      if (scraper.isDone && !refetch) { console.log(`[${taskName}] All pages fetched.`); break; }
      console.log(`\n── Fetch ${i + 1}/${iterations} ──`);
      const result = await scraper.next();
      console.log(`[${taskName}] Got ${result.records.length} records. Has more: ${result.hasNext}`);
      if (!result.hasNext) break;
    }

    // 2-3. Parse + Clean (offline from HTML)
    await parseTask(taskName);

    // 4. Normalize → SQLite
    const dbPath = join(dataDir, 'db.sqlite');
    if (existsSync(dbPath)) unlinkSync(dbPath);
    await normalizeTask(taskName);

    // 5. Report → HTML
    await reportTask(taskName);

    console.log(`\nDone! View: output/${taskName}/index.html`);
  },

  async parse() {
    const taskName = positional[0];
    if (!taskName) return usage('parse <task|all>  — re-extract from saved HTML');

    const tasks = taskName === 'all'
      ? readdirSync(TASKS_DIR).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''))
      : [taskName];

    for (const t of tasks) {
      await parseTask(t);
      const dbPath = join(DATA_DIR, t, 'db.sqlite');
      if (existsSync(dbPath)) unlinkSync(dbPath);
      await normalizeTask(t);
      await reportTask(t);
    }
  },

  async report() {
    const taskName = positional[0];
    if (!taskName) return usage('report <task>');
    await reportTask(taskName);
  },

  async render() {
    const input = positional[0];
    const output = positional[1] || input?.replace('.md', '.html');
    if (!input) return usage('render <file.md> [output.html]');
    const { md2html } = await import('./md2html.js');
    md2html(input, output);
  },

  async browse() {
    const url = positional[0];
    const domain = getFlag('domain');
    if (!url) return usage('browse <url> [--domain=.example.com]');
    const { createBrowser } = await import('../lib/browser.js');
    const { page } = await createBrowser({ domain, headless: false });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`Browser open. Ctrl+C to close.`);
    await new Promise(() => {});
  },

  async cookies() {
    const domain = positional[0];
    if (!domain) return usage('cookies <domain>');
    const { getChromeCookes } = await import('../lib/chrome-cookies.js');
    const cookies = await getChromeCookes(domain);
    for (const c of cookies) console.log(`  ${c.name.padEnd(30)} ${c.value.substring(0, 60)}`);
    console.log(`\n${cookies.length} cookies`);
  },

  async list() {
    const tasks = readdirSync(TASKS_DIR).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
    console.log('Tasks:\n');
    for (const t of tasks) {
      const metaPath = join(DATA_DIR, t, 'meta.json');
      if (existsSync(metaPath)) {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        const htmlDir = join(DATA_DIR, t, 'html');
        const htmlCount = existsSync(htmlDir) ? readdirSync(htmlDir).filter(f => f.endsWith('.html')).length : 0;
        console.log(`  ${t.padEnd(35)} ${meta.totalRecords} records, ${htmlCount} pages saved`);
      } else {
        console.log(`  ${t.padEnd(35)} (no data)`);
      }
    }
  },

  async ['new']() {
    const name = positional[0];
    if (!name) return usage('new <name>');
    const taskPath = join(TASKS_DIR, `${name}.js`);
    if (existsSync(taskPath)) { console.error(`Already exists: ${taskPath}`); process.exit(1); }

    writeFileSync(taskPath, `import { Scraper } from '../lib/scraper.js';

// ${name} — created ${new Date().toISOString().split('T')[0]}
// Usage: ingest run ${name}
export default class extends Scraper {
  sources() { return [{ name: 'Source', url: 'https://example.com' }]; }
  async extract(page) { return []; }
  async nextPage(page) { return false; }
}
`);
    console.log(`Created: tasks/${name}.js`);
  },

  async status() {
    const taskName = positional[0];
    if (!taskName) return usage('status <task>');
    const metaPath = join(DATA_DIR, taskName, 'meta.json');
    if (!existsSync(metaPath)) { console.log(`No data for "${taskName}"`); return; }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const htmlDir = join(DATA_DIR, taskName, 'html');
    const htmlCount = existsSync(htmlDir) ? readdirSync(htmlDir).filter(f => f.endsWith('.html')).length : 0;
    console.log(`Task:       ${meta.task}`);
    console.log(`Records:    ${meta.totalRecords}`);
    console.log(`HTML pages: ${htmlCount}`);
    console.log(`Iterations: ${meta.iteration}`);
    console.log(`Cursor:     ${meta.cursor || '(done)'}`);
    if (meta.history?.length) {
      console.log(`\nLast 5:`);
      for (const h of meta.history.slice(-5)) {
        console.log(`  #${h.iteration} ${new Date(h.date).toLocaleString()} — ${h.records} records`);
      }
    }
  },
};

function usage(example) {
  console.log(`
  ingest — Browser-based data ingestion CLI

  Commands:
    run <task> [--iterations=N] [--refetch]   Fetch + parse + report
    parse <task|all>                          Re-parse saved HTML → report
    report <task>                             Regenerate report only
    render <file.md> [output.html]            Markdown → HTML

    browse <url> [--domain=...]               Open URL with Chrome session
    cookies <domain>                          Show Chrome cookies

    list                                      Available tasks
    new <name>                                Scaffold task
    status <task>                             Show task info
  `);
  if (example) console.log(`  Usage: ingest ${example}\n`);
  process.exit(1);
}

if (!cmd || !commands[cmd]) usage();
else commands[cmd]().catch(err => { console.error(err.message || err); process.exit(1); });
