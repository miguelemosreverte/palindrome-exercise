#!/usr/bin/env node
/**
 * Integration tests for REAL web browsing via Playwright MCP + OpenCode.
 * These tests actually browse MercadoLibre, TiendaNube, Wikipedia, etc.
 * NOT mocked — they use the live internet through a real browser.
 *
 * Requires:
 *   - OpenCode running locally with Playwright MCP configured
 *   - npx playwright install chromium (one-time)
 *   - opencode.json with playwright MCP enabled
 *
 * Usage:
 *   node tests/e2e-browse.js                    # run all (uses cache)
 *   node tests/e2e-browse.js --rebuild           # re-run all live
 *   node tests/e2e-browse.js mercadolibre        # run one category
 *   node tests/e2e-browse.js mercadolibre --rebuild
 */

const fs = require('fs');
const path = require('path');

const OC = process.env.OPENCODE_URL || 'http://localhost:9001';
const CACHE_DIR = path.join(__dirname, 'browse-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Longer timeout for browsing (pages need to load)
const TIMEOUT_MS = 180000; // 3 minutes per test
const POLL_INTERVAL = 3000;
const MAX_POLLS = 60;

// ─── System prompt ───
const SYSTEM = `You have access to a web browser via Playwright MCP tools.
You can navigate to websites, click elements, type in search boxes, and read page content.

IMPORTANT RULES:
1. Use browser_navigate to go to URLs
2. Use browser_click and browser_type to interact with pages
3. After browsing, format your findings using Bridge rich components:
   - \`\`\`table for tabular data (products, comparisons)
   - \`\`\`cards for metrics/summaries
   - \`\`\`timeline for chronological events
   - \`\`\`options for recommendations
   - \`\`\`chartjs for charts
4. Always include REAL data from the actual website — not made up
5. Include actual prices in ARS, real product names, real ratings`;

// ─── OpenCode API ───
async function createSession() {
  const r = await fetch(OC + '/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await r.json();
  return data.id;
}

async function sendMessage(sessionId, text) {
  await fetch(OC + '/session/' + sessionId + '/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text: SYSTEM + '\n\n' + text }] }),
  });
}

async function pollForResponse(sessionId, maxPolls) {
  for (let i = 0; i < (maxPolls || MAX_POLLS); i++) {
    await sleep(POLL_INTERVAL);
    const r = await fetch(OC + '/session/' + sessionId + '/message');
    const msgs = await r.json();
    const assistantMsgs = (Array.isArray(msgs) ? msgs : []).filter(
      m => (m.info && m.info.role === 'assistant') || m.role === 'assistant'
    );
    if (assistantMsgs.length === 0) continue;

    const last = assistantMsgs[assistantMsgs.length - 1];
    const parts = last.parts || [];
    const hasFinish = parts.some(p => p.type === 'step-finish');
    if (!hasFinish) continue;

    // Collect all text parts
    const texts = parts.filter(p => p.type === 'text').map(p => p.text);
    // Collect tool uses (to verify browser was actually used)
    const toolUses = parts.filter(p => p.type === 'tool-use' || p.type === 'tool-call');
    const toolNames = toolUses.map(p => p.name || p.toolName || '');

    return {
      text: texts.join('\n'),
      toolsUsed: toolNames,
      model: (last.info || {}).modelID || 'unknown',
    };
  }
  return { text: '', toolsUsed: [], model: 'timeout' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractBlock(text, lang) {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'g');
  const match = re.exec(text);
  return match ? match[1].trim() : null;
}

function tryParse(json) {
  try { return { ok: true, data: JSON.parse(json) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ─── Test definitions ───
// Each test asks OpenCode to browse a REAL website and return structured data
const TESTS = {
  mercadolibre: [
    {
      name: 'search_keyboards',
      prompt: 'Go to mercadolibre.com.ar and search for "teclado mecanico". Find the first 5 results and show them as a Bridge ```table component with columns: Product Name, Price (ARS), Seller. Use the REAL data from the page.',
      validate: (r) => {
        if (!r.toolsUsed.some(t => t.includes('navigate') || t.includes('browser')))
          return 'Browser tools were NOT used — data may be fabricated';
        const block = extractBlock(r.text, 'table');
        if (!block) return 'No ```table block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON: ' + p.error;
        if (!p.data.headers || !p.data.rows) return 'Missing headers or rows';
        if (p.data.rows.length < 3) return 'Expected at least 3 rows';
        return null; // pass
      },
    },
    {
      name: 'product_details',
      prompt: 'Go to mercadolibre.com.ar, search for "auriculares bluetooth", click on the first result, and show me the product details as Bridge ```cards component with: Product Name, Price, Rating, Seller, Shipping info. Use REAL data from the page.',
      validate: (r) => {
        if (!r.toolsUsed.some(t => t.includes('navigate') || t.includes('click') || t.includes('browser')))
          return 'Browser tools were NOT used';
        const block = extractBlock(r.text, 'cards');
        if (!block) return 'No ```cards block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        return null;
      },
    },
    {
      name: 'price_comparison',
      prompt: 'Go to mercadolibre.com.ar and search for "monitor 24 pulgadas". Find 4 monitors and compare them as a Bridge ```table with columns: Model, Price (ARS), Size, Resolution, Seller Rating. Then add a ```cards block with: Cheapest, Most Expensive, Average Price. Use REAL data.',
      validate: (r) => {
        const table = extractBlock(r.text, 'table');
        const cards = extractBlock(r.text, 'cards');
        if (!table) return 'No ```table block';
        if (!cards) return 'No ```cards block';
        return null;
      },
    },
  ],

  tiendanube: [
    {
      name: 'browse_store',
      prompt: 'Go to tiendanube.com and find their pricing page. Show the different plans as a Bridge ```table component with columns: Plan Name, Monthly Price, Features Count, Recommended For. Use the REAL data from the website.',
      validate: (r) => {
        if (!r.toolsUsed.some(t => t.includes('navigate') || t.includes('browser')))
          return 'Browser tools were NOT used';
        const block = extractBlock(r.text, 'table');
        if (!block) return 'No ```table block';
        return null;
      },
    },
    {
      name: 'store_features',
      prompt: 'Go to tiendanube.com and find their features/funcionalidades page. List the main features as a Bridge ```options component with title and description for each. Use REAL feature names and descriptions from the site.',
      validate: (r) => {
        const block = extractBlock(r.text, 'options');
        if (!block) return 'No ```options block';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        const items = p.data.items || p.data;
        if (!Array.isArray(items) || items.length < 3) return 'Expected at least 3 options';
        return null;
      },
    },
  ],

  wikipedia: [
    {
      name: 'country_data',
      prompt: 'Go to en.wikipedia.org and look up "Argentina". Extract key facts and show them as: 1) A ```cards component with Population, Area, Capital, GDP, and Currency (use real numbers from the page). 2) A ```timeline with the 5 most important historical dates mentioned in the article.',
      validate: (r) => {
        if (!r.toolsUsed.some(t => t.includes('navigate') || t.includes('browser')))
          return 'Browser tools were NOT used';
        const cards = extractBlock(r.text, 'cards');
        const timeline = extractBlock(r.text, 'timeline');
        if (!cards) return 'No ```cards block';
        if (!timeline) return 'No ```timeline block';
        return null;
      },
    },
    {
      name: 'comparison_table',
      prompt: 'Go to en.wikipedia.org and look up "Programming language comparison". Create a ```table comparing Python, JavaScript, Rust, and Go with columns: Language, Year Created, Typing, Use Case, Creator. Use REAL data from Wikipedia.',
      validate: (r) => {
        const block = extractBlock(r.text, 'table');
        if (!block) return 'No ```table block';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON';
        if (!p.data.rows || p.data.rows.length < 4) return 'Expected at least 4 rows';
        return null;
      },
    },
  ],

  google: [
    {
      name: 'search_and_summarize',
      prompt: 'Go to google.com and search for "Bitcoin price today USD". Read the first few results and create: 1) A ```cards component with Current Price, 24h Change, Market Cap. 2) A ```timeline of the last 3 major BTC price events you find. Use REAL current data.',
      validate: (r) => {
        if (!r.toolsUsed.some(t => t.includes('navigate') || t.includes('browser')))
          return 'Browser tools were NOT used';
        const cards = extractBlock(r.text, 'cards');
        if (!cards) return 'No ```cards block';
        return null;
      },
    },
    {
      name: 'news_search',
      prompt: 'Go to google.com and search for "Argentina tech startups 2026 news". Read the results and create a ```timeline of the 4 most relevant news items with dates and summaries. Use REAL headlines from the search results.',
      validate: (r) => {
        const block = extractBlock(r.text, 'timeline');
        if (!block) return 'No ```timeline block';
        return null;
      },
    },
  ],

  ecommerce_workflow: [
    {
      name: 'full_product_research',
      prompt: `This is a multi-step research task:
1. Go to mercadolibre.com.ar and search for "notebook lenovo"
2. Find the top 3 results — note their names and prices
3. Go to google.com and search for reviews of the cheapest one you found
4. Compile everything into a single message with:
   - A \`\`\`table of the 3 notebooks (Name, Price ARS, Key Specs)
   - A \`\`\`cards block with: Best Value, Price Range, Avg Rating from reviews
   - A \`\`\`options block recommending which to buy and why
Use REAL data from both websites.`,
      validate: (r) => {
        if (!r.toolsUsed.some(t => t.includes('navigate') || t.includes('browser')))
          return 'Browser tools were NOT used';
        const table = extractBlock(r.text, 'table');
        const cards = extractBlock(r.text, 'cards');
        const options = extractBlock(r.text, 'options');
        if (!table) return 'No ```table block';
        if (!cards) return 'No ```cards block';
        if (!options) return 'No ```options block';
        return null;
      },
    },
  ],
};

// ─── Runner ───
async function runTest(category, test, rebuild) {
  const cacheFile = path.join(CACHE_DIR, `${category}_${test.name}.json`);

  if (!rebuild && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    process.stdout.write(`  ${test.name} (cached) ... `);
    const err = test.validate(cached);
    if (err) { console.log(`\x1b[31m✗ ${err}\x1b[0m`); return false; }
    console.log(`\x1b[32m✓\x1b[0m (${cached.toolsUsed.length} tools, model: ${cached.model})`);
    return true;
  }

  process.stdout.write(`  ${test.name} (live browse) ... `);
  try {
    const sessionId = await createSession();
    await sendMessage(sessionId, test.prompt);
    const result = await pollForResponse(sessionId, MAX_POLLS);

    if (!result.text) {
      console.log(`\x1b[31m✗ Timeout — no response after ${MAX_POLLS * POLL_INTERVAL / 1000}s\x1b[0m`);
      return false;
    }

    // Cache result
    const cacheData = {
      prompt: test.prompt,
      text: result.text,
      toolsUsed: result.toolsUsed,
      model: result.model,
      date: new Date().toISOString(),
    };
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));

    const err = test.validate(result);
    if (err) {
      console.log(`\x1b[31m✗ ${err}\x1b[0m`);
      return false;
    }
    console.log(`\x1b[32m✓\x1b[0m (${result.toolsUsed.length} browser actions, model: ${result.model})`);
    return true;
  } catch (e) {
    console.log(`\x1b[31m✗ Error: ${e.message}\x1b[0m`);
    return false;
  }
}

// ─── Main ───
async function main() {
  const args = process.argv.slice(2);
  const rebuild = args.includes('--rebuild');
  const filter = args.find(a => a !== '--rebuild');

  console.log('\n🌐 Bridge Integration Tests — Real Web Browsing via Playwright MCP\n');
  console.log(`OpenCode: ${OC}`);
  console.log(`Mode: ${rebuild ? 'LIVE (browsing real websites)' : 'cached (use --rebuild for live)'}`);
  console.log(`Timeout: ${TIMEOUT_MS / 1000}s per test\n`);

  // Verify OpenCode is running
  try {
    await fetch(OC + '/session');
  } catch (e) {
    console.error('OpenCode is not running at ' + OC);
    console.error('Start it with: opencode serve --port 9001');
    process.exit(1);
  }

  let pass = 0, fail = 0;
  const categories = filter ? [filter] : Object.keys(TESTS);

  for (const cat of categories) {
    if (!TESTS[cat]) { console.log(`Unknown category: ${cat}`); continue; }
    console.log(`\n📂 ${cat}`);
    for (const test of TESTS[cat]) {
      const ok = await runTest(cat, test, rebuild);
      if (ok) pass++; else fail++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
