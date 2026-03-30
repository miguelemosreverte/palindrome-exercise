#!/usr/bin/env node
/**
 * Two-pass LLM labeling: Extract → Normalize
 *
 * Usage:
 *   node bin/label.js <task>                        # label all
 *   node bin/label.js <task> --limit=10             # first 10 only (iterate)
 *   node bin/label.js <task> --model=qwen-32b       # different model
 *   node bin/label.js <task> --reset                # clear labels, start fresh
 *   node bin/label.js --list-models                 # show model catalog
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const args = process.argv.slice(2);
const task = args.find(a => !a.startsWith('-'));
const model = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'mistral-nemo';
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const offset = parseInt(args.find(a => a.startsWith('--offset='))?.split('=')[1] || '0');
const reset = args.includes('--reset');
const listModels = args.includes('--list-models');

if (listModels || !task) {
  const { MODELS } = await import('../vendors/linkedin/label.js');
  console.log('\n  Models:\n');
  for (const [key, m] of Object.entries(MODELS)) {
    console.log(`    ${key.padEnd(18)} ${m.cost.padEnd(12)} ${m.id}`);
  }
  if (!task) console.log('\n  Usage: node bin/label.js <task> [--limit=10] [--model=mistral-nemo] [--reset]\n');
  process.exit(0);
}

const dbPath = join(ROOT, 'data', task, 'db.sqlite');
if (!existsSync(dbPath)) { console.error(`No database: ${dbPath}`); process.exit(1); }

// Reset if requested
if (reset) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  for (const col of ['_labeled', 'raw_labels', 'domain', 'seniority_level', 'seniority_score', 'city', 'skills_normalized']) {
    try { db.run(`UPDATE records SET "${col}" = NULL`); } catch {}
  }
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  console.log('Labels reset.');
}

// Load API key
let apiKey = process.env.CHUTESAI_API_KEY;
if (!apiKey) {
  try { apiKey = readFileSync(join(ROOT, '..', '.env'), 'utf8').match(/CHUTESAI_API_KEY=(.+)/)?.[1]?.trim(); } catch {}
}

const { labelRecords } = await import('../vendors/linkedin/label.js');
const start = Date.now();
const count = await labelRecords(dbPath, { model, apiKey, limit, offset });
console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
