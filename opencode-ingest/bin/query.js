/**
 * Query engine — runs showcase queries against SQLite and returns results.
 * Used by report.js to pre-compute results for the static HTML.
 * Used by the API endpoint for live queries.
 */

import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Showcase queries — 10 natural language → SQL examples */
export const SHOWCASE_QUERIES = [
  { id: 'senior', label: 'Show all senior engineers', sql: "SELECT name, title, company, location, skills, seniority, profileUrl, photo FROM records WHERE seniority = 'senior'" },
  { id: 'mercadolibre', label: 'Who works at Mercado Libre?', sql: "SELECT name, title, company, skills, profileUrl, photo FROM records WHERE company LIKE '%Mercado Libre%' OR company LIKE '%MercadoLibre%'" },
  { id: 'python', label: 'Developers with Python skills', sql: "SELECT name, title, company, skills, profileUrl, photo FROM records WHERE skills LIKE '%Python%'" },
  { id: 'by-company', label: 'Group by company, count employees', sql: "SELECT company, COUNT(*) as headcount FROM records WHERE company != '' AND length(company) > 2 GROUP BY company ORDER BY headcount DESC" },
  { id: 'connected', label: 'Top 10 most connected people', sql: "SELECT name, company, title, connections, profileUrl, photo FROM records ORDER BY CAST(connections AS INTEGER) DESC LIMIT 10" },
  { id: 'leads', label: 'Architects and leads only', sql: "SELECT name, title, company, skills, seniority, profileUrl, photo FROM records WHERE seniority IN ('architect', 'lead')" },
  { id: 'cordoba', label: 'People in Córdoba', sql: "SELECT name, title, company, location, profileUrl, photo FROM records WHERE location LIKE '%Córdoba%' OR location LIKE '%Cordoba%'" },
  { id: 'managers', label: 'Managers and executives', sql: "SELECT name, title, company, seniority, profileUrl, photo FROM records WHERE seniority IN ('manager', 'executive')" },
  { id: 'java-scala', label: 'People with Java or Scala skills', sql: "SELECT name, title, company, skills, profileUrl, photo FROM records WHERE skills LIKE '%Java%' OR skills LIKE '%Scala%'" },
  { id: 'big-companies', label: 'Companies with 3+ people', sql: "SELECT company, COUNT(*) as headcount, GROUP_CONCAT(name, ', ') as people FROM records WHERE company != '' AND length(company) > 2 GROUP BY company HAVING headcount >= 3 ORDER BY headcount DESC" },
];

/**
 * Execute a SQL query against a task's SQLite database.
 * @returns {{ columns: string[], rows: any[][], sql: string }}
 */
export async function executeQuery(taskName, sql) {
  const dbPath = join(ROOT, 'data', taskName, 'db.sqlite');
  if (!existsSync(dbPath)) throw new Error(`No database for task "${taskName}"`);

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));

  try {
    const result = db.exec(sql);
    if (!result.length) return { columns: [], rows: [], sql };
    return {
      columns: result[0].columns,
      rows: result[0].values,
      sql,
    };
  } finally {
    db.close();
  }
}

/**
 * Run all showcase queries and return pre-computed results.
 */
export async function runShowcaseQueries(taskName) {
  const results = [];
  for (const q of SHOWCASE_QUERIES) {
    try {
      const result = await executeQuery(taskName, q.sql);
      results.push({ ...q, columns: result.columns, rows: result.rows, error: null });
    } catch (err) {
      results.push({ ...q, columns: [], rows: [], error: err.message });
    }
  }
  return results;
}

/**
 * Get the schema of a task's database (for NL→SQL translation context).
 */
export async function getSchema(taskName) {
  const dbPath = join(ROOT, 'data', taskName, 'db.sqlite');
  if (!existsSync(dbPath)) return null;

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const info = db.exec("PRAGMA table_info(records)");
    if (!info.length) return null;
    return info[0].values.map(r => ({ name: r[1], type: r[2] }));
  } finally {
    db.close();
  }
}

// CLI: node bin/query.js <task> [query-id|sql]
if (process.argv[1]?.endsWith('query.js') && process.argv[2]) {
  const task = process.argv[2];
  const arg = process.argv.slice(3).join(' ');

  if (!arg || arg === 'showcase') {
    const results = await runShowcaseQueries(task);
    for (const r of results) {
      console.log(`\n  ${r.label}`);
      console.log(`  SQL: ${r.sql}`);
      console.log(`  → ${r.rows.length} rows, ${r.columns.length} columns${r.error ? ` ERROR: ${r.error}` : ''}`);
    }
  } else {
    const showcase = SHOWCASE_QUERIES.find(q => q.id === arg);
    const sql = showcase ? showcase.sql : arg;
    const result = await executeQuery(task, sql);
    console.log(`Columns: ${result.columns.join(', ')}`);
    console.log(`Rows: ${result.rows.length}`);
    for (const row of result.rows.slice(0, 10)) {
      console.log(`  ${row.map(v => String(v || '').substring(0, 40)).join(' | ')}`);
    }
  }
}
