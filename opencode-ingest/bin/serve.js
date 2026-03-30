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

async function nlToSQL(question, schema, task) {
  // Expand abbreviations once
  const expanded = expandAbbreviations(question.replace(/\b(meaning|specifically)\b.*/i, '').trim());

  // Try fallback first (instant)
  const fallback = fallbackNLtoSQL(expanded, schema);

  // Try OpenCode with iterative refinement (async, 30s budget)
  const ocPromise = ocIterativeSQL(expanded, schema, fallback, task);
  const oc = await Promise.race([ocPromise, new Promise(r => setTimeout(() => r(null), 30000))]);
  return oc || fallback;
}

/** Send a message to an OpenCode session and wait for response */
async function ocSend(sessionId, text, timeoutMs = 15000) {
  await fetch(`http://127.0.0.1:${OC_PORT}/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    signal: AbortSignal.timeout(5000),
  });

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));
    const msgs = await fetch(`http://127.0.0.1:${OC_PORT}/session/${sessionId}/message`,
      { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    for (let j = (Array.isArray(msgs) ? msgs : []).length - 1; j >= 0; j--) {
      const m = msgs[j];
      if (m.info?.role !== 'assistant') continue;
      if ((m.parts || []).some(p => p.type === 'step-finish')) {
        return (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
      }
    }
  }
  return null;
}

function extractSQLFromText(text) {
  if (!text) return null;
  const match = text.match(/```sql\n([\s\S]*?)```/) || text.match(/(SELECT\s[\s\S]*?;?)\s*$/im);
  return match ? (match[1] || match[0]).trim().replace(/;$/, '') : null;
}

/** Iterative NL→SQL: generate, execute, review results, refine if bad */
async function ocIterativeSQL(question, schema, fallbackSQL, task) {
  try {
    const session = await fetch(`http://127.0.0.1:${OC_PORT}/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.timeout(5000),
    }).then(r => r.json());

    const colNames = schema.map(c => c.name).filter(c => !c.startsWith('_'));
    const sampleRows = await execSQL(task,
      `SELECT ${colNames.slice(0, 6).map(c => '"' + c + '"').join(',')} FROM records LIMIT 3`
    ).catch(() => ({ rows: [] }));

    const sampleStr = sampleRows.rows?.slice(0, 3).map(r => r.join(' | ')).join('\n') || '(no sample)';

    // Round 1: generate SQL
    const prompt1 = `SQLite table "records" with columns: ${colNames.join(', ')}

Sample data:
${sampleStr}

IMPORTANT:
- "sr" or "Sr" means "senior" (abbreviation), NOT a skill
- "devs" means developers/engineers
- Return ONLY a \`\`\`sql code block. SELECT _id FROM records WHERE ...

User query: "${question}"`;

    const resp1 = await ocSend(session.id, prompt1, 15000);
    const sql1 = extractSQLFromText(resp1);
    if (!sql1) return null;

    // Execute it
    let result1;
    try {
      result1 = await execSQL(task, sql1);
    } catch (err) {
      // SQL error — ask OpenCode to fix
      const resp2 = await ocSend(session.id,
        `That SQL failed: ${err.message}. Fix it. Return ONLY \`\`\`sql.`, 10000);
      return extractSQLFromText(resp2) || null;
    }

    // Round 2: if results look bad (0 rows or clearly wrong), ask to refine
    if (result1.rows.length === 0) {
      const count = await execSQL(task, 'SELECT COUNT(*) FROM records').then(r => r.rows[0][0]).catch(() => '?');
      const resp2 = await ocSend(session.id,
        `That query returned 0 rows. The table has ${count} records. Try a broader query. Maybe the abbreviation needs expanding. Return ONLY \`\`\`sql.`, 10000);
      return extractSQLFromText(resp2) || sql1;
    }

    return sql1;
  } catch (err) {
    console.log(`[query] OpenCode iterative failed: ${err.message}`);
    return null;
  }
}

// ─── Abbreviation expansion ──────────────────────────────────────────

const ABBREVIATIONS = {
  'sr': 'senior', 'jr': 'junior', 'devs': 'developers', 'dev': 'developer',
  'eng': 'engineer', 'mgr': 'manager', 'dir': 'director', 'ba': 'buenos aires',
  'cba': 'córdoba', 'cordoba': 'córdoba', 'fullstack': 'full stack',
  'fe': 'frontend', 'be': 'backend', 'bsas': 'buenos aires',
  'hr': 'human resources', 'qa': 'quality assurance', 'pm': 'project manager',
  'ux': 'user experience', 'ui': 'user interface', 'ml': 'machine learning',
  'ai': 'artificial intelligence', 'ds': 'data science', 'sre': 'site reliability',
  'infra': 'infrastructure', 'ops': 'operations', 'sec': 'security',
};

function expandAbbreviations(text) {
  return text.replace(/\b(\w+)\b/g, (m) => ABBREVIATIONS[m.toLowerCase()] || m);
}

function fallbackNLtoSQL(question, schema) {
  let q = expandAbbreviations(question).toLowerCase().trim();
  const S = 'SELECT _id FROM records';

  // Aggregation queries (these need full columns, not just _id)
  if (/group\s+by|count\s+by|by company|by seniority|breakdown|distribution/i.test(q)) {
    if (/company/i.test(q)) return `SELECT company, COUNT(*) as count FROM records WHERE company != '' GROUP BY company ORDER BY count DESC`;
    if (/seniority|level/i.test(q)) return `SELECT seniority, COUNT(*) as count FROM records GROUP BY seniority ORDER BY count DESC`;
    if (/skill/i.test(q)) return `SELECT skills, COUNT(*) as count FROM records WHERE skills != '' GROUP BY skills ORDER BY count DESC`;
    if (/location|city/i.test(q)) return `SELECT location, COUNT(*) as count FROM records GROUP BY location ORDER BY count DESC`;
    return `SELECT company, COUNT(*) as count FROM records WHERE company != '' GROUP BY company ORDER BY count DESC`;
  }

  const where = [];

  // 1. Location — extract and remove from query
  const locPattern = /\b(?:in|from|located in)\s+(córdoba|cordoba|buenos aires|rosario|mendoza|argentina|tucumán|tucuman|santa fe|mar del plata|remote|remoto)\b/i;
  const locMatch = q.match(locPattern);
  if (locMatch) {
    where.push(`location LIKE '%${locMatch[1]}%'`);
    q = q.replace(locMatch[0], '').trim();
  }

  // 2. Seniority — extract and remove
  const seniorityLevels = ['senior', 'lead', 'staff', 'principal', 'architect', 'manager', 'executive', 'director'];
  const senMatch = seniorityLevels.find(s => q.includes(s));
  if (senMatch) {
    where.push(`seniority = '${senMatch}'`);
    q = q.replace(new RegExp('\\b' + senMatch + '\\b', 'i'), '').trim();
  }

  // 3. "works at <company>"
  const atMatch = q.match(/(?:works?\s+at|employed\s+at|at\s+company)\s+(.+?)(?:\s*$|\s+(?:in|from|who))/i);
  if (atMatch && atMatch[1].trim().length > 1) {
    where.push(`company LIKE '%${atMatch[1].trim()}%'`);
    q = q.replace(atMatch[0], '').trim();
  }

  // 4. Strip filler words — what remains is the role/skill/domain intent
  const stripped = q
    .replace(/\b(i need to|help me|show|find|get|list|display|me|all|the|people|persons?|who|that|those|which|with|from|please|can you|meaning|specifically|looking for|need)\b/gi, '')
    .replace(/[,.\-]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // 5. Remaining terms → search across title, skills, headline (the person's domain)
  if (stripped.length > 1) {
    const terms = stripped.split(/\s+/).filter(t => t.length > 1);
    if (terms.length) {
      // Search as a phrase first, then individual terms
      const phrase = terms.join(' ');
      const phraseCondition = `(title LIKE '%${phrase}%' OR skills LIKE '%${phrase}%' OR headline LIKE '%${phrase}%')`;
      const termConditions = terms.map(t =>
        `(title LIKE '%${t}%' OR skills LIKE '%${t}%' OR headline LIKE '%${t}%' OR name LIKE '%${t}%')`
      );
      // Use phrase match if 2+ words, otherwise individual terms
      if (terms.length >= 2) {
        where.push(`(${phraseCondition} OR (${termConditions.join(' AND ')}))`);
      } else {
        where.push(termConditions[0]);
      }
    }
  }

  if (where.length) return S + ' WHERE ' + where.join(' AND ');
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

        const sql = await nlToSQL(question, schema, task);
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
