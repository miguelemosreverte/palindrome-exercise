import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Normalize raw JSONL files into SQLite (using sql.js — pure JS, no native deps).
 * Auto-creates table from first record's keys if table doesn't exist.
 */
export async function normalize(taskName, dataDir) {
  const dbPath = join(dataDir, 'db.sqlite');
  const rawDir = join(dataDir, 'raw');

  const SQL = await initSqlJs();
  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();

  const files = readdirSync(rawDir).filter(f => f.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    console.log(`[${taskName}] No raw data to normalize`);
    return;
  }

  // Check which iterations are already imported
  let maxIter = 0;
  try {
    const res = db.exec('SELECT MAX(_iteration) FROM records');
    if (res.length && res[0].values[0][0] != null) maxIter = res[0].values[0][0];
  } catch { /* table doesn't exist yet */ }

  let tableCreated = maxIter > 0;

  for (const file of files) {
    const iterNum = parseInt(file.replace('.jsonl', ''), 10);
    if (iterNum <= maxIter) continue; // already imported

    const lines = readFileSync(join(rawDir, file), 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line);

      if (!tableCreated) {
        const columns = Object.keys(record).map(k => `"${k}" TEXT`);
        db.run(`CREATE TABLE IF NOT EXISTS records (
          _id INTEGER PRIMARY KEY AUTOINCREMENT,
          _iteration INTEGER,
          _ingested_at TEXT DEFAULT (datetime('now')),
          ${columns.join(', ')}
        )`);
        tableCreated = true;
      }

      const keys = Object.keys(record);
      const placeholders = keys.map(() => '?').join(', ');
      db.run(
        `INSERT INTO records (_iteration, ${keys.map(k => `"${k}"`).join(', ')}) VALUES (?, ${placeholders})`,
        [iterNum, ...keys.map(k => typeof record[k] === 'object' ? JSON.stringify(record[k]) : String(record[k] ?? ''))]
      );
    }
  }

  if (!tableCreated) {
    console.log(`[${taskName}] No new records to normalize`);
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    db.close();
    return;
  }

  const count = db.exec('SELECT COUNT(*) FROM records');
  console.log(`[${taskName}] Normalized ${count[0]?.values[0][0] || 0} total records into SQLite`);

  // Save to disk
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
  db.close();
}
