#!/usr/bin/env node
/**
 * Integration tests for REAL web browsing via Playwright MCP + Claude CLI.
 * These tests actually browse MercadoLibre, Wikipedia, Google, etc.
 * using a real visible browser (headed mode, like a human user).
 *
 * Requires:
 *   - claude CLI installed
 *   - npx playwright install chromium (one-time)
 *
 * Usage:
 *   node tests/e2e-browse.js                    # run all (uses cache)
 *   node tests/e2e-browse.js --rebuild           # re-run all live
 *   node tests/e2e-browse.js mercadolibre        # run one category
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'browse-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const MCP_CONFIG = path.join(__dirname, '..', '.mcp-playwright.json');

// Create MCP config for Claude CLI (headed browser = bypasses anti-bot)
if (!fs.existsSync(MCP_CONFIG)) {
  fs.writeFileSync(MCP_CONFIG, JSON.stringify({
    mcpServers: {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] }
    }
  }, null, 2));
}

// ─── Claude CLI wrapper ───
function askClaude(prompt, timeoutSec) {
  timeoutSec = timeoutSec || 180;
  try {
    const result = execSync(
      `claude --mcp-config ${MCP_CONFIG} --model haiku --output-format text --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`,
      { timeout: timeoutSec * 1000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }
    );
    return result.trim();
  } catch (e) {
    if (e.stdout) return e.stdout.trim();
    return '';
  }
}

function extractBlock(text, lang) {
  const re = new RegExp('```' + lang + '[\\s\\S]*?\\n([\\s\\S]*?)```');
  const match = re.exec(text);
  return match ? match[1].trim() : null;
}

function tryParse(json) {
  try { return { ok: true, data: JSON.parse(json) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ─── Test definitions ───
const TESTS = {
  mercadolibre: [
    {
      name: 'search_keyboards',
      prompt: 'Use the Playwright browser to navigate to mercadolibre.com.ar, search for "teclado mecanico", and show the first 3 results. Format as:\n```table\n{"headers":["Product","Price (ARS)","Seller"],"rows":[...]}\n```\nOutput ONLY the table block. Use REAL data from the site.',
      validate: (text) => {
        const block = extractBlock(text, 'table');
        if (!block) return 'No ```table block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON: ' + p.error;
        if (!p.data.headers || !p.data.rows) return 'Missing headers or rows';
        if (p.data.rows.length < 2) return 'Expected at least 2 rows';
        // Check for real prices (should contain $ and numbers)
        const hasPrice = p.data.rows.some(r => r.some(c => /\$[\d.,]+/.test(String(c))));
        if (!hasPrice) return 'No real prices found (expected ARS format)';
        return null;
      },
    },
    {
      name: 'product_details',
      prompt: 'Use the Playwright browser to go to mercadolibre.com.ar, search for "auriculares bluetooth", click the first result, and extract product details. Format as:\n```cards\n{"items":[{"label":"Product","value":"name"},{"label":"Price","value":"$XX"},{"label":"Rating","value":"X.X"},{"label":"Seller","value":"name"}]}\n```\nOutput ONLY the cards block. Use REAL data.',
      validate: (text) => {
        const block = extractBlock(text, 'cards');
        if (!block) return 'No ```cards block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        const items = p.data.items || p.data;
        if (!Array.isArray(items) || items.length < 2) return 'Expected at least 2 cards';
        return null;
      },
    },
  ],

  wikipedia: [
    {
      name: 'country_data',
      prompt: 'Use the Playwright browser to navigate to en.wikipedia.org/wiki/Argentina. Extract Population, Area (km²), Capital, and Currency from the infobox. Format as:\n```cards\n{"items":[{"label":"Population","value":"XX million","desc":"2025 estimate"},...]}\n```\nOutput ONLY the cards block. Use REAL data from the page.',
      validate: (text) => {
        const block = extractBlock(text, 'cards');
        if (!block) return 'No ```cards block';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        const items = p.data.items || p.data;
        if (!Array.isArray(items) || items.length < 3) return 'Expected at least 3 cards';
        return null;
      },
    },
    {
      name: 'history_timeline',
      prompt: 'Use the Playwright browser to go to en.wikipedia.org/wiki/Argentina and find 5 important historical dates from the History section. Format as:\n```timeline\n{"items":[{"date":"1816","title":"Independence","desc":"..."}]}\n```\nOutput ONLY the timeline block. Use REAL dates and events from the article.',
      validate: (text) => {
        const block = extractBlock(text, 'timeline');
        if (!block) return 'No ```timeline block';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        const items = p.data.items || p.data;
        if (!Array.isArray(items) || items.length < 3) return 'Expected at least 3 timeline items';
        return null;
      },
    },
  ],

  google: [
    {
      name: 'search_btc',
      prompt: 'Use the Playwright browser to go to google.com and search for "Bitcoin price USD today". Read the search results and extract the current price. Format as:\n```cards\n{"items":[{"label":"BTC/USD","value":"$XX,XXX","desc":"Current price"}]}\n```\nOutput ONLY the cards block. Use the REAL price from Google.',
      validate: (text) => {
        const block = extractBlock(text, 'cards');
        if (!block) return 'No ```cards block';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        return null;
      },
    },
  ],

  ecommerce_workflow: [
    {
      name: 'multi_site_research',
      prompt: `Use the Playwright browser for a multi-step task:
1. Go to mercadolibre.com.ar and search for "notebook lenovo"
2. Note the name and price of the first 3 results
3. Format your findings as BOTH:
a) A \`\`\`table block: {"headers":["Product","Price (ARS)"],"rows":[...]}
b) A \`\`\`cards block: {"items":[{"label":"Cheapest","value":"$XX"},{"label":"Results Found","value":"3"}]}
Output BOTH blocks in your response. Use REAL data.`,
      validate: (text) => {
        const table = extractBlock(text, 'table');
        const cards = extractBlock(text, 'cards');
        if (!table) return 'No ```table block';
        if (!cards) return 'No ```cards block';
        const tp = tryParse(table);
        if (!tp.ok) return 'Invalid table JSON';
        const cp = tryParse(cards);
        if (!cp.ok) return 'Invalid cards JSON';
        return null;
      },
    },
  ],
};

// ─── Runner ───
function runTest(category, test, rebuild) {
  const cacheFile = path.join(CACHE_DIR, `${category}_${test.name}.json`);

  if (!rebuild && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    process.stdout.write(`  ${test.name} (cached) ... `);
    const err = test.validate(cached.text);
    if (err) { console.log(`\x1b[31m✗ ${err}\x1b[0m`); return false; }
    console.log(`\x1b[32m✓\x1b[0m`);
    return true;
  }

  process.stdout.write(`  ${test.name} (live browse) ... `);
  const start = Date.now();
  const text = askClaude(test.prompt);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!text) {
    console.log(`\x1b[31m✗ Empty response after ${elapsed}s\x1b[0m`);
    return false;
  }

  // Cache
  fs.writeFileSync(cacheFile, JSON.stringify({ prompt: test.prompt, text, date: new Date().toISOString() }, null, 2));

  const err = test.validate(text);
  if (err) {
    console.log(`\x1b[31m✗ ${err} (${elapsed}s)\x1b[0m`);
    return false;
  }
  console.log(`\x1b[32m✓\x1b[0m (${elapsed}s)`);
  return true;
}

// ─── Main ───
const args = process.argv.slice(2);
const rebuild = args.includes('--rebuild');
const filter = args.find(a => a !== '--rebuild');

console.log('\n🌐 Bridge Integration Tests — Real Web Browsing via Playwright MCP\n');
console.log(`Engine: Claude CLI + Playwright (headed browser)`);
console.log(`Mode: ${rebuild ? 'LIVE (browsing real websites)' : 'cached (use --rebuild for live)'}\n`);

let pass = 0, fail = 0;
const categories = filter ? [filter] : Object.keys(TESTS);

for (const cat of categories) {
  if (!TESTS[cat]) { console.log(`Unknown category: ${cat}`); continue; }
  console.log(`\n📂 ${cat}`);
  for (const test of TESTS[cat]) {
    if (runTest(cat, test, rebuild)) pass++; else fail++;
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(fail > 0 ? 1 : 0);
