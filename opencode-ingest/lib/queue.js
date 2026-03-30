/**
 * SQLite-backed job queue using sql.js (pure JS, no native deps).
 * Stores in data/jobs.sqlite.
 */

import initSqlJs from 'sql.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_DB_PATH = join(ROOT, 'data', 'jobs.sqlite');

export class JobQueue {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
    this._sql = null;
  }

  async init() {
    this._sql = await initSqlJs();
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = existsSync(this.dbPath)
      ? new this._sql.Database(readFileSync(this.dbPath))
      : new this._sql.Database();

    this.db.run(`CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      interval_minutes INTEGER DEFAULT 0,
      next_run TEXT,
      last_run TEXT,
      last_duration_ms INTEGER,
      last_error TEXT,
      iterations_total INTEGER DEFAULT 0,
      records_total INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    this.db.run(`CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      status TEXT,
      records INTEGER DEFAULT 0,
      error TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    )`);

    this.save();
    return this;
  }

  save() {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  enqueue(task, intervalMinutes = 0) {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO jobs (task, status, interval_minutes, next_run) VALUES (?, 'pending', ?, ?)`,
      [task, intervalMinutes, now]
    );
    const res = this.db.exec('SELECT last_insert_rowid()');
    const id = res[0].values[0][0];
    this.save();
    return id;
  }

  dequeue() {
    const now = new Date().toISOString();
    const res = this.db.exec(
      `SELECT id, task, interval_minutes FROM jobs
       WHERE status = 'pending' AND next_run <= ?
       ORDER BY next_run ASC LIMIT 1`,
      [now]
    );
    if (!res.length || !res[0].values.length) return null;

    const [id, task, interval_minutes] = res[0].values[0];
    this.db.run(`UPDATE jobs SET status = 'running', last_run = ? WHERE id = ?`, [now, id]);
    this.save();
    return { id, task, interval_minutes };
  }

  complete(jobId, { durationMs = 0, records = 0 } = {}) {
    const now = new Date().toISOString();
    const job = this.getJob(jobId);
    if (!job) return;

    const newTotal = (job.iterations_total || 0) + 1;
    const newRecords = (job.records_total || 0) + records;

    if (job.interval_minutes > 0) {
      const next = new Date(Date.now() + job.interval_minutes * 60000).toISOString();
      this.db.run(
        `UPDATE jobs SET status = 'pending', last_duration_ms = ?, iterations_total = ?,
         records_total = ?, last_error = NULL, next_run = ? WHERE id = ?`,
        [durationMs, newTotal, newRecords, next, jobId]
      );
    } else {
      this.db.run(
        `UPDATE jobs SET status = 'done', last_duration_ms = ?, iterations_total = ?,
         records_total = ?, last_error = NULL WHERE id = ?`,
        [durationMs, newTotal, newRecords, jobId]
      );
    }

    // Log entry
    this.db.run(
      `INSERT INTO job_logs (job_id, started_at, finished_at, duration_ms, status, records)
       VALUES (?, ?, ?, ?, 'done', ?)`,
      [jobId, job.last_run, now, durationMs, records]
    );

    this.save();
  }

  fail(jobId, error) {
    const now = new Date().toISOString();
    const job = this.getJob(jobId);
    if (!job) return;

    // Backoff: 5 min for first fail, then double, max 60 min
    const failCount = this._failCount(jobId);
    const backoff = Math.min(5 * Math.pow(2, failCount), 60);
    const next = new Date(Date.now() + backoff * 60000).toISOString();

    this.db.run(
      `UPDATE jobs SET status = 'pending', last_error = ?, last_duration_ms = 0, next_run = ? WHERE id = ?`,
      [String(error).slice(0, 500), next, jobId]
    );

    this.db.run(
      `INSERT INTO job_logs (job_id, started_at, finished_at, duration_ms, status, error)
       VALUES (?, ?, ?, 0, 'failed', ?)`,
      [jobId, job.last_run, now, String(error).slice(0, 500)]
    );

    this.save();
  }

  _failCount(jobId) {
    const res = this.db.exec(
      `SELECT COUNT(*) FROM job_logs WHERE job_id = ? AND status = 'failed'`,
      [jobId]
    );
    return res.length ? res[0].values[0][0] : 0;
  }

  getJob(jobId) {
    const res = this.db.exec(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
    if (!res.length || !res[0].values.length) return null;
    const cols = res[0].columns;
    const row = res[0].values[0];
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  }

  listJobs() {
    const res = this.db.exec(`SELECT * FROM jobs ORDER BY id`);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => {
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      return obj;
    });
  }

  getLogs(jobId, limit = 20) {
    const res = this.db.exec(
      `SELECT * FROM job_logs WHERE job_id = ? ORDER BY id DESC LIMIT ?`,
      [jobId, limit]
    );
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => {
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      return obj;
    });
  }

  pause(jobId) {
    this.db.run(`UPDATE jobs SET status = 'paused' WHERE id = ?`, [jobId]);
    this.save();
  }

  resume(jobId) {
    const now = new Date().toISOString();
    this.db.run(`UPDATE jobs SET status = 'pending', next_run = ? WHERE id = ?`, [now, jobId]);
    this.save();
  }

  remove(jobId) {
    this.db.run(`DELETE FROM job_logs WHERE job_id = ?`, [jobId]);
    this.db.run(`DELETE FROM jobs WHERE id = ?`, [jobId]);
    this.save();
  }

  pendingCount() {
    const now = new Date().toISOString();
    const res = this.db.exec(
      `SELECT COUNT(*) FROM jobs WHERE status = 'pending' AND next_run <= ?`,
      [now]
    );
    return res.length ? res[0].values[0][0] : 0;
  }

  close() {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
