#!/usr/bin/env node
/**
 * Capacity benchmark for the OpenCode Railway instance.
 *
 * Measures:
 *   1. Session creation throughput (how fast can we spin up user sessions)
 *   2. Concurrent message handling (can multiple users chat at once)
 *   3. Filesystem isolation (do users see each other's files)
 *   4. Concurrent code execution (does one user's script block another)
 *   5. Memory/session overhead (how many sessions can we hold)
 *
 * Usage:
 *   node tests/capacity/benchmark.js                # run full benchmark
 *   node tests/capacity/benchmark.js sessions       # only session tests
 *   node tests/capacity/benchmark.js concurrent     # only concurrency tests
 *   node tests/capacity/benchmark.js isolation      # only file isolation test
 *   node tests/capacity/benchmark.js execution      # only code execution test
 *
 * Results are saved to tests/capacity/results.json
 */

const fs = require('fs');
const path = require('path');

const OC = process.env.OPENCODE_URL || 'https://opencode-production-42c2.up.railway.app';
const RESULTS_FILE = path.join(__dirname, 'results.json');

// ─── Helpers ───

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

async function createSession() {
  return fetchJSON(OC + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

async function sendMessage(sessionId, text, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const start = Date.now();
    await fetch(OC + '/session/' + sessionId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      signal: controller.signal,
    });
    return { ok: true, elapsed: Date.now() - start };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - start, error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function getMessages(sessionId) {
  return fetchJSON(OC + '/session/' + sessionId + '/message');
}

function getTextFromMessages(msgs) {
  return msgs.flatMap(m => (m.parts || []).filter(p => p.type === 'text').map(p => p.text)).join('\n');
}

function getToolOutput(msgs) {
  return msgs.flatMap(m => (m.parts || []).filter(p => p.type === 'tool').map(t => t.state?.output || '')).join('\n');
}

// ─── Tests ───

const TESTS = {
  /**
   * Test 1: Session creation throughput
   * How quickly can we create N sessions? This determines how fast new users can onboard.
   */
  async sessions() {
    console.log('\n  ── Session Creation Throughput ──');
    const counts = [1, 5, 10];
    const results = {};

    for (const n of counts) {
      const start = Date.now();
      const sessions = await Promise.all(Array.from({ length: n }, () => createSession()));
      const elapsed = Date.now() - start;
      const allOk = sessions.every(s => s.id);
      results[`create_${n}`] = { count: n, elapsed, perSession: Math.round(elapsed / n), allOk };
      console.log(`    ${n} sessions: ${elapsed}ms total (${Math.round(elapsed / n)}ms/session) ${allOk ? '✓' : '✗'}`);
    }

    // Count total sessions on the instance
    const allSessions = await fetchJSON(OC + '/session');
    results.totalSessions = allSessions.length;
    console.log(`    Total sessions on instance: ${allSessions.length}`);

    return results;
  },

  /**
   * Test 2: Concurrent message handling
   * Can multiple users get responses simultaneously, or are they serialized?
   * We send N messages in parallel and measure if total time ≈ single message time (parallel)
   * or N × single message time (serialized).
   */
  async concurrent() {
    console.log('\n  ── Concurrent Message Handling ──');

    // Baseline: single message latency
    const baseSession = await createSession();
    const baseline = await sendMessage(baseSession.id, 'Say hi in one word');
    console.log(`    Baseline (1 user): ${baseline.elapsed}ms`);

    // Concurrent: 3 users simultaneously
    const sessions3 = await Promise.all(Array.from({ length: 3 }, () => createSession()));
    const start3 = Date.now();
    const results3 = await Promise.allSettled(
      sessions3.map(s => sendMessage(s.id, 'Say hello in one word'))
    );
    const elapsed3 = Date.now() - start3;
    const ok3 = results3.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const individual3 = results3.map(r => r.status === 'fulfilled' ? r.value.elapsed : -1);
    console.log(`    3 concurrent users: ${elapsed3}ms total, ${ok3}/3 succeeded`);
    console.log(`    Individual times: ${individual3.join(', ')}ms`);
    console.log(`    Parallelism: ${elapsed3 < baseline.elapsed * 2 ? '✓ Parallel' : '⚠ Likely serialized'} (${(elapsed3 / baseline.elapsed).toFixed(1)}x baseline)`);

    // Concurrent: 5 users simultaneously
    const sessions5 = await Promise.all(Array.from({ length: 5 }, () => createSession()));
    const start5 = Date.now();
    const results5 = await Promise.allSettled(
      sessions5.map(s => sendMessage(s.id, 'Say hi in one word'))
    );
    const elapsed5 = Date.now() - start5;
    const ok5 = results5.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    console.log(`    5 concurrent users: ${elapsed5}ms total, ${ok5}/5 succeeded`);
    console.log(`    Parallelism: ${(elapsed5 / baseline.elapsed).toFixed(1)}x baseline`);

    return {
      baseline: baseline.elapsed,
      concurrent3: { elapsed: elapsed3, succeeded: ok3, individual: individual3 },
      concurrent5: { elapsed: elapsed5, succeeded: ok5 },
      parallelism3x: +(elapsed3 / baseline.elapsed).toFixed(2),
      parallelism5x: +(elapsed5 / baseline.elapsed).toFixed(2),
    };
  },

  /**
   * Test 3: Filesystem isolation
   * Can User B read files created by User A?
   * This determines if we need per-user directories or containers.
   */
  async isolation() {
    console.log('\n  ── Filesystem Isolation ──');
    const ts = Date.now();
    const marker = `ISOLATION_TEST_${ts}`;
    const filePath = `/tmp/isolation_${ts}.txt`;

    // User A writes a file
    const sessionA = await createSession();
    console.log(`    User A: writing "${marker}" to ${filePath}...`);
    await sendMessage(sessionA.id, `Run this exact command: echo "${marker}" > ${filePath} && cat ${filePath}`);
    const msgsA = await getMessages(sessionA.id);
    const outA = getToolOutput(msgsA);
    const wroteOk = outA.includes(marker);
    console.log(`    User A wrote: ${wroteOk ? '✓' : '✗'} (${outA.trim().slice(0, 80)})`);

    // User B tries to read User A's file
    const sessionB = await createSession();
    console.log(`    User B: reading ${filePath}...`);
    await sendMessage(sessionB.id, `Run this exact command: cat ${filePath} 2>&1`);
    const msgsB = await getMessages(sessionB.id);
    const outB = getToolOutput(msgsB);
    const canRead = outB.includes(marker);
    console.log(`    User B reads: ${outB.trim().slice(0, 80)}`);

    const isolated = !canRead;
    console.log(`    Filesystem isolation: ${isolated ? '✓ ISOLATED (users cannot see each other)' : '❌ SHARED (users CAN see each other\'s files)'}`);

    return {
      marker,
      filePath,
      userA_wrote: wroteOk,
      userB_canRead: canRead,
      isolated,
      verdict: isolated ? 'Files are isolated per session' : 'WARNING: All sessions share the same filesystem. Users can read/write each other\'s files.',
      recommendation: isolated ? 'No action needed' : 'Need per-user directories (/home/{userId}/) or separate containers per user',
    };
  },

  /**
   * Test 4: Concurrent code execution
   * Does User A's long-running script block User B's quick command?
   */
  async execution() {
    console.log('\n  ── Concurrent Code Execution ──');

    // User A: long-running script (sleep 5)
    const sessionA = await createSession();
    // User B: quick command
    const sessionB = await createSession();

    console.log('    Starting User A (slow: sleep 3) and User B (fast: echo) in parallel...');
    const start = Date.now();
    const [resultA, resultB] = await Promise.allSettled([
      sendMessage(sessionA.id, 'Run: sleep 3 && echo SLOW_DONE'),
      // Small delay so B starts after A is already running
      new Promise(r => setTimeout(r, 500)).then(() => sendMessage(sessionB.id, 'Run: echo FAST_DONE')),
    ]);

    const elapsedA = resultA.status === 'fulfilled' ? resultA.value.elapsed : -1;
    const elapsedB = resultB.status === 'fulfilled' ? resultB.value.elapsed : -1;
    const total = Date.now() - start;

    console.log(`    User A (slow): ${elapsedA}ms`);
    console.log(`    User B (fast): ${elapsedB}ms`);
    console.log(`    Total wall time: ${total}ms`);

    const bBlocked = elapsedB > 5000; // If B took >5s, it was blocked by A
    console.log(`    User B blocked by User A: ${bBlocked ? '❌ YES (serialized execution)' : '✓ NO (parallel execution)'}`);

    return {
      userA_elapsed: elapsedA,
      userB_elapsed: elapsedB,
      totalWallTime: total,
      userB_blocked: bBlocked,
      verdict: bBlocked
        ? 'Code execution is SERIALIZED — one user\'s script blocks others'
        : 'Code execution is PARALLEL — users don\'t block each other',
    };
  },
};

// ─── Main ───

async function main() {
  const filter = process.argv[2];

  // Connectivity check
  try {
    await fetch(OC + '/global/health');
  } catch (e) {
    console.error(`Cannot reach ${OC}: ${e.message}`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   OpenCode Capacity Benchmark            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Server: ${OC}`);
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

  // Save results
  const saved = {
    date: new Date().toISOString(),
    server: OC,
    results: allResults,
  };

  // Merge with existing results if present
  let existing = {};
  if (fs.existsSync(RESULTS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch {}
  }
  saved.history = [...(existing.history || []), { date: saved.date, results: allResults }].slice(-10);

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(saved, null, 2));
  console.log(`\n  Results saved to ${RESULTS_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
