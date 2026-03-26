#!/usr/bin/env node
/**
 * Compare single-instance vs multi-instance OpenCode capacity.
 *
 * Usage:
 *   node tests/capacity/compare.js                # default: up to 50 users
 *   node tests/capacity/compare.js --users 100    # custom max
 */

const fs = require('fs');
const path = require('path');

const SINGLE = 'https://opencode-production-42c2.up.railway.app';
const MULTI = 'https://palindrome-exercise-production.up.railway.app';
const RESULTS_FILE = path.join(__dirname, 'compare-results.json');
const MAX_USERS = parseInt(process.argv.find(a => a.match(/--users/))?.[1] || process.argv[process.argv.indexOf('--users') + 1]) || 50;

async function sendMsg(base, sessionId, text, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(base + '/session/' + sessionId + '/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      signal: controller.signal,
    });
    return { ok: res.ok, elapsed: Date.now() - start };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - start, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(timeout); }
}

async function createSessions(base, count) {
  return Promise.all(Array.from({ length: count }, () =>
    fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .catch(() => null)
  ));
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)];
}

function stats(times) {
  const valid = times.filter(t => t > 0);
  if (!valid.length) return {};
  return {
    min: Math.min(...valid),
    max: Math.max(...valid),
    avg: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length),
    p50: percentile(valid, 50),
    p95: percentile(valid, 95),
  };
}

async function benchmarkInstance(name, base, levels) {
  console.log(`\n  ── ${name} ──`);
  console.log(`  URL: ${base}`);

  // Health check
  try {
    const h = await fetch(base + '/global/health', { signal: AbortSignal.timeout(5000) });
    if (!h.ok) { console.log('  ✗ Health check failed'); return null; }
  } catch (e) {
    // Try proxy health
    try {
      const h2 = await fetch(base + '/health', { signal: AbortSignal.timeout(5000) });
      const data = await h2.json();
      console.log(`  Health: ${data.healthy}/${data.instances} instances`);
    } catch {
      console.log(`  ✗ Not reachable: ${e.message}`);
      return null;
    }
  }

  const results = {};

  for (const n of levels) {
    process.stdout.write(`  ${String(n).padStart(4)} users ... `);
    const sessions = await createSessions(base, n);
    const validSessions = sessions.filter(s => s?.id);
    if (validSessions.length < n) {
      console.log(`only ${validSessions.length}/${n} sessions created`);
      if (!validSessions.length) continue;
    }

    const start = Date.now();
    const responses = await Promise.allSettled(
      validSessions.map(s => sendMsg(base, s.id, 'Say hi in one word', 30000))
    );
    const wallTime = Date.now() - start;

    const times = responses.map(r => r.status === 'fulfilled' && r.value.ok ? r.value.elapsed : -1);
    const succeeded = responses.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const failed = validSessions.length - succeeded;
    const timeouts = responses.filter(r => r.status === 'fulfilled' && r.value.error === 'timeout').length;
    const s = stats(times);

    results[n] = { users: n, succeeded, failed, timeouts, wallTime, ...s };

    const bar = '█'.repeat(Math.min(40, Math.round((s.avg || 0) / 200)));
    console.log(`${succeeded}/${n} ok  wall:${wallTime}ms  avg:${s.avg || '?'}ms  p95:${s.p95 || '?'}ms ${bar}${failed ? `  ✗${failed} fail` : ''}`);
  }

  return results;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Single vs Multi-Instance Comparison            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Max users: ${MAX_USERS}`);

  const levels = [1, 5, 10, 20, 30, 50, 75, 100].filter(n => n <= MAX_USERS);

  const singleResults = await benchmarkInstance('Single Instance', SINGLE, levels);
  const multiResults = await benchmarkInstance('Multi Instance (3×)', MULTI, levels);

  // Comparison table
  console.log('\n  ── Comparison ──');
  console.log('  ' + 'Users'.padStart(6) + '  ' + 'Single (avg)'.padStart(14) + '  ' + 'Multi (avg)'.padStart(14) + '  ' + 'Speedup'.padStart(10) + '  ' + 'Single ok'.padStart(10) + '  ' + 'Multi ok'.padStart(10));
  console.log('  ' + '─'.repeat(70));

  for (const n of levels) {
    const s = singleResults?.[n];
    const m = multiResults?.[n];
    const sAvg = s?.avg || '—';
    const mAvg = m?.avg || '—';
    const speedup = (s?.avg && m?.avg) ? (s.avg / m.avg).toFixed(2) + '×' : '—';
    const sOk = s ? `${s.succeeded}/${n}` : '—';
    const mOk = m ? `${m.succeeded}/${n}` : '—';
    console.log('  ' + String(n).padStart(6) + '  ' + String(sAvg + 'ms').padStart(14) + '  ' + String(mAvg + 'ms').padStart(14) + '  ' + speedup.padStart(10) + '  ' + sOk.padStart(10) + '  ' + mOk.padStart(10));
  }

  // Save results
  const saved = {
    date: new Date().toISOString(),
    maxUsers: MAX_USERS,
    single: { url: SINGLE, results: singleResults },
    multi: { url: MULTI, instances: 3, results: multiResults },
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(saved, null, 2));
  console.log(`\n  Results saved to ${RESULTS_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
