#!/usr/bin/env node
/**
 * Integration tests for internet exploration / marketplace workflows.
 * Caches model responses to disk — only re-calls with --rebuild.
 *
 * Usage:
 *   node tests/e2e-explore.js                    # run all (uses cache)
 *   node tests/e2e-explore.js --rebuild           # re-fetch all from API
 *   node tests/e2e-explore.js product_search      # run one category
 *   node tests/e2e-explore.js price_analysis --rebuild  # rebuild one
 */

const fs = require('fs');
const path = require('path');

const OC = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';
const CACHE_DIR = path.join(__dirname, 'explore-cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── System prompt (same as production chat.html) ───
const SYSTEM = `Respondé en español. OBLIGATORIO: SIEMPRE usá componentes ricos con bloques de código. NUNCA markdown plano.

Componentes disponibles:
- \`\`\`timeline — para eventos cronológicos. JSON: {"items":[{"date":"1816","title":"Independencia","desc":"..."}]}
- \`\`\`options — para alternativas/recomendaciones. JSON: {"items":[{"title":"Opción","desc":"..."}]}
- \`\`\`cards — para métricas/datos resumidos. JSON: {"items":[{"label":"Población","value":"46M","desc":"..."}]}
- \`\`\`table — para datos tabulares. JSON: {"headers":["Col1","Col2"],"rows":[["a","b"]]}
- \`\`\`steps — para instrucciones paso a paso. JSON: {"items":[{"title":"Paso 1","desc":"..."}]}
- \`\`\`comparison — para comparar dos cosas lado a lado. JSON: {"left":{"title":"A","items":[...]},"right":{"title":"B","items":[...]}}
- \`\`\`chartjs — para gráficos Chart.js v4. JSON puro.
- \`\`\`status — para estado de tareas. JSON: {"items":[{"label":"Tarea","status":"done|working|pending"}]}

SIEMPRE usá el componente que mejor se adapte. NUNCA respondas con listas de bullets cuando hay un componente.`;

// ─── API ───
async function askModel(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const session = await fetch(OC + '/session', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r => r.json());
    await fetch(OC + '/session/' + session.id + '/message', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ parts: [{ type: 'text', text: prompt }], system: SYSTEM }),
      signal: controller.signal,
    });
    const msgs = await fetch(OC + '/session/' + session.id + '/message').then(r => r.json());
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

