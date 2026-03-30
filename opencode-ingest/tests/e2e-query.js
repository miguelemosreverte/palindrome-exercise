#!/usr/bin/env node
/**
 * Integration tests for the query pipeline.
 *
 * Three test suites:
 *   1. offline   — Showcase queries against local SQLite (no network)
 *   2. live      — NL→SQL via OpenCode API (needs server)
 *   3. pipeline  — Full pipeline validation (HTML, DB, report)
 *
 * Usage:
 *   node tests/e2e-query.js                # run all offline + pipeline
 *   node tests/e2e-query.js live           # run NL→SQL via OpenCode
 *   node tests/e2e-query.js --rebuild      # re-fetch live cache
 *   node tests/e2e-query.js showcase       # run only showcase tests
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(__dirname, 'query-cache');
const OC = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';

mkdirSync(CACHE_DIR, { recursive: true });

const REBUILD = process.argv.includes('--rebuild');
const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const scenario = args[0] || 'all';

const results = [];

async function runTest(name, fn) {
  const start = Date.now();
  process.stdout.write(`  ${name} ... `);
  try {
    const result = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (result.pass) {
      console.log(`✓ (${elapsed}s)${result.details ? ' — ' + result.details : ''}`);
    } else {
      console.log(`✗ (${elapsed}s) — ${result.reason}`);
    }
    results.push({ name, ...result, elapsed });
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✗ (${elapsed}s) — ${err.message}`);
    results.push({ name, pass: false, reason: err.message, elapsed });
  }
}

// ─── OpenCode API helpers ────────────────────────────────────────────

async function askOpenCode(prompt, cacheKey) {
  const cachePath = join(CACHE_DIR, cacheKey + '.json');
  if (!REBUILD && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }

  const session = await fetch(OC + '/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => r.json());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    await fetch(OC + '/session/' + session.id + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }

  // Poll for response
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const msgs = await fetch(OC + '/session/' + session.id + '/message').then(r => r.json());
    for (let j = (Array.isArray(msgs) ? msgs : []).length - 1; j >= 0; j--) {
      const m = msgs[j];
      if (m.info?.role !== 'assistant') continue;
      const parts = m.parts || [];
      if (parts.some(p => p.type === 'step-finish')) {
        const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
        const result = { text, sessionId: session.id };
        writeFileSync(cachePath, JSON.stringify(result, null, 2));
        return result;
      }
    }
  }
  throw new Error('Timeout waiting for OpenCode response');
}

function extractSQL(text) {
  // Look for SQL in code blocks
  const match = text.match(/```sql\n([\s\S]*?)```/);
  if (match) return match[1].trim();
  // Or inline SELECT
  const select = text.match(/(SELECT\s[\s\S]*?(?:;|$))/i);
  return select ? select[1].trim() : null;
}

// ─── Suite 1: Offline Showcase Queries ───────────────────────────────

async function testShowcase() {
  console.log('\n  ── Showcase Queries (offline) ──\n');

  const { runShowcaseQueries, SHOWCASE_QUERIES, getSchema } = await import(join(ROOT, 'bin', 'query.js'));
  const task = 'ar-senior-devs-linkedin';
  const dbPath = join(ROOT, 'data', task, 'db.sqlite');
  if (!existsSync(dbPath)) { console.log('  SKIP: no LinkedIn data'); return; }

  const queryResults = await runShowcaseQueries(task);

  for (const q of queryResults) {
    await runTest(`${q.label}`, async () => {
      if (q.error) return { pass: false, reason: q.error };
      return { pass: true, details: `${q.rows.length} rows` };
    });
  }

  await runTest('Córdoba filter correctness', async () => {
    const q = queryResults.find(q => q.id === 'cordoba');
    if (!q.rows.length) return { pass: true, details: '0 rows (ok)' };
    const locIdx = q.columns.indexOf('location');
    const all = q.rows.every(r => /córdoba|cordoba/i.test(String(r[locIdx])));
    return { pass: all, reason: 'non-Córdoba rows in result' };
  });

  await runTest('Company grouping has headcount', async () => {
    const q = queryResults.find(q => q.id === 'by-company');
    return { pass: q.columns.includes('headcount'), reason: 'missing headcount' };
  });

  await runTest('Schema has name, title, company, skills', async () => {
    const schema = await getSchema(task);
    const cols = schema.map(c => c.name);
    const need = ['name', 'title', 'company', 'skills', 'seniority'];
    const missing = need.filter(c => !cols.includes(c));
    return { pass: !missing.length, reason: `missing: ${missing}`, details: `${cols.length} columns` };
  });
}

// ─── Suite 2: Cross-Vendor ───────────────────────────────────────────

async function testCrossVendor() {
  console.log('\n  ── Cross-Vendor Queries ──\n');

  const { executeQuery } = await import(join(ROOT, 'bin', 'query.js'));

  const tests = [
    { task: 'mercado-libre-bikes-cordoba', sql: "SELECT title, price, _price_num FROM records WHERE _price_num > 0 ORDER BY CAST(_price_num AS REAL) ASC LIMIT 5", name: 'MercadoLibre: 5 cheapest bikes' },
    { task: 'mercado-libre-bikes-cordoba', sql: "SELECT AVG(CAST(_price_num AS REAL)) as avg_price, MIN(CAST(_price_num AS REAL)) as min_price, MAX(CAST(_price_num AS REAL)) as max_price FROM records WHERE _price_num > 0", name: 'MercadoLibre: price stats' },
    { task: 'youtube-claude-code-tutorials', sql: "SELECT title, channel, _views_num FROM records ORDER BY CAST(_views_num AS INTEGER) DESC LIMIT 5", name: 'YouTube: top 5 by views' },
    { task: 'youtube-claude-code-tutorials', sql: "SELECT channel, COUNT(*) as videos, SUM(CAST(_views_num AS INTEGER)) as total_views FROM records GROUP BY channel ORDER BY total_views DESC LIMIT 5", name: 'YouTube: top channels' },
    { task: 'ar-senior-devs-linkedin', sql: "SELECT seniority, COUNT(*) as n FROM records GROUP BY seniority ORDER BY n DESC", name: 'LinkedIn: seniority breakdown' },
  ];

  for (const t of tests) {
    await runTest(t.name, async () => {
      const dbPath = join(ROOT, 'data', t.task, 'db.sqlite');
      if (!existsSync(dbPath)) return { pass: true, details: 'SKIP' };
      const r = await executeQuery(t.task, t.sql);
      return { pass: r.columns.length > 0, details: `${r.rows.length} rows` };
    });
  }
}

// ─── Suite 3: Pipeline Validation ────────────────────────────────────

async function testPipeline() {
  console.log('\n  ── Pipeline Validation ──\n');

  const tasks = ['ar-senior-devs-linkedin', 'mercado-libre-bikes-cordoba', 'youtube-claude-code-tutorials'];

  for (const task of tasks) {
    await runTest(`${task}: HTML saved`, async () => {
      const dir = join(ROOT, 'data', task, 'html');
      return { pass: existsSync(dir), reason: 'no html/' };
    });

    await runTest(`${task}: SQLite exists`, async () => {
      return { pass: existsSync(join(ROOT, 'data', task, 'db.sqlite')), reason: 'no db' };
    });

    await runTest(`${task}: report HTML`, async () => {
      const html = join(ROOT, 'output', task, 'index.html');
      if (!existsSync(html)) return { pass: false, reason: 'no report' };
      const content = readFileSync(html, 'utf8');
      const hasData = content.includes('table-data') || content.includes('data-root') || content.includes('grid-cards') || content.includes('feed');
      return { pass: hasData, details: `${Math.round(content.length / 1024)}KB` };
    });
  }
}

// ─── Suite 4: Live NL→SQL (via OpenCode API) ─────────────────────────

async function testLiveNLSQL() {
  console.log('\n  ── Live NL→SQL (OpenCode API) ──\n');

  const { executeQuery, getSchema } = await import(join(ROOT, 'bin', 'query.js'));
  const schema = await getSchema('ar-senior-devs-linkedin');
  if (!schema) { console.log('  SKIP: no schema'); return; }

  const schemaStr = schema.map(c => `${c.name} (${c.type})`).join(', ');

  const nlQueries = [
    { q: 'Find all people who work at companies with "Tech" in the name', key: 'nl-tech-companies' },
    { q: 'Show me the top 5 most common job titles', key: 'nl-top-titles' },
    { q: 'List people sorted by number of skills (most skills first)', key: 'nl-most-skills' },
    { q: 'Find people whose headline mentions "full stack" or "fullstack"', key: 'nl-fullstack' },
    { q: 'Count how many people are in each city', key: 'nl-by-city' },
  ];

  for (const { q, key } of nlQueries) {
    await runTest(`NL→SQL: ${q}`, async () => {
      const prompt = `You have a SQLite table called "records" with these columns: ${schemaStr}.

Translate this natural language query to SQL. Return ONLY the SQL in a \`\`\`sql code block. Nothing else.

Query: "${q}"`;

      const response = await askOpenCode(prompt, key);
      const sql = extractSQL(response.text);
      if (!sql) return { pass: false, reason: 'no SQL extracted from response' };

      // Try executing it
      try {
        const result = await executeQuery('ar-senior-devs-linkedin', sql);
        return { pass: true, details: `${result.rows.length} rows — ${sql.substring(0, 60)}...` };
      } catch (err) {
        return { pass: false, reason: `SQL error: ${err.message}. Generated: ${sql}` };
      }
    });
  }
}

// ─── Run ─────────────────────────────────────────────────────────────

console.log('\n  ╔══════════════════════════════════════╗');
console.log('  ║   Query Pipeline Integration Tests   ║');
console.log('  ╚══════════════════════════════════════╝');

if (['all', 'showcase'].includes(scenario)) await testShowcase();
if (['all', 'cross-vendor'].includes(scenario)) await testCrossVendor();
if (['all', 'pipeline'].includes(scenario)) await testPipeline();
if (['live', 'nl'].includes(scenario)) await testLiveNLSQL();

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n  ────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed, ${results.length} total\n`);

process.exit(failed > 0 ? 1 : 0);
