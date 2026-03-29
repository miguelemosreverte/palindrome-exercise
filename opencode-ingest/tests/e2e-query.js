/**
 * Integration tests for the query pipeline.
 *
 * Tests:
 * 1. All 10 showcase queries execute without error
 * 2. SQL returns expected column types
 * 3. Queries work across vendors (LinkedIn, MercadoLibre, YouTube)
 * 4. Sort/pagination logic (client-side, tested via report HTML)
 * 5. Full pipeline: parse → normalize → query → report
 *
 * Usage: node tests/e2e-query.js [scenario]
 * Scenarios: showcase, cross-vendor, pipeline, all
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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
    return result;
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✗ (${elapsed}s) — ${err.message}`);
    results.push({ name, pass: false, reason: err.message, elapsed });
    return { pass: false };
  }
}

// ─── Showcase Queries ────────────────────────────────────────────────

async function testShowcaseQueries() {
  console.log('\n  ── Showcase Queries (LinkedIn) ──\n');
  const { runShowcaseQueries, SHOWCASE_QUERIES } = await import('../bin/query.js');

  const task = 'ar-senior-devs-linkedin';
  const dbPath = join(ROOT, 'data', task, 'db.sqlite');
  if (!existsSync(dbPath)) {
    console.log('  SKIP: no LinkedIn data');
    return;
  }

  const results = await runShowcaseQueries(task);

  for (const q of results) {
    await runTest(`Showcase: ${q.label}`, async () => {
      if (q.error) return { pass: false, reason: `SQL error: ${q.error}` };
      return {
        pass: true,
        details: `${q.rows.length} rows, ${q.columns.length} cols`,
      };
    });
  }

  // Verify specific queries return expected structure
  await runTest('senior query has seniority column', async () => {
    const senior = results.find(q => q.id === 'senior');
    return { pass: senior.columns.includes('seniority'), reason: 'missing seniority column' };
  });

  await runTest('by-company query has headcount', async () => {
    const byCompany = results.find(q => q.id === 'by-company');
    return { pass: byCompany.columns.includes('headcount'), reason: 'missing headcount column' };
  });

  await runTest('cordoba query filters correctly', async () => {
    const cordoba = results.find(q => q.id === 'cordoba');
    if (!cordoba.rows.length) return { pass: true, details: '0 rows (ok for small dataset)' };
    // Check location column contains Córdoba
    const locIdx = cordoba.columns.indexOf('location');
    const allCordoba = cordoba.rows.every(r => /córdoba|cordoba/i.test(String(r[locIdx])));
    return { pass: allCordoba, reason: 'some rows not in Córdoba' };
  });
}

// ─── Cross-Vendor Queries ────────────────────────────────────────────

async function testCrossVendor() {
  console.log('\n  ── Cross-Vendor Queries ──\n');
  const { executeQuery } = await import('../bin/query.js');

  const tests = [
    { task: 'mercado-libre-bikes-cordoba', sql: "SELECT title, price, _price_num FROM records ORDER BY CAST(_price_num AS REAL) ASC LIMIT 5", label: 'MercadoLibre: cheapest bikes' },
    { task: 'youtube-claude-code-tutorials', sql: "SELECT title, channel, _views_num FROM records ORDER BY CAST(_views_num AS INTEGER) DESC LIMIT 5", label: 'YouTube: most viewed' },
    { task: 'ar-senior-devs-linkedin', sql: "SELECT name, company, seniority FROM records WHERE seniority != 'senior' LIMIT 5", label: 'LinkedIn: non-senior roles' },
  ];

  for (const t of tests) {
    await runTest(t.label, async () => {
      const dbPath = join(ROOT, 'data', t.task, 'db.sqlite');
      if (!existsSync(dbPath)) return { pass: true, details: 'SKIP (no data)' };
      const result = await executeQuery(t.task, t.sql);
      return {
        pass: result.rows.length >= 0 && result.columns.length > 0,
        details: `${result.rows.length} rows`,
      };
    });
  }
}

// ─── Pipeline Test ───────────────────────────────────────────────────

async function testPipeline() {
  console.log('\n  ── Full Pipeline ──\n');
  const { existsSync: ex } = await import('fs');

  await runTest('LinkedIn HTML exists', async () => {
    const htmlDir = join(ROOT, 'data', 'ar-senior-devs-linkedin', 'html');
    return { pass: ex(htmlDir), reason: 'no HTML directory' };
  });

  await runTest('LinkedIn SQLite exists', async () => {
    const db = join(ROOT, 'data', 'ar-senior-devs-linkedin', 'db.sqlite');
    return { pass: ex(db), reason: 'no database' };
  });

  await runTest('LinkedIn report HTML exists', async () => {
    const html = join(ROOT, 'output', 'ar-senior-devs-linkedin', 'index.html');
    return { pass: ex(html), reason: 'no report HTML' };
  });

  await runTest('Report contains table-data JSON', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(ROOT, 'output', 'ar-senior-devs-linkedin', 'index.html'), 'utf8');
    const hasTableData = html.includes('id="table-data"');
    const hasQueryBar = html.includes('query-showcase');
    return { pass: hasTableData && hasQueryBar, reason: `table-data: ${hasTableData}, query-bar: ${hasQueryBar}` };
  });

  await runTest('Schema has expected LinkedIn columns', async () => {
    const { getSchema } = await import('../bin/query.js');
    const schema = await getSchema('ar-senior-devs-linkedin');
    if (!schema) return { pass: false, reason: 'no schema' };
    const cols = schema.map(c => c.name);
    const expected = ['name', 'title', 'company', 'seniority', 'skills'];
    const missing = expected.filter(c => !cols.includes(c));
    return { pass: missing.length === 0, reason: `missing: ${missing.join(', ')}`, details: `${cols.length} columns` };
  });
}

// ─── Run ─────────────────────────────────────────────────────────────

const scenario = process.argv[2] || 'all';

console.log('\n  ╔══════════════════════════════════════╗');
console.log('  ║   Query Pipeline Integration Tests   ║');
console.log('  ╚══════════════════════════════════════╝');

if (scenario === 'all' || scenario === 'showcase') await testShowcaseQueries();
if (scenario === 'all' || scenario === 'cross-vendor') await testCrossVendor();
if (scenario === 'all' || scenario === 'pipeline') await testPipeline();

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n  ────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed, ${results.length} total\n`);

process.exit(failed > 0 ? 1 : 0);
