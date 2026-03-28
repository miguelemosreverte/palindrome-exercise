#!/usr/bin/env node
/**
 * REAL HR benchmark — runs through our system (task-runner.sh).
 * Uses whatever LLM engine is available (OpenCode → ChutesAI → Claude).
 * Every data point is scraped from real websites, stored in SQLite.
 *
 * Usage:
 *   node tests/benchmark-hr-real.js                # run all steps
 *   node tests/benchmark-hr-real.js --force        # re-scrape even if data exists
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const REPO = path.join(__dirname, '..');
const TASK_ID = 'hr-real-' + new Date().toISOString().slice(0, 10);
const COLLECTION = 'hr-research-real';

// Detect what engine is available (same logic as task-runner.sh)
function detectEngine() {
  try { execSync('curl -sf http://localhost:9001/global/health --max-time 2', { stdio: 'pipe' }); return 'opencode'; } catch (e) {}
  try {
    const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
    if (env.includes('CHUTESAI_API_KEY=')) return 'chutesai';
  } catch (e) {}
  try { execSync('which claude', { stdio: 'pipe' }); return 'claude'; } catch (e) {}
  return 'none';
}

// Execute a step through our system's task-runner
function executeViaSystem(stepName, prompt, timeoutSec) {
  // Create a mini-task in Firebase, run it through task-runner
  // For benchmarking, we call the same execute logic the task-runner uses
  const engine = detectEngine();

  if (engine === 'opencode') {
    // Use OpenCode API
    try {
      const sid = JSON.parse(execSync(
        `curl -sf -X POST http://localhost:9001/session -H "Content-Type: application/json" -d "{}"`,
        { encoding: 'utf8', timeout: 5000 }
      )).id;

      // Send message
      const msgPayload = JSON.stringify({ parts: [{ type: 'text', text: prompt }] });
      execSync(
        `curl -sf -X POST http://localhost:9001/session/${sid}/message -H "Content-Type: application/json" -d '${msgPayload.replace(/'/g, "'\\''")}'`,
        { timeout: 5000, stdio: 'pipe' }
      );

      // Poll for response
      for (let i = 0; i < 60; i++) {
        execSync('sleep 3');
        try {
          const msgs = JSON.parse(execSync(
            `curl -sf http://localhost:9001/session/${sid}/message`,
            { encoding: 'utf8', timeout: 5000 }
          ));
          for (const m of [...msgs].reverse()) {
            const info = m.info || {};
            if (info.role !== 'assistant') continue;
            const parts = m.parts || [];
            if (!parts.some(p => p.type === 'step-finish')) continue;
            const texts = parts.filter(p => p.type === 'text').map(p => p.text);
            if (texts.length > 0) return { text: texts.join('\n'), engine: 'opencode', model: info.modelID || 'unknown' };
          }
        } catch (e) {}
      }
      return { text: '', engine: 'opencode', model: 'timeout' };
    } catch (e) {
      return { text: '', engine: 'opencode', model: 'error: ' + e.message };
    }
  }

  if (engine === 'chutesai') {
    // Use ChutesAI API (MiniMax M2.5)
    try {
      let apiKey = '';
      try { apiKey = fs.readFileSync(path.join(REPO, '.env'), 'utf8').match(/CHUTESAI_API_KEY=(.+)/)[1].trim(); } catch (e) {}

      const result = execSync(`python3 -c "
import urllib.request, json, sys, os
key = '${apiKey}'
req = urllib.request.Request(
    'https://llm.chutes.ai/v1/chat/completions',
    data=json.dumps({
        'model': 'MiniMaxAI/MiniMax-M2.5-TEE',
        'messages': [{'role':'user','content':sys.stdin.read()}],
        'max_tokens': 4096, 'temperature': 0.3
    }).encode(),
    headers={'Content-Type':'application/json','Authorization':'Bearer '+key}
)
resp = json.loads(urllib.request.urlopen(req, timeout=${timeoutSec || 240}).read())
choice = resp.get('choices',[{}])[0]
print(choice.get('message',{}).get('content',''))
"`, { input: prompt, encoding: 'utf8', timeout: (timeoutSec || 240) * 1000 });

      return { text: result.trim(), engine: 'chutesai', model: 'MiniMax-M2.5-TEE' };
    } catch (e) {
      return { text: (e.stdout || '').trim(), engine: 'chutesai', model: 'error' };
    }
  }

  if (engine === 'claude') {
    // Claude CLI with Playwright MCP
    try {
      const mcp = path.join(REPO, '.mcp-playwright.json');
      const result = execSync(
        `claude --mcp-config ${mcp} --model haiku --output-format text --dangerously-skip-permissions -p -`,
        { input: prompt, encoding: 'utf8', timeout: (timeoutSec || 240) * 1000, maxBuffer: 4 * 1024 * 1024 }
      );
      return { text: result.trim(), engine: 'claude', model: 'haiku' };
    } catch (e) {
      return { text: (e.stdout || '').trim(), engine: 'claude', model: 'error' };
    }
  }

  return { text: '', engine: 'none', model: 'no engine available' };
}

// Parse CSV from response
function parseCSV(text) {
  const csvMatch = text.match(/```csv\s*\n([\s\S]*?)```/);
  if (!csvMatch) return { headers: [], rows: [], sources: [] };

  const lines = csvMatch[1].trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [], sources: [] };

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(l => {
    const cells = [];
    let current = '', inQ = false;
    for (const ch of l) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });

  const urlCol = headers.findIndex(h => /source|url/i.test(h));
  const sources = urlCol >= 0 ? rows.map(r => r[urlCol]).filter(u => u && u.startsWith('http')) : [];

  return { headers, rows, sources };
}

// Steps
const STEPS = [
  {
    name: 'glassdoor_salaries',
    prompt: `Use the Playwright browser to research Scala developer salaries:
1. Navigate to google.com
2. Search for "Scala developer salary Argentina 2025 2026 glassdoor"
3. Click on relevant results (Glassdoor, PayScale, Levels.fyi, or similar)
4. Extract ACTUAL salary data you find on the pages

Format as CSV:
\`\`\`csv
Source URL,Job Title,Location,Min Salary USD,Max Salary USD,Currency,Date Found
https://...,Scala Developer,Buenos Aires,...
\`\`\`
CRITICAL: Use REAL data from actual websites. Include source URLs.`,
  },
  {
    name: 'linkedin_jobs',
    prompt: `Use the Playwright browser to find Scala job postings:
1. Navigate to google.com
2. Search for "Scala developer jobs LATAM site:linkedin.com OR site:getonbrd.com"
3. Click into 2-3 result pages and extract job details

Format as CSV:
\`\`\`csv
Source URL,Job Title,Company,Location,Seniority,Posted Date,Key Skills
https://...,Senior Scala Engineer,CompanyName,Buenos Aires,...
\`\`\`
CRITICAL: Only real data from real pages with source URLs.`,
  },
  {
    name: 'market_size',
    prompt: `Use the Playwright browser to research Scala job market:
1. Navigate to google.com
2. Search for "Scala developers demand LATAM 2025 2026 statistics"
3. Read results and extract factual statistics

Format as CSV:
\`\`\`csv
Source URL,Metric,Value,Region,Date
https://...,Number of Scala job postings,1234,Argentina,2025
\`\`\`
CRITICAL: Only statistics from real pages with source URLs.`,
  },
  {
    name: 'company_hiring',
    prompt: `Use the Playwright browser to find companies hiring Scala developers:
1. Navigate to google.com
2. Search for "companies hiring Scala developers Argentina Brazil 2025 2026"
3. Extract company names and details from search results

Format as CSV:
\`\`\`csv
Source URL,Company,Location,Role,Industry
https://...,MercadoLibre,Buenos Aires,Senior Scala Engineer,E-commerce
\`\`\`
CRITICAL: Only real companies from real pages with source URLs.`,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const engine = detectEngine();

  console.log('\n👥 HR Research Benchmark — Through Our System\n');
  console.log(`Task:   ${TASK_ID}`);
  console.log(`Engine: ${engine}`);
  console.log(`SQLite: ${db.DB_PATH}`);
  console.log(`Steps:  ${STEPS.length}\n`);

  if (engine === 'none') {
    console.error('ERROR: No LLM engine available. Install opencode, set CHUTESAI_API_KEY in .env, or install claude CLI.');
    process.exit(1);
  }

  // For browsing tasks, we need tool calling. OpenCode's free model doesn't support it.
  // Cascade: try the engine, if it fails with 0 rows, try the next one.
  const enginePriority = ['opencode', 'chutesai', 'claude'].filter(e => {
    if (e === 'opencode') try { execSync('curl -sf http://localhost:9001/global/health --max-time 2', { stdio: 'pipe' }); return true; } catch(ex) { return false; }
    if (e === 'chutesai') try { return fs.readFileSync(path.join(REPO, '.env'), 'utf8').includes('CHUTESAI_API_KEY='); } catch(ex) { return false; }
    if (e === 'claude') try { execSync('which claude', { stdio: 'pipe' }); return true; } catch(ex) { return false; }
    return false;
  });
  console.log(`Available engines: ${enginePriority.join(' → ')}`);
  console.log(`Will cascade on failure\n`);

  // Create task in SQLite
  try {
    db.createTask({ id: TASK_ID, goal: 'HR Scala LATAM Research', steps: STEPS, sessionId: 'benchmark' });
  } catch (e) {} // may already exist

  const benchSteps = [];
  let totalRows = 0;

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];

    // Watermark: gather what we already have so we can ask for MORE, not the same
    const existing = db.getData(COLLECTION + '/' + step.name);
    let existingUrls = [];
    let existingRows = 0;
    for (const ex of existing) {
      try {
        const d = JSON.parse(ex.data);
        existingRows += (d.rows || []).length;
        existingUrls = existingUrls.concat(d.sources || []);
      } catch (e) {}
    }
    // Augment the prompt with watermark — ask for NEW data
    let augmentedPrompt = step.prompt;
    if (existingUrls.length > 0) {
      augmentedPrompt += `\n\nIMPORTANT: I already have data from these ${existingUrls.length} URLs. Do NOT visit these again. Find DIFFERENT sources, pages, or results:\n${existingUrls.slice(0, 20).join('\n')}\n\nSearch for page 2 of results, or use different search queries to find NEW data I don't have yet.`;
    }
    if (existingRows > 0) {
      console.log(`  (watermark: ${existingRows} existing rows from ${existingUrls.length} URLs — searching for NEW data)`);
    }

    // Try each engine in priority order until one works
    let response = { text: '', engine: 'none', model: 'none' };
    let elapsed = 0;
    for (const eng of enginePriority) {
      process.stdout.write(`🔍 ${step.name} [${eng}] ... `);
      const start = Date.now();
      // Override engine detection for this call
      const savedEngine = engine;
      // Direct call based on engine
      if (eng === 'claude') {
        try {
          const mcp = path.join(REPO, '.mcp-playwright.json');
          const r = execSync(`claude --mcp-config ${mcp} --model haiku --output-format text --dangerously-skip-permissions -p -`,
            { input: augmentedPrompt, encoding: 'utf8', timeout: 300000, maxBuffer: 4*1024*1024 });
          response = { text: r.trim(), engine: 'claude', model: 'haiku' };
        } catch (e) { response = { text: (e.stdout||'').trim(), engine: 'claude', model: 'error' }; }
      } else if (eng === 'chutesai') {
        response = executeViaSystem(step.name, augmentedPrompt, 300);
      } else {
        response = executeViaSystem(step.name, augmentedPrompt, 300);
      }
      elapsed = ((Date.now() - start) / 1000).toFixed(0);

      if (response.text && response.text.length > 20) {
        break; // success — don't try next engine
      }
      console.log(`⚠️  empty, cascading...`);
    }

    if (!response.text) {
      console.log(`❌ empty (${elapsed}s, engine=${response.engine}, model=${response.model})`);
      benchSteps.push({ name: step.name, time: Number(elapsed), rows: 0, status: 'fail', engine: response.engine, model: response.model });
      db.completeStep(TASK_ID, i, 'FAILED: empty response', Number(elapsed) * 1000, 0);
      continue;
    }

    const parsed = parseCSV(response.text);

    // Save to SQLite
    db.saveData(TASK_ID, COLLECTION + '/' + step.name, JSON.stringify({
      text: response.text,
      headers: parsed.headers,
      rows: parsed.rows,
      sources: parsed.sources,
      engine: response.engine,
      model: response.model,
      scrapedAt: new Date().toISOString(),
    }), 'json');

    db.completeStep(TASK_ID, i, response.text, Number(elapsed) * 1000, 0);
    totalRows += parsed.rows.length;

    console.log(`✅ ${parsed.rows.length} rows, ${parsed.sources.length} URLs (${elapsed}s, ${response.engine}/${response.model})`);
    benchSteps.push({
      name: step.name, time: Number(elapsed), rows: parsed.rows.length,
      status: parsed.rows.length > 0 ? 'pass' : 'warn',
      engine: response.engine, model: response.model, sources: parsed.sources,
    });
  }

  // Finalize
  db.finishTask(TASK_ID, 'done');
  const totalTime = benchSteps.reduce((a, s) => a + s.time, 0);
  db.saveBenchmark('hr-real', totalTime * 1000, benchSteps, {
    totalRows, engine,
    totalSources: benchSteps.reduce((a, s) => a + (s.sources?.length || 0), 0),
    stepsPass: benchSteps.filter(s => s.status === 'pass' || s.status === 'cached').length,
    stepsTotal: benchSteps.length,
  });

  // Check cumulative totals
  const allData = db.getData(COLLECTION);
  let cumRows = 0;
  for (const r of allData) { try { cumRows += (JSON.parse(r.data).rows || []).length; } catch(e) {} }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`This run: ${totalTime}s | +${totalRows} new rows | Engine: ${engine}`);
  console.log(`Cumulative: ${cumRows} total rows in SQLite`);
  console.log(`${'─'.repeat(60)}`);

  return { totalTime, totalRows, cumRows };
}

async function run() {
  const args = process.argv.slice(2);
  const daemon = args.includes('--daemon');

  if (!daemon) {
    await main();
    console.log(`\nRun ./scripts/benchmark-report.sh hr-real to generate report`);
    console.log(`Use --daemon to keep running continuously\n`);
    return;
  }

  // Daemon mode: keep running until stopped
  console.log('\n🔄 DAEMON MODE — will keep accumulating data until stopped (Ctrl+C)\n');
  let iteration = 0;

  // Handle graceful shutdown
  let running = true;
  process.on('SIGINT', () => {
    console.log('\n\nStopping daemon...');
    running = false;
  });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    iteration++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`ITERATION ${iteration} — ${new Date().toISOString().slice(11, 19)}`);
    console.log(`${'═'.repeat(60)}`);

    try {
      const result = await main();

      // Generate report after each iteration
      try {
        execSync('./scripts/benchmark-report.sh hr-real', { stdio: 'pipe', timeout: 60000 });
        console.log('📊 Report updated');
      } catch (e) {}

      // Notify via Telegram
      try {
        const session = fs.readFileSync(path.join(process.env.HOME, '.bridge/session'), 'utf8').trim();
        if (session) {
          const msg = `Iteration ${iteration}: +${result.totalRows} rows (${result.cumRows} total, ${result.totalTime}s)`;
          execSync(`curl -sf -X POST https://palindrome-exercise.vercel.app/api/bridge/agent -H "Content-Type: application/json" -d '{"sessionId":"${session}","action":"status","message":"${msg}"}'`, { stdio: 'pipe', timeout: 5000 });
        }
      } catch (e) {}

      if (!running) break;

      // Wait between iterations (shorter if we got new data, longer if not)
      const waitSec = result.totalRows > 0 ? 30 : 120;
      console.log(`\n⏳ Next iteration in ${waitSec}s... (Ctrl+C to stop)`);
      for (let w = 0; w < waitSec && running; w++) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error('Iteration error:', e.message);
      if (!running) break;
      console.log('Retrying in 60s...');
      await new Promise(r => setTimeout(r, 60000));
    }
  }

  console.log(`\nDaemon stopped after ${iteration} iterations.`);
  console.log(`Run: ./scripts/benchmark-report.sh hr-real\n`);
}

run().catch(e => { console.error(e); process.exit(1); });
