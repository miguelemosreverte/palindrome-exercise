#!/usr/bin/env node
/**
 * Label records using LLM.
 *
 * Usage:
 *   node bin/label.js <task> [--model=mistral-nemo] [--list-models]
 *
 * Models: mistral-nemo (default), mistral-small, gemma-4b, hermes-14b,
 *         qwen-32b, deephermes, opencode-nemotron, opencode-bigpickle
 *
 * Env: CHUTESAI_API_KEY for ChutesAI models
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const task = args.find(a => !a.startsWith('-'));
const model = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'mistral-nemo';
const listModels = args.includes('--list-models');

if (listModels || !task) {
  const { MODELS } = await import('../vendors/linkedin/label.js');
  console.log('\n  Available models:\n');
  for (const [key, m] of Object.entries(MODELS)) {
    const marker = key === 'mistral-nemo' ? ' (default)' : '';
    console.log(`    ${key.padEnd(22)} ${m.provider.padEnd(10)} ${m.cost}${marker}`);
  }
  if (!task) {
    console.log('\n  Usage: node bin/label.js <task> [--model=mistral-nemo]\n');
  }
  process.exit(0);
}

const dbPath = join(ROOT, 'data', task, 'db.sqlite');
if (!existsSync(dbPath)) {
  console.error(`No database for task "${task}". Run: node bin/ingest.js parse ${task}`);
  process.exit(1);
}

// Load API key
let apiKey = process.env.CHUTESAI_API_KEY;
if (!apiKey) {
  try {
    const env = readFileSync(join(ROOT, '..', '.env'), 'utf8');
    const match = env.match(/CHUTESAI_API_KEY=(.+)/);
    apiKey = match?.[1]?.trim();
  } catch {}
}

const { labelRecords } = await import('../vendors/linkedin/label.js');

const start = Date.now();
const count = await labelRecords(dbPath, model, {
  apiKey,
  openCodePort: parseInt(args.find(a => a.startsWith('--opencode='))?.split('=')[1] || '9001'),
});

console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s. Labeled ${count} records.`);
console.log(`Now run: node bin/ingest.js report ${task}`);
