#!/usr/bin/env node
/**
 * End-to-end tests against OpenCode on Railway.
 *
 * Tests multi-turn, multi-tool scenarios with real API calls.
 * Verifies that tools execute, files persist, and data flows between turns.
 *
 * Usage:
 *   node tests/e2e-opencode.js                  # run all scenarios
 *   node tests/e2e-opencode.js pipeline          # run only pipeline scenario
 *   node tests/e2e-opencode.js persistence       # run only persistence scenario
 */

const OPENCODE = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';

// ─── API helpers ───

async function createSession() {
  const res = await fetch(OPENCODE + '/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  return res.json();
}

// Use the default model (whatever OpenCode picks — it used tools successfully before)
const DEFAULT_MODEL = undefined;

async function sendMessage(sessionId, text, model) {
  const body = { parts: [{ type: 'text', text }] };
  if (model || DEFAULT_MODEL) body.model = model || DEFAULT_MODEL;

  // Start auto-approving permissions in the background
  const permPoller = startPermissionPoller(sessionId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    // Send the message (this blocks until the full response is ready)
    await fetch(OPENCODE + '/session/' + sessionId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // Then fetch ALL messages to get the complete multi-step response
    const allMsgs = await fetch(OPENCODE + '/session/' + sessionId + '/message').then(r => r.json());
    return { _allMessages: allMsgs };
  } finally {
    clearTimeout(timeout);
    permPoller.stop();
  }
}

// Auto-approve all permissions (tool use, file writes, bash, etc.)
function startPermissionPoller(sessionId) {
  let running = true;

  async function poll() {
    while (running) {
      try {
        const perms = await fetch(OPENCODE + '/permission').then(r => r.json());
        for (const p of (perms || [])) {
          if (p.sessionID === sessionId || !sessionId) {
            await fetch(OPENCODE + '/permission/' + p.id + '/reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reply: 'always' }),
            });
            console.log(`    [auto-approved: ${p.permission} ${p.patterns?.join(', ') || ''}]`);
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  poll();
  return { stop: () => { running = false; } };
}

async function getMessages(sessionId) {
  return fetch(OPENCODE + '/session/' + sessionId + '/message').then(r => r.json());
}

async function getSession(sessionId) {
  return fetch(OPENCODE + '/session/' + sessionId).then(r => r.json());
}

// ─── Part analysis helpers ───

function extractParts(response) {
  // Handle multi-message responses from OpenCode
  const allMessages = response._allMessages || [response];
  const result = {
    text: [],
    tools: [],
    reasoning: [],
    raw: [],
  };

  for (const msg of allMessages) {
    const parts = msg.parts || msg.info?.parts || [];
    result.raw.push(...parts);
    for (const p of parts) {
      if (p.type === 'text' && p.text) result.text.push(p.text);
      if (p.type === 'tool') {
        result.tools.push({
          name: p.tool,
          status: p.state?.status,
          input: p.state?.input,
          output: p.state?.output,
          error: p.state?.error,
        });
      }
      if (p.type === 'reasoning' && p.text) result.reasoning.push(p.text);
    }
  }

  return result;
}

// Extract parts from only the NEW messages (after a specific count)
function extractNewParts(response, afterCount) {
  const allMessages = response._allMessages || [];
  const newMsgs = allMessages.slice(afterCount);
  return extractParts({ _allMessages: newMsgs });
}

function hasToolCall(parts, toolName) {
  return parts.tools.some(t => t.name === toolName);
}

function getToolOutput(parts, toolName) {
  const tool = parts.tools.find(t => t.name === toolName && t.status === 'completed');
  return tool?.output || null;
}

function getToolError(parts, toolName) {
  const tool = parts.tools.find(t => t.name === toolName);
  return tool?.error || null;
}

function allToolsSucceeded(parts) {
  return parts.tools.every(t => t.status === 'completed');
}

// ─── Test runner ───

const results = [];

async function runTest(name, fn) {
  const start = Date.now();
  process.stdout.write(`\n  ${name} ... `);

  try {
    const result = await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (result.pass) {
      console.log(`\x1b[32m✓\x1b[0m (${elapsed}s)`);
      if (result.details) {
        for (const d of result.details) console.log(`    ${d}`);
      }
    } else {
      console.log(`\x1b[31m✗\x1b[0m (${elapsed}s) — ${result.reason}`);
      if (result.details) {
        for (const d of result.details) console.log(`    ${d}`);
      }
    }

    results.push({ name, ...result, elapsed });
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\x1b[31m✗\x1b[0m (${elapsed}s) — ${err.message}`);
    results.push({ name, pass: false, reason: err.message, elapsed });
  }
}

// ─── Scenarios ───

const SCENARIOS = {

  // Test 1: Basic tool use — Python via bash
  async python_basic() {
    const session = await createSession();
    const res = await sendMessage(session.id,
      'Create a file /tmp/fib.py that prints the first 15 fibonacci numbers, then run it with python3. Show me the output.');
    const parts = extractParts(res);

    const toolNames = parts.tools.map(t => t.name);
    const details = [
      `Tools used: ${parts.tools.map(t => `${t.name}(${t.status})`).join(', ') || 'none'}`,
      `Text: ${parts.text.join(' ').slice(0, 100)}`,
    ];

    const hasTools = toolNames.length > 0;
    const hasText = parts.text.join(' ').length > 10;
    const hasFibonacci = parts.text.join(' ').includes('0') && parts.text.join(' ').includes('377');

    if (!hasTools && !hasText) return { pass: false, reason: 'No tools and no text output', details };

    details.push(hasTools ? `✓ Used tools: ${toolNames.join(', ')}` : '⚠ No tools used (model answered from knowledge)');
    details.push(hasFibonacci ? '✓ Fibonacci output correct' : '⚠ Fibonacci output not verified');

    return { pass: hasText, details };
  },

  // Test 2: Web search
  async websearch_basic() {
    const session = await createSession();
    const res = await sendMessage(session.id,
      'Search the web for "OpenCode AI coding agent" and tell me what you find.');
    const parts = extractParts(res);

    const details = [
      `Tools used: ${parts.tools.map(t => t.name).join(', ') || 'none'}`,
      `Text: ${parts.text.join(' ').slice(0, 150)}`,
    ];

    const hasSearch = hasToolCall(parts, 'websearch') || hasToolCall(parts, 'webfetch');
    if (!hasSearch) return { pass: false, reason: 'No websearch/webfetch tool call', details };

    return { pass: true, details };
  },

  // Test 3: File write + read persistence
  async file_persistence() {
    const session = await createSession();

    // Turn 1: Write a file
    const res1 = await sendMessage(session.id,
      'Create a file called /tmp/test_data.json with this content: {"cities": ["Buenos Aires", "Lima", "Santiago"], "populations": [15000000, 10000000, 7000000]}');
    const parts1 = extractParts(res1);

    const hasWrite = hasToolCall(parts1, 'write') || hasToolCall(parts1, 'bash');
    if (!hasWrite) return { pass: false, reason: 'Turn 1: No write/bash tool to create file', details: [`Tools: ${parts1.tools.map(t=>t.name).join(', ')}`] };

    // Turn 2: Read the file back and use the data
    const res2 = await sendMessage(session.id,
      'Now read /tmp/test_data.json and tell me which city has the largest population.');
    const parts2 = extractParts(res2);

    const hasRead = hasToolCall(parts2, 'read') || hasToolCall(parts2, 'bash');
    const text2 = parts2.text.join(' ').toLowerCase();
    const mentionsBuenosAires = text2.includes('buenos aires');

    return {
      pass: hasRead && mentionsBuenosAires,
      reason: !hasRead ? 'Turn 2: No read tool' : !mentionsBuenosAires ? 'Turn 2: Did not identify Buenos Aires' : '',
      details: [
        `Turn 1 tools: ${parts1.tools.map(t => `${t.name}(${t.status})`).join(', ')}`,
        `Turn 2 tools: ${parts2.tools.map(t => `${t.name}(${t.status})`).join(', ')}`,
        `Turn 2 text: ${text2.slice(0, 150)}`,
      ],
    };
  },

  // Test 4: FULL PIPELINE — bash(python) → file → read → modify → verify
  async pipeline_python_file_persist() {
    const session = await createSession();
    const ts = Date.now();
    const file = `/tmp/pipeline_${ts}.json`;

    // Turn 1: Run Python via bash to create a file with unique timestamped data
    const res1 = await sendMessage(session.id,
      `Run this exact command with bash:\npython3 -c "import json; data={'id':${ts},'items':['alpha','beta','gamma'],'scores':[10,20,30]}; f=open('${file}','w'); json.dump(data,f); f.close(); print('WRITTEN:', json.dumps(data))"`);
    const parts1 = extractParts(res1);
    const tools1 = parts1.tools.map(t => t.name);
    const allText1 = [...parts1.text, ...parts1.tools.map(t => t.output || '')].join(' ');

    const details = [
      `Turn 1 tools: ${parts1.tools.map(t => `${t.name}(${t.status})`).join(', ') || 'none'}`,
      `Turn 1 mentions WRITTEN: ${allText1.includes('WRITTEN')}`,
    ];

    // Turn 2: Read back the file (proves persistence)
    const res2 = await sendMessage(session.id,
      `Read the file ${file} and tell me the exact contents.`);
    const parts2 = extractParts(res2);
    const allText2 = [...parts2.text, ...parts2.tools.map(t => t.output || '')].join(' ');
    const hasTimestamp = allText2.includes(String(ts));

    details.push(`Turn 2 tools: ${parts2.tools.map(t => `${t.name}(${t.status})`).join(', ') || 'none'}`);
    details.push(`Turn 2 has timestamp ${ts}: ${hasTimestamp}`);
    details.push(`Turn 2 text: ${allText2.slice(0, 200)}`);

    // Verify: timestamp in output means the file was actually created and read
    const issues = [];
    if (!tools1.length && !allText1.includes('WRITTEN')) issues.push('Turn 1: No tools and no evidence of execution');
    if (!hasTimestamp) issues.push(`Turn 2: Timestamp ${ts} not found — file not persisted or not read`);

    return { pass: issues.length === 0, reason: issues.join('; '), details };
  },

  // Test 5: Multi-turn data refinement — build on previous results
  async persistence_multi_turn() {
    const session = await createSession();

    // Turn 1: Create initial data
    const res1 = await sendMessage(session.id,
      'Write a Python script at /tmp/analysis.py that generates a list of 10 random numbers between 1-100, calculates mean, median, min, max, and saves the results as JSON to /tmp/stats.json. Then run it.');
    const parts1 = extractParts(res1);

    // Turn 2: Read and extend
    const res2 = await sendMessage(session.id,
      'Read /tmp/stats.json. Now modify /tmp/analysis.py to also calculate standard deviation and add it to the JSON. Run it again.');
    const parts2 = extractParts(res2);

    // Turn 3: Verify persistence
    const res3 = await sendMessage(session.id,
      'Read /tmp/stats.json and tell me all the statistics it contains.');
    const parts3 = extractParts(res3);

    const text3 = parts3.text.join(' ').toLowerCase();
    const hasStdDev = text3.includes('standard deviation') || text3.includes('std') || text3.includes('desviación');
    const hasMean = text3.includes('mean') || text3.includes('media') || text3.includes('promedio');

    const details = [
      `Turn 1 tools: ${parts1.tools.map(t => `${t.name}(${t.status})`).join(', ')}`,
      `Turn 2 tools: ${parts2.tools.map(t => `${t.name}(${t.status})`).join(', ')}`,
      `Turn 3 text: ${text3.slice(0, 200)}`,
      `Has std dev: ${hasStdDev}, Has mean: ${hasMean}`,
    ];

    return {
      pass: hasStdDev && hasMean,
      reason: !hasMean ? 'No mean in final stats' : !hasStdDev ? 'No std deviation in final stats' : '',
      details,
    };
  },
  // Test 6: Rich component — timeline
  async component_timeline() {
    const session = await createSession();
    const res = await sendMessage(session.id,
      'Haceme una línea de tiempo de las 5 batallas más importantes de la historia argentina. Usá el bloque ```timeline con JSON.');
    const parts = extractParts(res);
    const allText = parts.text.join(' ');
    const hasTimeline = allText.includes('```timeline') || allText.includes('"items"');
    return {
      pass: hasTimeline,
      reason: hasTimeline ? '' : 'No ```timeline block found in response',
      details: [`Text preview: ${allText.slice(0, 300)}`],
    };
  },

  // Test 7: Rich component — options
  async component_options() {
    const session = await createSession();
    const res = await sendMessage(session.id,
      'Proponeme 4 destinos de viaje en Argentina con descripción. Usá el bloque ```options con JSON.');
    const parts = extractParts(res);
    const allText = parts.text.join(' ');
    const hasOptions = allText.includes('```options') || allText.includes('"items"');
    return {
      pass: hasOptions,
      reason: hasOptions ? '' : 'No ```options block found',
      details: [`Text preview: ${allText.slice(0, 300)}`],
    };
  },

  // Test 8: Rich component — tree decision
  async component_tree() {
    const session = await createSession();
    const res = await sendMessage(session.id,
      'Ayudame a elegir una carrera universitaria. Primero preguntame qué área me interesa (ciencias, humanidades, ingeniería), después proponeme opciones específicas. Usá el bloque ```tree con JSON.');
    const parts = extractParts(res);
    const allText = parts.text.join(' ');
    const hasTree = allText.includes('```tree') || allText.includes('"levels"') || allText.includes('"choices"');
    return {
      pass: hasTree,
      reason: hasTree ? '' : 'No ```tree block found',
      details: [`Text preview: ${allText.slice(0, 300)}`],
    };
  },
};

// ─── Main ───

async function main() {
  const filter = process.argv[2];

  console.log(`\nOpenCode E2E Tests`);
  console.log(`Server: ${OPENCODE}`);

  // Verify connectivity
  try {
    const health = await fetch(OPENCODE + '/global/health');
    console.log(`Health: ${health.status === 200 ? '✓ connected' : '✗ ' + health.status}`);
  } catch (e) {
    console.error(`\n✗ Cannot reach ${OPENCODE}: ${e.message}`);
    process.exit(1);
  }

  const scenarios = filter
    ? Object.entries(SCENARIOS).filter(([k]) => k.includes(filter))
    : Object.entries(SCENARIOS);

  console.log(`Running ${scenarios.length} scenario(s):\n`);

  for (const [name, fn] of scenarios) {
    await runTest(name, fn);
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m out of ${results.length}`);

  if (failed > 0) {
    console.log('\nFailed:');
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.reason}`);
    }
    process.exit(1);
  }
  console.log('');
}

main();
