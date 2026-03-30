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
  const cols = schema.map(c => c.name).filter(c => !c.startsWith('_'));
  const select = 'SELECT ' + cols.filter(c => c !== 'source').join(', ') + ' FROM records';

  // Skills: "know X", "X skills", "with X"
  const skillPatterns = [
    /(?:know|knows|with|have|has|using)\s+(\w[\w\s]*?)(?:\s+skills?)?$/i,
    /(\w+)\s+(?:skills?|developers?|engineers?|devs?)/i,
    /(?:skills?\s+(?:like|in|include)\s+)(.+)/i,
  ];
  for (const p of skillPatterns) {
    const m = q.match(p);
    if (m) return select + ` WHERE skills LIKE '%${m[1].trim()}%'`;
  }

  // Company: "at X", "from X", "works at X"
  const coMatch = q.match(/(?:works?\s+at|from|at|company)\s+(.+)/i);
  if (coMatch) return select + ` WHERE company LIKE '%${coMatch[1].trim()}%'`;

  // Location: "in X", "from X city"
  const locMatch = q.match(/\bin\s+([\wáéíóúñ\s]+?)$/i);
  if (locMatch) return select + ` WHERE location LIKE '%${locMatch[1].trim()}%'`;

  // Seniority: "senior", "lead", "manager", etc.
  const senMatch = q.match(/\b(senior|lead|staff|principal|architect|manager|executive|director)\b/i);
  if (senMatch) return select + ` WHERE seniority = '${senMatch[1].toLowerCase()}'`;

  // Group by: "by company", "count", "group"
  if (/group|count|by company/i.test(q)) {
    return `SELECT company, COUNT(*) as count FROM records WHERE company != '' GROUP BY company ORDER BY count DESC`;
  }

  // Name search
  const nameMatch = q.match(/(?:find|show|search)\s+(.+)/i);
  if (nameMatch) {
    const term = nameMatch[1].trim();
    return select + ` WHERE name LIKE '%${term}%' OR title LIKE '%${term}%' OR skills LIKE '%${term}%' OR company LIKE '%${term}%'`;
  }

  // Default: show all
  return select + ' LIMIT 100';
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
          res.writeHead(200);
          res.end(JSON.stringify({ sql, error: 'SQL error: ' + err.message }));
          return;
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
