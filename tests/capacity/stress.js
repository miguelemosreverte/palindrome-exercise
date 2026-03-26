#!/usr/bin/env node
/**
 * Stress test: push a single OpenCode instance to its limits.
 *
 * Tests:
 *   1. max_concurrent  — How many simultaneous users can get responses?
 *   2. rapid_fire      — How many messages/minute can one instance handle?
 *   3. workspace_isolation — Can the /experimental/workspace API isolate users?
 *   4. session_overhead — Memory/performance with 50, 100, 200 sessions
 *   5. heavy_execution — Multiple users running Python scripts simultaneously
 *
 * Usage:
 *   node tests/capacity/stress.js                    # run all
 *   node tests/capacity/stress.js max_concurrent     # one test
 *   node tests/capacity/stress.js --users 20         # override user count
 */

const fs = require('fs');
const path = require('path');

const OC = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';
const RESULTS_FILE = path.join(__dirname, 'stress-results.json');
const MAX_USERS = parseInt(process.argv.find(a => a.startsWith('--users'))?.split('=')?.[1] || process.argv[process.argv.indexOf('--users') + 1]) || 10;

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function createSession() {
  return fetchJSON(OC + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

async function sendMsg(sessionId, text, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(OC + '/session/' + sessionId + '/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;
    if (!res.ok) return { ok: false, elapsed, error: `HTTP ${res.status}` };
    return { ok: true, elapsed };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - start, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(timeout); }
}

// ─── Auto-approve permissions ───
async function approveAll() {
  try {
    const perms = await fetchJSON(OC + '/permission');
    for (const p of (perms || [])) {
      await fetch(OC + '/permission/' + p.id + '/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: 'always' }),
      }).catch(() => {});
    }
  } catch {}
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(times) {
  const valid = times.filter(t => t > 0);
  if (!valid.length) return { count: 0 };
  return {
    count: valid.length,
    min: Math.min(...valid),
    max: Math.max(...valid),
    avg: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length),
    p50: percentile(valid, 50),
    p95: percentile(valid, 95),
    p99: percentile(valid, 99),
  };
}

// ─── Tests ───

const TESTS = {
  /**
   * Ramp up concurrent users: 1, 2, 5, 10, 15, 20
   * Each user sends "Say hi" simultaneously.
   * Measures: success rate, latency distribution, total wall time.
   */
  async max_concurrent() {
    console.log('\n  ── Maximum Concurrent Users ──');
    const levels = [1, 5, 10, 20, 30, 50, 75, 100].filter(n => n <= MAX_USERS);
    const results = {};

    for (const n of levels) {
      process.stdout.write(`    ${n} users ... `);
      const sessions = await Promise.all(Array.from({ length: n }, () => createSession()));
      const start = Date.now();
      const responses = await Promise.allSettled(
        sessions.map(s => sendMsg(s.id, 'Say hi in one word', 30000))
      );
      const wallTime = Date.now() - start;

      const times = responses.map(r => r.status === 'fulfilled' ? r.value.elapsed : -1);
      const succeeded = responses.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      const failed = n - succeeded;
      const errors = responses.filter(r => r.status === 'fulfilled' && !r.value.ok).map(r => r.value.error);

      const s = stats(times.filter(t => t > 0));
      results[`users_${n}`] = { users: n, succeeded, failed, wallTime, ...s, errors: [...new Set(errors)] };

      console.log(`${succeeded}/${n} ok  wall:${wallTime}ms  avg:${s.avg || '?'}ms  p95:${s.p95 || '?'}ms${failed ? `  errors: ${errors.join(', ')}` : ''}`);
    }

    return results;
  },

  /**
   * Rapid-fire: single session, send N messages as fast as possible.
   * Measures throughput (messages/minute).
   */
  async rapid_fire() {
    console.log('\n  ── Rapid Fire (single session throughput) ──');
    const session = await createSession();
    const n = Math.min(10, MAX_USERS);
    const times = [];

    console.log(`    Sending ${n} messages sequentially...`);
    for (let i = 0; i < n; i++) {
      const r = await sendMsg(session.id, `Say "${i}" in one word`, 30000);
      times.push(r.elapsed);
      process.stdout.write(`    msg ${i + 1}: ${r.elapsed}ms ${r.ok ? '✓' : '✗'}\n`);
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const msgsPerMinute = Math.round((n / totalTime) * 60000);
    console.log(`    Total: ${totalTime}ms for ${n} messages`);
    console.log(`    Throughput: ~${msgsPerMinute} messages/minute`);

    return { messages: n, totalTime, msgsPerMinute, ...stats(times) };
  },

  /**
   * Test OpenCode's experimental workspace API for user isolation.
   */
  async workspace_isolation() {
    console.log('\n  ── Workspace Isolation (experimental API) ──');

    // Check if workspace API is available
    let workspaces;
    try {
      workspaces = await fetchJSON(OC + '/experimental/workspace');
      console.log(`    Existing workspaces: ${JSON.stringify(workspaces).slice(0, 200)}`);
    } catch (e) {
      console.log(`    Workspace API not available: ${e.message}`);
      return { available: false, error: e.message };
    }

    // Try creating a workspace
    try {
      const ws = await fetch(OC + '/experimental/workspace', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-user-' + Date.now() }),
      }).then(r => r.text());
      console.log(`    Create workspace: ${ws.slice(0, 200)}`);

      return { available: true, createResult: ws.slice(0, 300) };
    } catch (e) {
      console.log(`    Create workspace failed: ${e.message}`);
      return { available: true, createError: e.message };
    }
  },

  /**
   * Create many sessions and see if performance degrades.
   */
  async session_overhead() {
    console.log('\n  ── Session Overhead ──');

    // Get current count
    const before = await fetchJSON(OC + '/session');
    console.log(`    Sessions before: ${before.length}`);

    // Create 20 more sessions
    const batchSize = 20;
    console.log(`    Creating ${batchSize} sessions...`);
    const start = Date.now();
    await Promise.all(Array.from({ length: batchSize }, () => createSession()));
    const createTime = Date.now() - start;
    console.log(`    Created in ${createTime}ms (${Math.round(createTime / batchSize)}ms/session)`);

    // Check response time with many sessions
    const after = await fetchJSON(OC + '/session');
    console.log(`    Sessions after: ${after.length}`);

    // Measure message latency
    const testSession = await createSession();
    const r = await sendMsg(testSession.id, 'Say hi', 30000);
    console.log(`    Message latency with ${after.length} sessions: ${r.elapsed}ms`);

    return {
      sessionsBefore: before.length,
      sessionsAfter: after.length,
      batchCreateTime: createTime,
      perSessionCreate: Math.round(createTime / batchSize),
      messageLatency: r.elapsed,
    };
  },

  /**
   * Multiple users running Python scripts simultaneously.
   */
  async heavy_execution() {
    console.log('\n  ── Heavy Concurrent Execution ──');
    const permPoller = setInterval(approveAll, 1000);

    const n = Math.min(3, MAX_USERS);
    const sessions = await Promise.all(Array.from({ length: n }, () => createSession()));

    console.log(`    ${n} users running Python scripts simultaneously...`);
    const start = Date.now();
    const results = await Promise.allSettled(
      sessions.map((s, i) => sendMsg(s.id,
        `Run: python3 -c "import time; time.sleep(1); print('USER_${i}_DONE')"`,
        60000
      ))
    );
    const wallTime = Date.now() - start;

    clearInterval(permPoller);

    const times = results.map(r => r.status === 'fulfilled' ? r.value.elapsed : -1);
    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    console.log(`    ${succeeded}/${n} completed in ${wallTime}ms wall time`);
    console.log(`    Individual: ${times.map(t => t + 'ms').join(', ')}`);
    console.log(`    Parallelism: ${wallTime < 10000 ? '✓ Good' : '⚠ Slow'} (expected ~5-8s for parallel Python + LLM overhead)`);

    return { users: n, succeeded, wallTime, individual: times, ...stats(times.filter(t => t > 0)) };
  },
};

// ─── Main ───

async function main() {
  const filter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

  try { await fetch(OC + '/global/health'); }
  catch (e) { console.error(`Cannot reach ${OC}`); process.exit(1); }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   OpenCode Stress Test                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Server: ${OC}`);
  console.log(`  Max users: ${MAX_USERS}`);
  console.log(`  Date: ${new Date().toISOString()}`);

  const tests = filter ? { [filter]: TESTS[filter] } : TESTS;
  if (filter && !TESTS[filter]) {
    console.log(`\nUnknown test: ${filter}. Available: ${Object.keys(TESTS).join(', ')}`);
    process.exit(1);
  }

  const allResults = {};
  for (const [name, fn] of Object.entries(tests)) {
    allResults[name] = await fn();
  }

  // Save
  const saved = { date: new Date().toISOString(), server: OC, maxUsers: MAX_USERS, results: allResults };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(saved, null, 2));
  console.log(`\n  Results saved to ${RESULTS_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
