#!/usr/bin/env node
/**
 * Aggregate metrics from all tasks.
 * Reads pipeline-metrics.json, SQLite _metrics columns, benchmark results, and jobs.sqlite.
 * Exports collectAll() or runs standalone to print JSON.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import initSqlJs from 'sql.js';

const DATA_DIR = new URL('../data', import.meta.url).pathname;

export const PRICING = {
  'gemini-flash-lite': { input: 0.10, output: 0.40 },
  'mistral-nemo':      { input: 0.02, output: 0.04 },
  'gemma-4b':          { input: 0.01, output: 0.03 },
};

function calcCost(model, tokensIn, tokensOut) {
  const p = PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function openDb(SQL, path) {
  try {
    if (!existsSync(path)) return null;
    return new SQL.Database(readFileSync(path));
  } catch { return null; }
}

function queryAll(db, sql) {
  const stmt = db.prepare(sql);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export async function collectAll() {
  const SQL = await initSqlJs();
  const tasks = [];
  const modelStats = {};
  let globalTokensIn = 0, globalTokensOut = 0, globalCost = 0, globalRecords = 0;
  const stageTimings = { htmlToText: 0, extract: 0, normalize: 0, postProcess: 0 };

  const dirs = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const taskName of dirs) {
    const taskDir = join(DATA_DIR, taskName);
    const task = { name: taskName, records: 0, iterations: 0, lastRun: null, status: 'idle', model: null };

    // --- pipeline-metrics.json ---
    const pm = readJson(join(taskDir, 'pipeline-metrics.json'));
    if (pm) {
      task.model = pm.model || pm.modelId || null;
      task.records = pm.records || 0;
      task.totalTimeMs = pm.totalTimeMs || 0;

      const model = pm.model || 'unknown';
      const stages = pm.stages || {};
      for (const [stage, s] of Object.entries(stages)) {
        if (stageTimings[stage] !== undefined) stageTimings[stage] += s.totalMs || 0;
        const tIn = s.totalTokensIn || 0;
        const tOut = s.totalTokensOut || 0;
        if (tIn || tOut) {
          if (!modelStats[model]) modelStats[model] = { tokensIn: 0, tokensOut: 0, cost: 0, calls: 0 };
          modelStats[model].tokensIn += tIn;
          modelStats[model].tokensOut += tOut;
          modelStats[model].cost += calcCost(model, tIn, tOut);
          modelStats[model].calls++;
          globalTokensIn += tIn;
          globalTokensOut += tOut;
          globalCost += calcCost(model, tIn, tOut);
        }
      }
    }

    // --- meta.json ---
    const meta = readJson(join(taskDir, 'meta.json'));
    if (meta) {
      task.iterations = meta.history?.length || 0;
      const last = meta.history?.at(-1);
      if (last?.date) task.lastRun = last.date;
      task.totalRecords = meta.totalRecords || task.records;
    }

    // --- SQLite records ---
    const dbPath = join(taskDir, 'db.sqlite');
    const db = openDb(SQL, dbPath);
    if (db) {
      try {
        const countRows = queryAll(db, 'SELECT COUNT(*) as c FROM records');
        task.records = countRows[0]?.c || task.records;
        globalRecords += task.records;

        const metricRows = queryAll(db, "SELECT _metrics FROM records WHERE _metrics IS NOT NULL AND _metrics != ''");
        for (const row of metricRows) {
          try {
            const m = JSON.parse(row._metrics);
            if (m.extract?.ms) stageTimings.extract += m.extract.ms;
            if (m.normalize?.ms) stageTimings.normalize += m.normalize.ms;
            if (m.postProcess?.ms) stageTimings.postProcess += m.postProcess.ms;
          } catch {}
        }
      } catch {} finally { db.close(); }
    } else {
      globalRecords += task.records;
    }

    task.status = task.lastRun ? 'completed' : (pm ? 'completed' : 'idle');
    tasks.push(task);
  }

  // --- Benchmark data ---
  const benchmarkPath = join(new URL('../tests', import.meta.url).pathname, 'nl-controls-benchmark.json');
  const benchmark = readJson(benchmarkPath);
  const benchmarkByModel = {};
  if (Array.isArray(benchmark)) {
    for (const entry of benchmark) {
      const model = entry.model || 'unknown';
      if (!benchmarkByModel[model]) benchmarkByModel[model] = { queries: 0, issues: 0, totalMs: 0, totalTokens: 0 };
      benchmarkByModel[model].queries++;
      benchmarkByModel[model].issues += (entry.issues?.length || 0);
      benchmarkByModel[model].totalMs += (entry.elapsed || 0);
      benchmarkByModel[model].totalTokens += (entry.tokens || 0);
    }
  }

  // --- Jobs (Task 1 cron — may not exist) ---
  let jobs = [];
  const jobsDb = openDb(SQL, join(DATA_DIR, 'jobs.sqlite'));
  if (jobsDb) {
    try { jobs = queryAll(jobsDb, 'SELECT * FROM jobs'); } catch {}
    jobsDb.close();
  }

  return {
    global: {
      tasks: tasks.length,
      records: globalRecords,
      tokensIn: globalTokensIn,
      tokensOut: globalTokensOut,
      totalTokens: globalTokensIn + globalTokensOut,
      estimatedCost: Math.round(globalCost * 10000) / 10000,
      stageTimings,
    },
    tasks,
    models: modelStats,
    benchmark: benchmarkByModel,
    jobs,
    pricing: PRICING,
  };
}

// CLI mode
const thisFile = new URL(import.meta.url).pathname;
if (process.argv[1] === thisFile) {
  collectAll().then(data => console.log(JSON.stringify(data, null, 2)));
}
