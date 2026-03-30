/**
 * Worker loop: dequeue jobs from the queue, run the ingest pipeline, reschedule.
 *
 * Each worker:
 *  1. Dequeue next pending job
 *  2. Run: fetch (1 iteration) -> parse -> normalize -> report
 *  3. Complete (reschedule if recurring) or fail (with backoff)
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TASKS_DIR = join(ROOT, 'tasks');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT_DIR = join(ROOT, 'output');

/**
 * Run the full pipeline for a task. Returns { records }.
 */
export async function runPipeline(taskName) {
  const taskPath = join(TASKS_DIR, `${taskName}.js`);
  if (!existsSync(taskPath)) throw new Error(`Task not found: ${taskName}`);

  const dataDir = join(DATA_DIR, taskName);
  mkdirSync(dataDir, { recursive: true });

  // 1. Fetch — one iteration
  const { default: TaskScraper } = await import(taskPath);
  const scraper = new TaskScraper(taskName, dataDir);
  let fetchedRecords = 0;

  if (!scraper.isDone) {
    const result = await scraper.next();
    fetchedRecords = result.records.length;
    console.log(`[worker][${taskName}] Fetched ${fetchedRecords} records`);
  } else {
    console.log(`[worker][${taskName}] All pages already fetched, skipping fetch`);
  }

  // 2. Parse (HTML -> JSONL)
  const records = await parseTask(taskName);

  // 3. Normalize (JSONL -> SQLite)
  const dbPath = join(dataDir, 'db.sqlite');
  if (existsSync(dbPath)) unlinkSync(dbPath);
  const { normalize } = await import('../bin/normalize.js');
  await normalize(taskName, dataDir);

  // 4. Report (SQLite -> HTML)
  try {
    const { generateReport } = await import('../bin/report.js');
    const { md2html } = await import('../bin/md2html.js');
    const outputDir = join(OUTPUT_DIR, taskName);
    mkdirSync(outputDir, { recursive: true });
    const mdPath = await generateReport(taskName);
    if (mdPath) md2html(mdPath, join(outputDir, 'index.html'));
  } catch (e) {
    console.log(`[worker][${taskName}] Report generation skipped: ${e.message}`);
  }

  return { records };
}

/**
 * Parse task (copied from ingest.js to avoid CLI entrypoint issues)
 */
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
    allRecords = vendor.parse.parseAll(htmlFiles, readFile).map(cleaner).filter(r => !r._deleted);
  } else if (vendor.parse.parsePage) {
    allRecords = [];
    for (const f of htmlFiles) {
      const records = vendor.parse.parsePage(readFile(f), f).map(cleaner).filter(r => !r._deleted);
      allRecords.push(...records);
    }
  } else {
    return 0;
  }

  // Deduplicate
  const seen = new Set();
  const unique = allRecords.filter(r => {
    const key = r.url || r.profileUrl || r.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rawFile = join(rawDir, 'records.jsonl');
  writeFileSync(rawFile, unique.map(r => JSON.stringify(r)).join('\n') + '\n');

  // Clean up old numbered JSONL
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

  console.log(`[worker][${taskName}] Parsed ${unique.length} records from ${htmlFiles.length} HTML files`);
  return unique.length;
}

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

/**
 * Start a worker loop. Polls the queue, runs jobs.
 * @param {JobQueue} queue
 * @param {number} workerId
 * @param {AbortSignal} signal
 */
export async function workerLoop(queue, workerId, signal) {
  console.log(`[worker-${workerId}] Started`);

  while (!signal?.aborted) {
    const job = queue.dequeue();

    if (!job) {
      // No work — wait 5 seconds
      await sleep(5000, signal);
      continue;
    }

    console.log(`[worker-${workerId}] Running job #${job.id}: ${job.task}`);
    const start = Date.now();

    try {
      const result = await runPipeline(job.task);
      const durationMs = Date.now() - start;
      queue.complete(job.id, { durationMs, records: result.records || 0 });
      console.log(`[worker-${workerId}] Job #${job.id} done in ${(durationMs / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`[worker-${workerId}] Job #${job.id} failed: ${err.message}`);
      queue.fail(job.id, err.message);
    }
  }

  console.log(`[worker-${workerId}] Stopped`);
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
