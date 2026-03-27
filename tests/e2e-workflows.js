#!/usr/bin/env node
/**
 * End-to-end workflow tests for multi-step conversations against OpenCode.
 * Caches model responses to disk — only re-calls with --rebuild.
 *
 * Usage:
 *   node tests/e2e-workflows.js                       # run all (uses cache)
 *   node tests/e2e-workflows.js --rebuild              # re-fetch all from API
 *   node tests/e2e-workflows.js research-and-chart     # run one workflow
 *   node tests/e2e-workflows.js data-pipeline --rebuild # rebuild one
 */

const fs = require('fs');
const path = require('path');

const OC = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';
const CACHE_DIR = path.join(__dirname, 'workflow-cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── System prompt (same as production chat.html) ───
const SYSTEM = `Respond concisely. When asked to output ONLY a specific block, output ONLY that block with no extra text.

Available Bridge components (use fenced code blocks):
- \`\`\`timeline — chronological events. JSON: {"items":[{"date":"...","title":"...","desc":"..."}]}
- \`\`\`options — alternatives. JSON: {"items":[{"title":"...","desc":"..."}]}
- \`\`\`cards — metrics. JSON: {"items":[{"label":"...","value":"...","desc":"..."}]}
- \`\`\`table — tabular data. JSON: {"headers":["Col1","Col2"],"rows":[["a","b"]]}
- \`\`\`steps — instructions. JSON: {"items":[{"title":"...","desc":"..."}]}
- \`\`\`status — task statuses. JSON: {"items":[{"label":"...","status":"done|working|pending"}]}
- \`\`\`chartjs — Chart.js v4 config. Pure JSON.
- \`\`\`quote — callouts. JSON: {"text":"...","style":"info|warning|success|error"}

Use the component that best fits. When told to output ONLY a block, no prose.`;

// ─── API (multi-turn session) ───
async function createSession() {
  const res = await fetch(OC + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const session = await res.json();
  return session.id;
}

async function sendMessage(sessionId, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    await fetch(OC + '/session/' + sessionId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: prompt }], system: SYSTEM }),
      signal: controller.signal,
    });
    const msgs = await fetch(OC + '/session/' + sessionId + '/message').then(r => r.json());
    // Get the last assistant message
    const allText = msgs.flatMap(m => (m.parts || []).filter(p => p.type === 'text').map(p => p.text)).join('\n');
    return allText;
  } finally {
    clearTimeout(timeout);
  }
}

function extractBlock(text, lang) {
  const parts = text.split('```');
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i].startsWith(lang + '\n') || parts[i].startsWith(lang + '\r')) {
      return parts[i].replace(new RegExp('^' + lang + '\\s*\\n'), '').trim();
    }
  }
  return null;
}

