#!/usr/bin/env node

/**
 * cron — Job scheduler and worker pool for continuous ingestion.
 *
 * Usage:
 *   node bin/cron.js add <task> --every=<minutes>   Schedule a recurring job
 *   node bin/cron.js run <task>                      One-shot job (run now)
 *   node bin/cron.js list                            Show all jobs
 *   node bin/cron.js start [--workers=N]             Start worker pool (default 2)
 *   node bin/cron.js stop                            Stop daemon
 *   node bin/cron.js status                          Show daemon + queue status
 *   node bin/cron.js logs <job-id>                   Show run history
 *   node bin/cron.js pause <job-id>                  Pause a job
 *   node bin/cron.js resume <job-id>                 Resume a job
 *   node bin/cron.js remove <job-id>                 Remove a job
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { JobQueue } from '../lib/queue.js';
import { workerLoop } from '../lib/worker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PID_FILE = join(ROOT, 'data', 'cron.pid');

const [cmd, ...args] = process.argv.slice(2);
const getFlag = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const positional = args.filter(a => !a.startsWith('--'));

async function main() {
  const commands = { add, run, list, start, stop, status, logs, pause, resume, remove };

  if (!cmd || !commands[cmd]) {
    console.log(`
  cron — Job scheduler and worker pool

  Commands:
    add <task> --every=<min>    Schedule recurring job
    run <task>                  One-shot job (run immediately)
    list                        Show all jobs + status
    start [--workers=N]         Start worker pool (default 2)
    stop                        Stop daemon
    status                      Daemon + queue status
    logs <job-id>               Run history for a job
    pause <job-id>              Pause a recurring job
    resume <job-id>             Resume a paused job
    remove <job-id>             Remove a job
    `);
    process.exit(1);
  }

  await commands[cmd]();
}

async function add() {
  const task = positional[0];
  const every = parseInt(getFlag('every') || '0', 10);
  if (!task) { console.error('Usage: cron add <task> [--every=<minutes>]'); process.exit(1); }

  // Verify task exists
  const taskPath = join(ROOT, 'tasks', `${task}.js`);
  if (!existsSync(taskPath)) { console.error(`Task not found: ${task}`); process.exit(1); }

  const queue = await new JobQueue().init();
  const id = queue.enqueue(task, every);
  queue.close();

  if (every > 0) {
    console.log(`Job #${id}: "${task}" scheduled every ${every} minutes`);
  } else {
    console.log(`Job #${id}: "${task}" queued (one-shot)`);
  }
}

async function run() {
  const task = positional[0];
  if (!task) { console.error('Usage: cron run <task>'); process.exit(1); }

  const taskPath = join(ROOT, 'tasks', `${task}.js`);
  if (!existsSync(taskPath)) { console.error(`Task not found: ${task}`); process.exit(1); }

  console.log(`Running "${task}" now...`);
  const { runPipeline } = await import('../lib/worker.js');
  const start = Date.now();
  try {
    const result = await runPipeline(task);
    const ms = Date.now() - start;
    console.log(`Done in ${(ms / 1000).toFixed(1)}s — ${result.records} records`);
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  }
}

async function list() {
  const queue = await new JobQueue().init();
  const jobs = queue.listJobs();
  queue.close();

  if (!jobs.length) { console.log('No jobs. Use: cron add <task> --every=60'); return; }

  console.log(`\n  ${'ID'.padEnd(5)} ${'Task'.padEnd(35)} ${'Status'.padEnd(10)} ${'Every'.padEnd(8)} ${'Runs'.padEnd(6)} ${'Next Run'}`);
  console.log(`  ${'─'.repeat(5)} ${'─'.repeat(35)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(20)}`);

  for (const j of jobs) {
    const every = j.interval_minutes > 0 ? `${j.interval_minutes}m` : 'once';
    const next = j.next_run ? new Date(j.next_run).toLocaleString() : '-';
    console.log(`  ${String(j.id).padEnd(5)} ${j.task.padEnd(35)} ${j.status.padEnd(10)} ${every.padEnd(8)} ${String(j.iterations_total).padEnd(6)} ${next}`);
  }
  console.log();
}

async function start() {
  const numWorkers = parseInt(getFlag('workers') || '2', 10);

  // Check if already running
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    try { process.kill(parseInt(pid), 0); console.error(`Daemon already running (PID ${pid}). Use: cron stop`); process.exit(1); } catch {}
    // Stale PID file
    unlinkSync(PID_FILE);
  }

  // Write PID
  writeFileSync(PID_FILE, String(process.pid));

  const queue = await new JobQueue().init();
  const ac = new AbortController();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down workers...');
    ac.abort();
    setTimeout(() => {
      queue.close();
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      process.exit(0);
    }, 1000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`Starting ${numWorkers} worker(s) (PID ${process.pid})`);
  console.log(`Queue: ${queue.pendingCount()} jobs ready\n`);

  // Launch workers
  const workers = [];
  for (let i = 0; i < numWorkers; i++) {
    workers.push(workerLoop(queue, i + 1, ac.signal));
  }

  await Promise.all(workers);

  queue.close();
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

async function stop() {
  if (!existsSync(PID_FILE)) { console.log('No daemon running.'); return; }
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to PID ${pid}`);
  } catch {
    console.log(`Process ${pid} not found (stale PID file)`);
  }
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

async function status() {
  // Daemon status
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    try { process.kill(pid, 0); console.log(`Daemon: running (PID ${pid})`); }
    catch { console.log(`Daemon: stopped (stale PID)`); }
  } else {
    console.log('Daemon: not running');
  }

  // Queue status
  const queue = await new JobQueue().init();
  const jobs = queue.listJobs();
  const pending = jobs.filter(j => j.status === 'pending').length;
  const running = jobs.filter(j => j.status === 'running').length;
  const done = jobs.filter(j => j.status === 'done').length;
  const failed = jobs.filter(j => j.last_error).length;
  queue.close();

  console.log(`Jobs: ${jobs.length} total, ${pending} pending, ${running} running, ${done} done, ${failed} with errors`);
}

async function logs() {
  const jobId = parseInt(positional[0]);
  if (!jobId) { console.error('Usage: cron logs <job-id>'); process.exit(1); }

  const queue = await new JobQueue().init();
  const job = queue.getJob(jobId);
  if (!job) { console.error(`Job #${jobId} not found`); queue.close(); process.exit(1); }

  console.log(`\nJob #${jobId}: ${job.task} (${job.status})`);
  if (job.last_error) console.log(`Last error: ${job.last_error}`);

  const entries = queue.getLogs(jobId);
  queue.close();

  if (!entries.length) { console.log('No logs yet.\n'); return; }

  console.log(`\n  ${'When'.padEnd(22)} ${'Status'.padEnd(10)} ${'Duration'.padEnd(10)} ${'Records'.padEnd(8)} Error`);
  for (const e of entries) {
    const when = e.finished_at ? new Date(e.finished_at).toLocaleString() : '-';
    const dur = e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : '-';
    console.log(`  ${when.padEnd(22)} ${e.status.padEnd(10)} ${dur.padEnd(10)} ${String(e.records || 0).padEnd(8)} ${e.error || ''}`);
  }
  console.log();
}

async function pause() {
  const jobId = parseInt(positional[0]);
  if (!jobId) { console.error('Usage: cron pause <job-id>'); process.exit(1); }
  const queue = await new JobQueue().init();
  queue.pause(jobId);
  queue.close();
  console.log(`Job #${jobId} paused`);
}

async function resume() {
  const jobId = parseInt(positional[0]);
  if (!jobId) { console.error('Usage: cron resume <job-id>'); process.exit(1); }
  const queue = await new JobQueue().init();
  queue.resume(jobId);
  queue.close();
  console.log(`Job #${jobId} resumed`);
}

async function remove() {
  const jobId = parseInt(positional[0]);
  if (!jobId) { console.error('Usage: cron remove <job-id>'); process.exit(1); }
  const queue = await new JobQueue().init();
  queue.remove(jobId);
  queue.close();
  console.log(`Job #${jobId} removed`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
