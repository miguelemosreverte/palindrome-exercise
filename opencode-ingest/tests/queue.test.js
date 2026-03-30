#!/usr/bin/env node

/**
 * Tests for lib/queue.js — enqueue, dequeue, complete, reschedule, fail.
 * Run: node tests/queue.test.js
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';
import { JobQueue } from '../lib/queue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, '..', 'data', 'test-jobs.sqlite');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS  ${msg}`); }
  else { failed++; console.error(`  FAIL  ${msg}`); }
}

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

async function testEnqueueDequeue() {
  console.log('\n── enqueue / dequeue ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  const id = q.enqueue('test-task', 60);
  assert(id === 1, 'enqueue returns id=1');

  const job = q.dequeue();
  assert(job !== null, 'dequeue returns a job');
  assert(job.id === 1, 'dequeued job has id=1');
  assert(job.task === 'test-task', 'dequeued job has correct task');
  assert(job.interval_minutes === 60, 'dequeued job has interval');

  // Job is now running — second dequeue returns null
  const job2 = q.dequeue();
  assert(job2 === null, 'no more pending jobs');

  q.close();
}

async function testCompleteReschedule() {
  console.log('\n── complete + reschedule ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  q.enqueue('recurring-task', 10); // every 10 min
  const job = q.dequeue();
  q.complete(job.id, { durationMs: 5000, records: 42 });

  const updated = q.getJob(job.id);
  assert(updated.status === 'pending', 'recurring job is re-pending after complete');
  assert(updated.iterations_total === 1, 'iterations_total incremented');
  assert(updated.records_total === 42, 'records_total updated');
  assert(updated.next_run !== null, 'next_run is set');

  // next_run should be ~10 min in the future
  const nextRun = new Date(updated.next_run);
  const diff = nextRun - Date.now();
  assert(diff > 8 * 60000 && diff < 12 * 60000, 'next_run is ~10 min in future');

  q.close();
}

async function testOneShotComplete() {
  console.log('\n── one-shot complete ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  q.enqueue('one-shot-task', 0);
  const job = q.dequeue();
  q.complete(job.id, { durationMs: 1000, records: 5 });

  const updated = q.getJob(job.id);
  assert(updated.status === 'done', 'one-shot job is done after complete');

  q.close();
}

async function testFail() {
  console.log('\n── fail + backoff ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  q.enqueue('flaky-task', 30);
  const job = q.dequeue();
  q.fail(job.id, 'Connection timeout');

  const updated = q.getJob(job.id);
  assert(updated.status === 'pending', 'failed job goes back to pending');
  assert(updated.last_error === 'Connection timeout', 'error is stored');

  // Check backoff — first fail = 5 min
  const nextRun = new Date(updated.next_run);
  const diff = nextRun - Date.now();
  assert(diff > 3 * 60000 && diff < 7 * 60000, 'backoff ~5 min after first fail');

  q.close();
}

async function testListAndLogs() {
  console.log('\n── list + logs ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  q.enqueue('task-a', 60);
  q.enqueue('task-b', 0);
  q.enqueue('task-c', 120);

  const jobs = q.listJobs();
  assert(jobs.length === 3, 'listJobs returns 3 jobs');

  // Run and complete task-a to generate a log
  const job = q.dequeue();
  q.complete(job.id, { durationMs: 2000, records: 10 });

  const logs = q.getLogs(job.id);
  assert(logs.length === 1, 'one log entry after complete');
  assert(logs[0].status === 'done', 'log entry status is done');
  assert(logs[0].records === 10, 'log entry has record count');

  q.close();
}

async function testPauseResume() {
  console.log('\n── pause / resume ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  q.enqueue('pausable-task', 60);
  q.pause(1);

  const paused = q.getJob(1);
  assert(paused.status === 'paused', 'job is paused');

  // Paused jobs should not be dequeued
  const job = q.dequeue();
  assert(job === null, 'paused job not dequeued');

  q.resume(1);
  const resumed = q.getJob(1);
  assert(resumed.status === 'pending', 'job is pending after resume');

  q.close();
}

async function testConcurrentDequeue() {
  console.log('\n── concurrent dequeue (no double-pick) ──');
  cleanup();
  const q = await new JobQueue(TEST_DB).init();

  q.enqueue('single-task', 0);

  // Simulate two workers trying to dequeue
  const job1 = q.dequeue();
  const job2 = q.dequeue();

  assert(job1 !== null, 'first dequeue gets the job');
  assert(job2 === null, 'second dequeue gets nothing');

  q.close();
}

// Run all
console.log('Queue Tests');
await testEnqueueDequeue();
await testCompleteReschedule();
await testOneShotComplete();
await testFail();
await testListAndLogs();
await testPauseResume();
await testConcurrentDequeue();
cleanup();

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