function tryParseJSON(str) {
  try { return { ok: true, data: JSON.parse(str) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function hasBlock(text, lang) {
  return text.includes('```' + lang);
}

// ─── Workflow test definitions ───
const WORKFLOW_TESTS = [
  {
    name: 'research-and-chart',
    description: 'Search → process → render chart',
    steps: [
      {
        prompt: 'Search the web for the current Bitcoin price and give me the result as a number',
        validate: (response) => {
          // Check it contains a number (price-like)
          const match = response.match(/[\d,]+\.?\d*/);
          if (!match) return { pass: false, reason: 'No number found in response' };
          const num = parseFloat(match[0].replace(/,/g, ''));
          if (isNaN(num) || num < 100) return { pass: false, reason: 'Number does not look like a BTC price: ' + match[0] };
          return { pass: true };
        }
      },
      {
        prompt: 'Now write a Python script that generates Chart.js JSON config for a simple bar chart showing BTC at that price vs ETH at $3,500 vs SOL at $180. Output ONLY the chartjs JSON block.',
        validate: (response) => {
          const block = extractBlock(response, 'chartjs');
          if (!block) {
            if (hasBlock(response, 'chartjs')) return { pass: false, reason: 'chartjs block found but could not extract JSON' };
            return { pass: false, reason: 'No ```chartjs block found' };
          }
          const parsed = tryParseJSON(block);
          if (!parsed.ok) return { pass: false, reason: 'Invalid JSON in chartjs block: ' + parsed.error };
          if (!parsed.data.type) return { pass: false, reason: 'chartjs JSON missing "type" field' };
          if (!parsed.data.data) return { pass: false, reason: 'chartjs JSON missing "data" field' };
          return { pass: true };
        }
      }
    ]
  },
  {
    name: 'data-pipeline',
    description: 'Generate data → process with Python → render as table',
    steps: [
      {
        prompt: 'Generate a JSON array of 5 fictional companies with name, revenue (number), and growth (percentage string). Output raw JSON only.',
        validate: (response) => {
          // Try to extract JSON from the response
          let jsonStr = response.trim();
          // Strip markdown code fences if present
          const jsonBlock = extractBlock(response, 'json');
          if (jsonBlock) jsonStr = jsonBlock;
          const parsed = tryParseJSON(jsonStr);
          if (!parsed.ok) return { pass: false, reason: 'Response is not valid JSON: ' + parsed.error };
          if (!Array.isArray(parsed.data)) return { pass: false, reason: 'Response is not a JSON array' };
          if (parsed.data.length < 3) return { pass: false, reason: 'Expected at least 3 companies, got ' + parsed.data.length };
          const first = parsed.data[0];
          if (!first.name && !first.company) return { pass: false, reason: 'First item missing "name" or "company" field' };
          return { pass: true };
        }
      },
      {
        prompt: 'Take that data and format it as a Bridge table component. Use ```table block with headers ["Company", "Revenue", "Growth"] and rows from the data. Output ONLY the table block.',
        validate: (response) => {
          const block = extractBlock(response, 'table');
          if (!block) {
            if (hasBlock(response, 'table')) return { pass: false, reason: 'table block found but could not extract JSON' };
            return { pass: false, reason: 'No ```table block found' };
          }
          const parsed = tryParseJSON(block);
          if (!parsed.ok) return { pass: false, reason: 'Invalid JSON in table block: ' + parsed.error };
          if (!parsed.data.headers || !Array.isArray(parsed.data.headers)) return { pass: false, reason: 'Missing or invalid "headers" array' };
          if (!parsed.data.rows || !Array.isArray(parsed.data.rows)) return { pass: false, reason: 'Missing or invalid "rows" array' };
          if (parsed.data.rows.length < 3) return { pass: false, reason: 'Expected at least 3 rows, got ' + parsed.data.rows.length };
          return { pass: true };
        }
      }
    ]
  },
  {
    name: 'multi-component-report',
    description: 'Generate a full report with multiple component types',
    steps: [
      {
        prompt: 'Create a project status report using these Bridge components in a single message:\n1. A ```status block showing 3 tasks (auth: done, tests: working, deploy: pending)\n2. A ```cards block with 3 metrics (Coverage: 87%, Tests: 142, Build: 2.3s)\n3. A ```timeline block with 3 recent events\nOutput all three blocks in one message.',
        validate: (response) => {
          const issues = [];
          // Check for status block
          const statusBlock = extractBlock(response, 'status');
          if (!statusBlock) {
            issues.push('No ```status block found');
          } else {
            const parsed = tryParseJSON(statusBlock);
            if (!parsed.ok) issues.push('Invalid JSON in status block');
            else if (!(parsed.data.items || []).length && !Array.isArray(parsed.data)) issues.push('status block has no items');
          }
          // Check for cards block
          const cardsBlock = extractBlock(response, 'cards');
          if (!cardsBlock) {
            issues.push('No ```cards block found');
          } else {
            const parsed = tryParseJSON(cardsBlock);
            if (!parsed.ok) issues.push('Invalid JSON in cards block');
            else if (!(parsed.data.items || []).length && !Array.isArray(parsed.data)) issues.push('cards block has no items');
          }
          // Check for timeline block
          const timelineBlock = extractBlock(response, 'timeline');
          if (!timelineBlock) {
            issues.push('No ```timeline block found');
          } else {
            const parsed = tryParseJSON(timelineBlock);
            if (!parsed.ok) issues.push('Invalid JSON in timeline block');
            else if (!(parsed.data.items || []).length && !Array.isArray(parsed.data)) issues.push('timeline block has no items');
          }
          if (issues.length) return { pass: false, reason: issues.join('; ') };
          return { pass: true };
        }
      }
    ]
  }
];

// ─── Runner ───
async function runWorkflow(workflow, rebuild) {
  const cacheFile = path.join(CACHE_DIR, workflow.name + '.json');
  let cached = {};
  let sessionId = null;

  if (!rebuild && fs.existsSync(cacheFile)) {
    cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  const results = [];
  let allCached = true;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const stepKey = 'step_' + i;
    let response;

    if (!rebuild && cached[stepKey]) {
      response = cached[stepKey].response;
      process.stdout.write(`    Step ${i + 1} (cached) ... `);
    } else {
      allCached = false;
      process.stdout.write(`    Step ${i + 1} (fetching) ... `);
      try {
        // Create session on first non-cached step
        if (!sessionId) sessionId = await createSession();
        response = await sendMessage(sessionId, step.prompt);
        cached[stepKey] = { prompt: step.prompt, response, date: new Date().toISOString() };
      } catch (e) {
        console.log(`\x1b[31m\u2717\x1b[0m Fetch failed: ${e.message}`);
        results.push({ step: i + 1, pass: false, reason: 'Fetch failed: ' + e.message });
        break; // Can't continue multi-turn if a step fails
      }
    }

    const result = step.validate(response);
    if (result.pass) {
      console.log(`\x1b[32m\u2713\x1b[0m`);
    } else {
      console.log(`\x1b[31m\u2717\x1b[0m ${result.reason}`);
    }
    results.push({ step: i + 1, ...result });

    // Stop workflow if a step fails (subsequent steps depend on context)
    if (!result.pass) break;
  }

  // Save cache
  fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2));

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const rebuild = args.includes('--rebuild');
  const filter = args.find(a => !a.startsWith('--'));

  // Connectivity check
  try {
    const h = await fetch(OC + '/global/health');
    if (!h.ok) throw new Error(h.status);
  } catch (e) {
    console.error(`Cannot reach ${OC}: ${e.message}`);
    process.exit(1);
  }

  console.log(`\nWorkflow Integration Tests`);
  console.log(`Server: ${OC}`);
  console.log(`Cache: ${CACHE_DIR}`);
  console.log(`Mode: ${rebuild ? 'REBUILD (fetching from API)' : 'CACHED (use --rebuild to refresh)'}\n`);

  const workflows = filter
    ? WORKFLOW_TESTS.filter(w => w.name === filter)
    : WORKFLOW_TESTS;

  if (filter && !workflows.length) {
    console.log(`Unknown workflow: ${filter}. Available: ${WORKFLOW_TESTS.map(w => w.name).join(', ')}`);
    process.exit(1);
  }

  let totalPass = 0;
  let totalFail = 0;
  const failures = [];

  for (const workflow of workflows) {
    console.log(`  \x1b[1m${workflow.name}\x1b[0m — ${workflow.description}`);
    const results = await runWorkflow(workflow, rebuild);
    for (const r of results) {
      if (r.pass) totalPass++;
      else {
        totalFail++;
        failures.push({ workflow: workflow.name, step: r.step, reason: r.reason });
      }
    }
    console.log('');
  }

  console.log(`${'─'.repeat(50)}`);
  console.log(`\x1b[32m${totalPass} passed\x1b[0m, \x1b[31m${totalFail} failed\x1b[0m out of ${totalPass + totalFail} steps`);

  if (failures.length) {
    console.log('\nFailed:');
    failures.forEach(f => console.log(`  \x1b[31m\u2717\x1b[0m ${f.workflow} step ${f.step}: ${f.reason}`));
    process.exit(1);
  }
  console.log('');
}

main();
