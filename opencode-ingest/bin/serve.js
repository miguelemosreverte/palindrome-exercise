#!/usr/bin/env node
/**
 * Local query server — serves reports + handles NL→SQL queries.
 *
 * Translates natural language to SQL using OpenCode (localhost:9001),
 * executes against local SQLite, returns results.
 *
 * Usage:
 *   node bin/serve.js [--port=3456]
 *
 * Requires: opencode serve --port=9001 (for NL→SQL translation)
 * Falls back: if OpenCode unavailable, tries simple keyword→SQL mapping
 */

import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3456');
const OC_PORT = parseInt(process.argv.find(a => a.startsWith('--opencode='))?.split('=')[1] || '9001');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// ─── SQL execution ────────────────────────────────────────────────────

async function execSQL(task, sql) {
  const dbPath = join(ROOT, 'data', task, 'db.sqlite');
  if (!existsSync(dbPath)) throw new Error(`No database for task "${task}"`);
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = db.exec(sql);
    if (!result.length) return { columns: [], rows: [] };
    return { columns: result[0].columns, rows: result[0].values };
  } finally { db.close(); }
}

async function getSchema(task) {
  const dbPath = join(ROOT, 'data', task, 'db.sqlite');
  if (!existsSync(dbPath)) return [];
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const info = db.exec("PRAGMA table_info(records)");
    return info.length ? info[0].values.map(r => ({ name: r[1], type: r[2] })) : [];
  } finally { db.close(); }
}

// ─── NL→SQL via OpenCode ──────────────────────────────────────────────

async function nlToSQL(question, schema) {
  // Try fallback first (instant) — it handles most common patterns
  const fallback = fallbackNLtoSQL(question, schema);

  // Try OpenCode in parallel (non-blocking, 15s timeout)
  const ocPromise = (async () => {
    try {
      const session = await fetch(`http://127.0.0.1:${OC_PORT}/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(5000),
      }).then(r => r.json());

      await fetch(`http://127.0.0.1:${OC_PORT}/session/${session.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text:
          `SQLite table "records" columns: ${schema.map(c => c.name).join(', ')}. SQL only, no text:\n"${question}"`
        }] }),
        signal: AbortSignal.timeout(5000),
      });

      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const msgs = await fetch(`http://127.0.0.1:${OC_PORT}/session/${session.id}/message`,
          { signal: AbortSignal.timeout(3000) }).then(r => r.json());
        for (let j = (Array.isArray(msgs) ? msgs : []).length - 1; j >= 0; j--) {
          const m = msgs[j];
          if (m.info?.role !== 'assistant') continue;
          if ((m.parts || []).some(p => p.type === 'step-finish')) {
            const text = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
            const match = text.match(/```sql\n([\s\S]*?)```/) || text.match(/(SELECT\s[\s\S]*?;?)\s*$/i);
            if (match) return match[1].trim();
          }
        }
      }
    } catch {}
    return null;
  })();

  // Race: return OpenCode result if it arrives in 15s, otherwise use fallback
  const oc = await Promise.race([ocPromise, new Promise(r => setTimeout(() => r(null), 15000))]);
  return oc || fallback;
}

