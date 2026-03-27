/**
 * Bridge SQLite — first-class local persistence for the desktop/VPS runtime.
 *
 * Stores: tasks, step results, collected data, benchmarks, skill compositions,
 * session state, and any structured data the agent produces.
 *
 * Firebase remains the real-time sync layer (phone notifications, miniapp).
 * SQLite is the durable local source of truth.
 *
 * Usage:
 *   const db = require('./lib/db');
 *   db.createTask({ goal: '...', steps: [...] });
 *   db.saveStepResult(taskId, stepIndex, result);
 *   db.saveCollectedData(taskId, 'candidates', rows);
 *   db.getBenchmarks('hr-research');
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Each project gets its own SQLite instance — no concurrency issues.
// VPS: namespaced by user/project folder.
// Desktop: one per project in ~/.bridge/db/{project-hash}.db
// Override with BRIDGE_DB_PATH env var.

function resolveDbPath(projectPath) {
  var dbDir = path.join(process.env.HOME || '/tmp', '.bridge', 'db');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (process.env.BRIDGE_DB_PATH) return process.env.BRIDGE_DB_PATH;
  // Hash the project path for the filename
  var name = (projectPath || process.cwd()).replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
  return path.join(dbDir, name + '.db');
}

var DB_PATH = resolveDbPath(process.env.BRIDGE_PROJECT_PATH);
var db = new Database(DB_PATH);

// WAL mode for concurrent reads (safe for multiple readers, single writer)
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// ─── Schema ───

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    session_id TEXT,
    current_step INTEGER DEFAULT 0,
    steps TEXT,  -- JSON array
    results TEXT DEFAULT '{}',  -- JSON object
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS step_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_name TEXT,
    result TEXT,
    tokens_used INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    status TEXT DEFAULT 'done',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS collected_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    collection TEXT NOT NULL,  -- e.g. 'candidates', 'prices', 'articles'
    data TEXT NOT NULL,  -- JSON or CSV
    format TEXT DEFAULT 'json',  -- 'json', 'csv', 'text'
    row_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_time_ms INTEGER,
    steps TEXT,  -- JSON array of step timings
    results TEXT,  -- JSON summary
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT,
    prompt_template TEXT NOT NULL,
    parameters TEXT,  -- JSON schema
    composed_from TEXT,  -- JSON array of skill names if composite
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    firebase_session TEXT,
    project_name TEXT,
    project_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_active TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    sender TEXT NOT NULL,  -- 'user', 'agent', 'system'
    content TEXT NOT NULL,
    model TEXT,
    action TEXT,  -- 'notify', 'ask', 'approve', etc.
    metadata TEXT,  -- JSON
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
  CREATE INDEX IF NOT EXISTS idx_steps_task ON step_results(task_id);
  CREATE INDEX IF NOT EXISTS idx_data_task ON collected_data(task_id);
  CREATE INDEX IF NOT EXISTS idx_data_collection ON collected_data(collection);
  CREATE INDEX IF NOT EXISTS idx_benchmarks_name ON benchmarks(name);
`);

// ─── Tasks ───

const insertTask = db.prepare(`
  INSERT INTO tasks (id, goal, status, session_id, current_step, steps, results)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateTask = db.prepare(`
  UPDATE tasks SET status = ?, current_step = ?, results = ?, updated_at = datetime('now')
  WHERE id = ?
`);

const getTask = db.prepare('SELECT * FROM tasks WHERE id = ?');
const getTasksBySession = db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC');
const getAllTasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?');

function createTask(opts) {
  var id = opts.id || 'task-' + Date.now();
  insertTask.run(id, opts.goal, opts.status || 'pending', opts.sessionId || null,
    0, JSON.stringify(opts.steps || []), JSON.stringify(opts.results || {}));
  return id;
}

function completeStep(taskId, stepIndex, result, durationMs, tokensUsed) {
  var task = getTask.get(taskId);
  if (!task) return;
  var steps = JSON.parse(task.steps);
  var results = JSON.parse(task.results);
  if (steps[stepIndex]) {
    steps[stepIndex].status = 'done';
    steps[stepIndex].result = result;
    results[steps[stepIndex].name] = result;
  }
  updateTask.run('running', stepIndex + 1, JSON.stringify(results), taskId);
  // Also save to step_results for detailed tracking
  db.prepare(`INSERT INTO step_results (task_id, step_index, step_name, result, tokens_used, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    taskId, stepIndex, steps[stepIndex] ? steps[stepIndex].name : '', result, tokensUsed || 0, durationMs || 0);
}

function finishTask(taskId, status) {
  var task = getTask.get(taskId);
  if (!task) return;
  updateTask.run(status || 'done', task.current_step, task.results, taskId);
}

// ─── Collected Data ───

function saveData(taskId, collection, data, format) {
  var rowCount = 0;
  if (format === 'json') {
    try { var parsed = JSON.parse(data); rowCount = Array.isArray(parsed) ? parsed.length : 1; } catch (e) {}
  } else if (format === 'csv') {
    rowCount = data.split('\n').length - 1; // minus header
  }
  db.prepare(`INSERT INTO collected_data (task_id, collection, data, format, row_count) VALUES (?, ?, ?, ?, ?)`)
    .run(taskId, collection, data, format || 'json', rowCount);
}

function getData(collection, taskId) {
  if (taskId) {
    return db.prepare('SELECT * FROM collected_data WHERE collection = ? AND task_id = ? ORDER BY created_at DESC').all(collection, taskId);
  }
  return db.prepare('SELECT * FROM collected_data WHERE collection = ? ORDER BY created_at DESC LIMIT 100').all(collection);
}

function getLatestData(collection) {
  return db.prepare('SELECT * FROM collected_data WHERE collection = ? ORDER BY created_at DESC LIMIT 1').get(collection);
}

// ─── Benchmarks ───

function saveBenchmark(name, totalTimeMs, steps, results) {
  db.prepare('INSERT INTO benchmarks (name, total_time_ms, steps, results) VALUES (?, ?, ?, ?)')
    .run(name, totalTimeMs, JSON.stringify(steps), JSON.stringify(results));
}

function getBenchmarks(name, limit) {
  return db.prepare('SELECT * FROM benchmarks WHERE name = ? ORDER BY created_at DESC LIMIT ?')
    .all(name, limit || 20);
}

function getLatestBenchmark(name) {
  return db.prepare('SELECT * FROM benchmarks WHERE name = ? ORDER BY created_at DESC LIMIT 1').get(name);
}

// ─── Skills ───

function saveSkill(name, description, promptTemplate, parameters, composedFrom) {
  db.prepare(`INSERT OR REPLACE INTO skills (name, description, prompt_template, parameters, composed_from, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))`)
    .run(name, description, promptTemplate, JSON.stringify(parameters || {}), JSON.stringify(composedFrom || []));
}

function getSkill(name) {
  return db.prepare('SELECT * FROM skills WHERE name = ?').get(name);
}

function listSkills() {
  return db.prepare('SELECT name, description, composed_from FROM skills ORDER BY name').all();
}

// ─── Sessions ───

function saveSession(id, firebaseSession, projectName, projectPath) {
  db.prepare(`INSERT OR REPLACE INTO sessions (id, firebase_session, project_name, project_path, last_active)
    VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(id, firebaseSession, projectName, projectPath);
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

// ─── Stats ───

function getStats() {
  return {
    tasks: db.prepare('SELECT COUNT(*) as count FROM tasks').get().count,
    completedTasks: db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done'").get().count,
    steps: db.prepare('SELECT COUNT(*) as count FROM step_results').get().count,
    collections: db.prepare('SELECT COUNT(DISTINCT collection) as count FROM collected_data').get().count,
    totalRows: db.prepare('SELECT SUM(row_count) as total FROM collected_data').get().total || 0,
    benchmarks: db.prepare('SELECT COUNT(*) as count FROM benchmarks').get().count,
    skills: db.prepare('SELECT COUNT(*) as count FROM skills').get().count,
  };
}

// ─── Messages (replaces Firebase for message history) ───

function saveMessage(sessionId, sender, content, opts) {
  opts = opts || {};
  return db.prepare(`INSERT INTO messages (session_id, sender, content, model, action, metadata)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    sessionId, sender, content, opts.model || null, opts.action || null,
    opts.metadata ? JSON.stringify(opts.metadata) : null
  );
}

function getMessages(sessionId, limit, since) {
  if (since) {
    return db.prepare('SELECT * FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?')
      .all(sessionId, since, limit || 200);
  }
  return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(sessionId, limit || 200);
}

function getMessageCount(sessionId) {
  return db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId).count;
}

// ─── Open a different project's DB ───

function openDb(projectPath) {
  var p = resolveDbPath(projectPath);
  var d = new Database(p);
  d.pragma('journal_mode = WAL');
  d.pragma('busy_timeout = 5000');
  return d;
}

module.exports = {
  db,
  DB_PATH,
  openDb,
  // Tasks
  createTask,
  getTask,
  getTasksBySession,
  getAllTasks,
  completeStep,
  finishTask,
  // Data
  saveData,
  getData,
  getLatestData,
  // Benchmarks
  saveBenchmark,
  getBenchmarks,
  getLatestBenchmark,
  // Skills
  saveSkill,
  getSkill,
  listSkills,
  // Sessions
  saveSession,
  getSession,
  // Messages
  saveMessage,
  getMessages,
  getMessageCount,
  // Stats
  getStats,
};