function tryParse(json) {
  try { return { ok: true, data: JSON.parse(json) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ─── Test definitions ───
const TESTS = {
  product_search: [
    {
      name: 'keyboard_search',
      prompt: 'Search for mechanical keyboards under $50,000 ARS on MercadoLibre. Show results as a Bridge ```table component with columns: Product, Price (ARS), Rating, Seller. Show at least 3 results. Use realistic Argentine pricing.',
      expect: 'table',
    },
    {
      name: 'product_comparison',
      prompt: 'Compare two mechanical keyboards: Redragon Kumara K552 vs HyperX Alloy Origins Core. Use a Bridge ```comparison component showing specs side by side (price, switches, size, backlight, warranty).',
      expect: 'comparison',
    },
  ],
  price_analysis: [
    {
      name: 'price_chart',
      prompt: 'Show the price history of iPhone 15 128GB on MercadoLibre Argentina over the last 6 months as a Bridge ```chartjs line chart. Use realistic ARS prices (around $700,000-$900,000 range). Include months on x-axis.',
      expect: 'chartjs',
    },
    {
      name: 'price_cards',
      prompt: 'Show key price metrics for iPhone 15 128GB on MercadoLibre as Bridge ```cards component. Include: Current Price, Lowest Price (6mo), Highest Price (6mo), and Price Trend (percentage).',
      expect: 'cards',
    },
  ],
  local_search: [
    {
      name: 'restaurant_results',
      prompt: 'Find 4 Italian restaurants in Palermo, Buenos Aires. Show them as a Bridge ```cards component with name as label, rating as value (e.g. "4.7 ⭐"), and a brief description.',
      expect: 'cards',
    },
    {
      name: 'restaurant_reviews',
      prompt: 'Show the 4 most recent reviews for a popular Italian restaurant in Palermo as a Bridge ```timeline component. Each review should have the reviewer name as title, date, and review text as desc.',
      expect: 'timeline',
    },
  ],
  news_curation: [
    {
      name: 'tech_news_timeline',
      prompt: 'Create a timeline of the 5 most important tech news stories from today/this week. Use a Bridge ```timeline component with relative dates (e.g. "2h ago", "Yesterday"), headline as title, and a 1-sentence summary as desc.',
      expect: 'timeline',
    },
    {
      name: 'news_dashboard',
      prompt: 'Create a news dashboard using multiple Bridge components in one message: 1) A ```status component showing news categories (Tech: done, AI: done, Crypto: working), 2) ```cards with metrics (Sources Checked: 24, Top Stories: 5, Categories: 3)',
      expect: 'status',
    },
  ],
};

// ─── Validators per component type ───
function validate(component, data) {
  const items = Array.isArray(data) ? data : (data.items || data.choices || data.rows || []);
  switch (component) {
    case 'table':
      if (!(data.headers || data.rows)) return 'No headers or rows';
      if (data.headers && !data.headers.length) return 'Empty headers';
      if (data.rows && !data.rows.length) return 'Empty rows';
      return null;
    case 'comparison':
      if (!data.left || !data.right) return 'No left or right in comparison';
      return null;
    case 'chartjs':
      if (!data.type) return 'No chart type';
      return null;
    case 'cards':
      if (!items.length && !(data.items || []).length) return 'No items in cards';
      return null;
    case 'timeline':
      if (!items.length && !(data.items || []).length) return 'No items in timeline';
      return null;
    case 'status':
      if (!items.length && !(data.items || []).length) return 'No items in status';
      return null;
    default:
      return null;
  }
}

// ─── Runner ───
async function runTest(category, test, rebuild) {
  const component = test.expect;
  const cacheFile = path.join(CACHE_DIR, `${category}_${test.name}.json`);
  let response;

  if (!rebuild && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    response = cached.response;
    process.stdout.write(`  ${test.name} (cached) ... `);
  } else {
    process.stdout.write(`  ${test.name} (fetching) ... `);
    try {
      response = await askModel(test.prompt);
      fs.writeFileSync(cacheFile, JSON.stringify({ prompt: test.prompt, response, date: new Date().toISOString() }, null, 2));
    } catch (e) {
      console.log(`\x1b[31m✗\x1b[0m Fetch failed: ${e.message}`);
      return { pass: false, reason: 'Fetch failed: ' + e.message };
    }
  }

  // Validate
  const block = extractBlock(response, component);
  const issues = [];

  if (!block) {
    if (!response.includes('```' + component)) {
      issues.push(`No \`\`\`${component} block found`);
    } else {
      issues.push(`Block found but couldn't extract JSON`);
    }
  } else {
    const parsed = tryParse(block);
    if (!parsed.ok) {
      issues.push(`Invalid JSON: ${parsed.error}`);
    } else {
      const err = validate(component, parsed.data);
      if (err) issues.push(err);
    }
  }

  if (issues.length) {
    console.log(`\x1b[31m✗\x1b[0m ${issues.join('; ')}`);
    return { pass: false, reason: issues.join('; ') };
  } else {
    console.log(`\x1b[32m✓\x1b[0m`);
    return { pass: true };
  }
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

  console.log(`\nExplore / Marketplace Integration Tests`);
  console.log(`Server: ${OC}`);
  console.log(`Cache: ${CACHE_DIR}`);
  console.log(`Mode: ${rebuild ? 'REBUILD (fetching from API)' : 'CACHED (use --rebuild to refresh)'}\n`);

  const results = [];
  const categories = filter ? { [filter]: TESTS[filter] } : TESTS;

  if (filter && !TESTS[filter]) {
    console.log(`Unknown category: ${filter}. Available: ${Object.keys(TESTS).join(', ')}`);
    process.exit(1);
  }

  for (const [category, tests] of Object.entries(categories)) {
    console.log(`\n  \x1b[1m${category}\x1b[0m`);
    for (const test of tests) {
      const r = await runTest(category, test, rebuild);
      results.push({ category, test: test.name, ...r });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m out of ${results.length}`);

  if (failed) {
    console.log('\nFailed:');
    results.filter(r => !r.pass).forEach(r => console.log(`  \x1b[31m✗\x1b[0m ${r.category}/${r.test}: ${r.reason}`));
    process.exit(1);
  }
  console.log('');
}

main();