function fallbackNLtoSQL(question, schema) {
  const q = question.toLowerCase().trim();
  const S = 'SELECT _id FROM records';

  // Aggregation queries (these need full columns, not just _id)
  if (/group\s+by|count\s+by|by company|by seniority|breakdown|distribution/i.test(q)) {
    if (/company/i.test(q)) return `SELECT company, COUNT(*) as count FROM records WHERE company != '' GROUP BY company ORDER BY count DESC`;
    if (/seniority|level/i.test(q)) return `SELECT seniority, COUNT(*) as count FROM records GROUP BY seniority ORDER BY count DESC`;
    if (/skill/i.test(q)) return `SELECT skills, COUNT(*) as count FROM records WHERE skills != '' GROUP BY skills ORDER BY count DESC`;
    if (/location|city/i.test(q)) return `SELECT location, COUNT(*) as count FROM records GROUP BY location ORDER BY count DESC`;
    return `SELECT company, COUNT(*) as count FROM records WHERE company != '' GROUP BY company ORDER BY count DESC`;
  }

  // Extract the actual search terms — strip filler words
  const stripped = q
    .replace(/\b(show|find|get|list|display|me|all|the|people|who|that|those|which|with|from|please|can you)\b/gi, '')
    .replace(/\s+/g, ' ').trim();

  // Seniority keywords (exact match on known values)
  const seniorityLevels = ['senior', 'lead', 'staff', 'principal', 'architect', 'manager', 'executive', 'director'];
  const senMatch = seniorityLevels.find(s => q.includes(s));

  // "works at <company>" — only if "at" is followed by a proper noun-ish thing
  const atMatch = q.match(/(?:works?\s+at|employed\s+at|at\s+company)\s+([A-Z][\w\s]+)/i);
  if (atMatch && atMatch[1].trim().length > 1) {
    const where = [`company LIKE '%${atMatch[1].trim()}%'`];
    if (senMatch) where.push(`seniority = '${senMatch}'`);
    return S + ' WHERE ' + where.join(' AND ');
  }

  // "in <location>" — only match known Argentine cities/regions
  const locPattern = /\b(?:in|from|located in)\s+(córdoba|cordoba|buenos aires|rosario|mendoza|argentina|tucumán|tucuman|santa fe|mar del plata)/i;
  const locMatch = q.match(locPattern);

  // "know/with <skill>" — skill search
  const skillPatterns = [
    /(?:know|knows|using|use|experience with|skilled in)\s+([\w#.+]+)/i,
    /([\w#.+]+)\s+(?:skills?|developers?|engineers?|devs?|experience)/i,
  ];
  let skillTerm = null;
  for (const p of skillPatterns) {
    const m = q.match(p);
    if (m && m[1].length > 1 && !seniorityLevels.includes(m[1].toLowerCase())) {
      skillTerm = m[1].trim();
      break;
    }
  }

  // Build WHERE clauses
  const where = [];
  if (skillTerm) where.push(`skills LIKE '%${skillTerm}%'`);
  if (locMatch) where.push(`location LIKE '%${locMatch[1]}%'`);
  if (senMatch) where.push(`seniority = '${senMatch}'`);

  if (where.length) return S + ' WHERE ' + where.join(' AND ');

  // Fulltext search on remaining terms — search across all text columns
  if (stripped.length > 1) {
    const terms = stripped.split(/\s+/).filter(t => t.length > 2);
    if (terms.length) {
      const conditions = terms.map(t =>
        `(name LIKE '%${t}%' OR title LIKE '%${t}%' OR skills LIKE '%${t}%' OR company LIKE '%${t}%' OR headline LIKE '%${t}%')`
      );
      return S + ' WHERE ' + conditions.join(' AND ');
    }
  }

  // Default
  return S + ' LIMIT 100';
}

// ─── Server ───────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // API: NL→SQL→results
  if (url.pathname === '/api/query' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { task, question } = JSON.parse(body);
        if (!task || !question) { res.writeHead(400); res.end(JSON.stringify({ error: 'task + question required' })); return; }

        const schema = await getSchema(task);
        if (!schema.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'no database for ' + task })); return; }

        const sql = await nlToSQL(question, schema);
        let result;
        try {
          result = await execSQL(task, sql);
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sql, error: 'SQL error: ' + err.message }));
          return;
        }

        // If query returned _id only, hydrate with full records
        if (result.columns.length === 1 && result.columns[0] === '_id') {
          const ids = result.rows.map(r => r[0]);
          if (ids.length) {
            const fullCols = schema.map(c => c.name).filter(c => c !== 'source');
            const hydrated = await execSQL(task,
              `SELECT ${fullCols.map(c => '"' + c + '"').join(',')} FROM records WHERE _id IN (${ids.join(',')})`)
            result = hydrated;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sql, columns: result.columns, rows: result.rows }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files from output/
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = join(ROOT, 'output', filePath);
  if (existsSync(fullPath)) {
    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(readFileSync(fullPath));
    return;
  }

  // List available reports
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const outputDir = join(ROOT, 'output');
    const tasks = existsSync(outputDir) ? readdirSync(outputDir).filter(d => existsSync(join(outputDir, d, 'index.html'))) : [];
    const links = tasks.map(t => `<li><a href="/${t}/index.html">${t}</a></li>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body style="font-family:sans-serif;padding:2rem"><h1>Reports</h1><ul>${links}</ul></body></html>`);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Reports: http://localhost:${PORT}`);
  console.log(`  Query API: POST http://localhost:${PORT}/api/query`);
  console.log(`  OpenCode: http://127.0.0.1:${OC_PORT}\n`);
});
