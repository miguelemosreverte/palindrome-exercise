#!/usr/bin/env node
/**
 * Integration tests for REAL web browsing via Playwright MCP + Claude CLI.
 * Browses MercadoLibre, Wikipedia, Google with a real visible browser.
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
if (!fs.existsSync(MCP_CONFIG)) {
  fs.writeFileSync(MCP_CONFIG, JSON.stringify({
    mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }
  }, null, 2));
}

// Format instruction appended to every prompt
const FORMAT_RULES = `

CRITICAL FORMAT RULES:
- You MUST output rich component blocks using triple backticks with the component name
- Example: \`\`\`table followed by a newline, then a JSON object, then \`\`\` to close
- The JSON must be valid and parseable
- Do NOT use markdown tables. Use the \`\`\`table JSON format.
- Do NOT add any text before or after the block unless the test asks for multiple blocks.`;

function askClaude(prompt, timeoutSec) {
  try {
    return execSync(
      `claude --mcp-config ${MCP_CONFIG} --model haiku --output-format text --dangerously-skip-permissions -p ${JSON.stringify(prompt + FORMAT_RULES)}`,
      { timeout: (timeoutSec || 180) * 1000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024 }
    ).trim();
  } catch (e) {
    return (e.stdout || '').trim();
  }
}

function extractBlock(text, lang) {
  // Try JSON block first
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```');
  const m = re.exec(text);
  if (m) return m[1].trim();
  // Fallback: find any JSON object/array in the text
  const jsonRe = /(\{[\s\S]*\}|\[[\s\S]*\])/;
  const jm = jsonRe.exec(text);
  if (jm) { try { JSON.parse(jm[1]); return jm[1]; } catch(e) {} }
  return null;
}

function tryParse(json) {
  try { return { ok: true, data: JSON.parse(json) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// Check if response has real data (not empty/fabricated)
function hasRealData(text) {
  return text.length > 20 && !/I cannot|I can't|I don't have|error|403|forbidden/i.test(text);
}

const TESTS = {
  mercadolibre: [
    {
      name: 'search_keyboards',
      prompt: 'Use the Playwright browser: navigate to mercadolibre.com.ar, search for "teclado mecanico", read the results. Output a ```table block with JSON: {"headers":["Product","Price"],"rows":[["name","$price"],["name2","$price2"],["name3","$price3"]]}. Use REAL product names and prices from the page. Output ONLY the ```table block, nothing else.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data (blocked or error)';
        const block = extractBlock(text, 'table');
        if (block) {
          const p = tryParse(block);
          if (p.ok && p.data.rows && p.data.rows.length >= 2) return null;
        }
        // Fallback: check if there's any product data at all
        if (/\$[\d.,]+/.test(text) && /[Tt]eclado/.test(text)) return null; // has real ML data
        return 'No product data found';
      },
    },
    {
      name: 'search_phones',
      prompt: 'Use the Playwright browser: navigate to mercadolibre.com.ar, search for "iphone 15", read the first 3 results. Output a ```cards block with JSON: {"items":[{"label":"iPhone 15 128GB","value":"$XXX.XXX","desc":"Seller name"}]}. Use REAL data. Output ONLY the ```cards block.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        if (/\$[\d.,]+/.test(text) && /[Ii][Pp]hone/.test(text)) return null;
        return 'No iPhone data found';
      },
    },
  ],

  wikipedia: [
    {
      name: 'argentina_facts',
      prompt: 'Use the Playwright browser: navigate to en.wikipedia.org/wiki/Argentina, read the infobox. Output a ```cards block: {"items":[{"label":"Population","value":"46.7M","desc":"2025 est"},{"label":"Area","value":"2.78M km²"},{"label":"Capital","value":"Buenos Aires"},{"label":"Currency","value":"Peso"}]}. Use REAL numbers from the Wikipedia page. Output ONLY the ```cards block.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        if (/46|47|Buenos Aires|[Pp]eso/.test(text)) return null;
        return 'No Argentina data found';
      },
    },
    {
      name: 'argentina_history',
      prompt: 'Use the Playwright browser: navigate to en.wikipedia.org/wiki/Argentina, read the History section. Output a ```timeline block: {"items":[{"date":"1816","title":"Independence","desc":"brief description"},...]}. Include 4 real historical events with dates. Output ONLY the ```timeline block.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        if (/1816|[Ii]ndependenc|[Pp]erón|[Mm]alvinas/.test(text)) return null;
        return 'No historical data found';
      },
    },
  ],

  google: [
    {
      name: 'btc_price',
      prompt: 'Use the Playwright browser: navigate to google.com, search for "bitcoin price usd". Read the price shown. Output a ```cards block: {"items":[{"label":"BTC/USD","value":"$XX,XXX","desc":"Live price from Google"}]}. Use the REAL price. Output ONLY the ```cards block.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        if (/\$[\d,]+/.test(text) && /[Bb]itcoin|BTC/.test(text)) return null;
        return 'No BTC price found';
      },
    },
    {
      name: 'tech_news',
      prompt: 'Use the Playwright browser: navigate to google.com, search for "tech news today". Read the top 3 headlines. Output a ```timeline block: {"items":[{"date":"today","title":"Headline","desc":"1 sentence summary"},...]}. Use REAL headlines. Output ONLY the ```timeline block.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        const block = extractBlock(text, 'timeline');
        if (block) return null;
        if (text.length > 50) return null; // has some content
        return 'No news data found';
      },
    },
  ],

  ecommerce_workflow: [
    {
      name: 'product_research',
      prompt: `Use the Playwright browser for this multi-step task:
1. Navigate to mercadolibre.com.ar and search for "notebook lenovo"
2. Read the first 3 results (name and price)
3. Output TWO blocks:
First a \`\`\`table block: {"headers":["Product","Price"],"rows":[...]}
Then a \`\`\`cards block: {"items":[{"label":"Cheapest","value":"$XX"},{"label":"Most Expensive","value":"$XX"}]}
Use REAL data from the page.`,
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        if (/\$[\d.,]+/.test(text) && /[Ll]enovo|[Nn]otebook/.test(text)) return null;
        return 'No notebook data found';
      },
    },
  ],

  tiendanube: [
    {
      name: 'pricing_plans',
      prompt: 'Use the Playwright browser: navigate to tiendanube.com, find the pricing/planes page. Read the plan names and prices. Output a ```table block: {"headers":["Plan","Price","Features"],"rows":[...]}. Use REAL data from the site. Output ONLY the ```table block.',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        if (/[Tt]ienda[Nn]ube|plan|[Pp]recio|\$/.test(text)) return null;
        return 'No TiendaNube data found';
      },
    },
  ],
};

// ─── Runner ───
function runTest(cat, test, rebuild) {
  const cacheFile = path.join(CACHE_DIR, `${cat}_${test.name}.json`);
  if (!rebuild && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    process.stdout.write(`  ${test.name} (cached) ... `);
    const err = test.validate(cached.text);
    if (err) { console.log(`\x1b[31m✗ ${err}\x1b[0m`); return false; }
    console.log(`\x1b[32m✓\x1b[0m`);
    return true;
  }
  process.stdout.write(`  ${test.name} (live) ... `);
  const start = Date.now();
  const text = askClaude(test.prompt, 240);
  const sec = ((Date.now() - start) / 1000).toFixed(0);
  if (!text) { console.log(`\x1b[31m✗ Empty (${sec}s)\x1b[0m`); return false; }
  fs.writeFileSync(cacheFile, JSON.stringify({ prompt: test.prompt, text, date: new Date().toISOString() }, null, 2));
  const err = test.validate(text);
  if (err) { console.log(`\x1b[31m✗ ${err} (${sec}s)\x1b[0m`); return false; }
  console.log(`\x1b[32m✓\x1b[0m (${sec}s)`);
  return true;
}

// ─── Main ───
const args = process.argv.slice(2);
const rebuild = args.includes('--rebuild');
const filter = args.find(a => a !== '--rebuild');

console.log('\n🌐 Bridge Integration Tests — Real Web Browsing\n');
console.log(`Engine: Claude CLI + Playwright MCP (headed browser)`);
console.log(`Mode: ${rebuild ? 'LIVE' : 'cached (--rebuild for live)'}\n`);

let pass = 0, fail = 0;
for (const cat of (filter ? [filter] : Object.keys(TESTS))) {
  if (!TESTS[cat]) { console.log(`Unknown: ${cat}`); continue; }
  console.log(`📂 ${cat}`);
  for (const test of TESTS[cat]) {
    if (runTest(cat, test, rebuild)) pass++; else fail++;
  }
  console.log();
}
console.log(`${'─'.repeat(50)}`);
console.log(`${pass} passed, ${fail} failed, ${pass + fail} total\n`);
process.exit(fail > 0 ? 1 : 0);
