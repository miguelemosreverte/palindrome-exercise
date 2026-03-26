#!/usr/bin/env node
/**
 * Integration tests for rich components against OpenCode.
 * Caches model responses to disk — only re-calls with --rebuild.
 *
 * Usage:
 *   node tests/e2e-components.js               # run all (uses cache)
 *   node tests/e2e-components.js --rebuild      # re-fetch all from API
 *   node tests/e2e-components.js timeline        # run one component
 *   node tests/e2e-components.js tree --rebuild  # rebuild one
 */

const fs = require('fs');
const path = require('path');

const OC = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';
const CACHE_DIR = path.join(__dirname, 'component-cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── System prompt (same as production chat.html) ───
const SYSTEM = `Respondé en español. OBLIGATORIO: SIEMPRE usá componentes ricos con bloques de código. NUNCA markdown plano.

Componentes disponibles:
- \`\`\`timeline — para eventos cronológicos. JSON: {"items":[{"date":"1816","title":"Independencia","desc":"..."}]}
- \`\`\`options — para alternativas/recomendaciones. JSON: {"items":[{"title":"Opción","desc":"..."}]}
- \`\`\`cards — para métricas/datos resumidos. JSON: {"items":[{"label":"Población","value":"46M","desc":"..."}]}
- \`\`\`table — para datos tabulares. JSON: {"headers":["Col1","Col2"],"rows":[["a","b"]]}
- \`\`\`steps — para instrucciones paso a paso. JSON: {"items":[{"title":"Paso 1","desc":"..."}]}
- \`\`\`tree — para decisiones jerárquicas. JSON: {"question":"...","choices":[{"title":"...","desc":"...","children":{...}}]}
- \`\`\`chartjs — para gráficos Chart.js v4. JSON puro.

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
  timeline: [
    { name: 'argentina_history', prompt: 'Hacé una línea de tiempo con los 5 eventos más importantes de la historia argentina.' },
    { name: 'tech_milestones', prompt: 'Hacé una línea de tiempo de los hitos más importantes de la computación.' },
  ],
  options: [
    { name: 'travel_destinations', prompt: 'Recomendame 4 destinos de viaje en Argentina con descripción.' },
    { name: 'programming_languages', prompt: 'Dame opciones de lenguajes de programación para empezar a aprender.' },
  ],
  cards: [
    { name: 'country_stats', prompt: 'Mostrá datos clave de Argentina: población, superficie, idioma, moneda, PBI.' },
    { name: 'project_metrics', prompt: 'Mostrá métricas de un proyecto de software: requests, uptime, error rate, latencia.' },
  ],
  table: [
    { name: 'city_comparison', prompt: 'Compará las 5 ciudades más grandes de Argentina en una tabla con población, provincia y año de fundación.' },
    { name: 'model_benchmark', prompt: 'Hacé una tabla comparando 4 modelos de IA: nombre, parámetros, velocidad, costo.' },
  ],
  steps: [
    { name: 'deploy_app', prompt: 'Explicá paso a paso cómo deployar una app en Railway.' },
    { name: 'make_empanadas', prompt: 'Explicá paso a paso cómo hacer empanadas argentinas.' },
  ],
  tree: [
    { name: 'travel_planner', prompt: 'Ayudame a planificar un viaje por Argentina. Quiero elegir entre naturaleza, cultura o playa, y después opciones más específicas dentro de cada una.' },
    { name: 'career_chooser', prompt: 'Ayudame a elegir una carrera universitaria. Organizalo como un árbol de decisión con áreas y subramas.' },
  ],
  chartjs: [
    { name: 'sales_bar', prompt: 'Hacé un gráfico de barras con las ventas trimestrales: Q1=150, Q2=230, Q3=180, Q4=310.' },
    { name: 'distribution_pie', prompt: 'Hacé un gráfico de torta con: Frontend 35%, Backend 40%, DevOps 15%, QA 10%.' },
  ],
};

// ─── Runner ───
async function runTest(component, test, rebuild) {
  const cacheFile = path.join(CACHE_DIR, `${component}_${test.name}.json`);
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
    // Check if the component name appears at all
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
      // Component-specific validation
      const d = parsed.data;
      const items = Array.isArray(d) ? d : (d.items || d.choices || d.rows || []);

      if (component === 'timeline' && !items.length && !(d.items || []).length) issues.push('No items in timeline');
      if (component === 'options' && !items.length) issues.push('No items in options');
      if (component === 'cards' && !items.length && !(d.items || []).length) issues.push('No items in cards');
      if (component === 'table' && !(d.headers || d.rows)) issues.push('No headers or rows');
      if (component === 'steps' && !items.length) issues.push('No items in steps');
      if (component === 'tree' && !(d.choices || d.items || []).length) issues.push('No choices in tree');
      if (component === 'chartjs' && !d.type) issues.push('No chart type');
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

  console.log(`\nComponent Integration Tests`);
  console.log(`Server: ${OC}`);
  console.log(`Cache: ${CACHE_DIR}`);
  console.log(`Mode: ${rebuild ? 'REBUILD (fetching from API)' : 'CACHED (use --rebuild to refresh)'}\n`);

  const results = [];
  const components = filter ? { [filter]: TESTS[filter] } : TESTS;

  if (filter && !TESTS[filter]) {
    console.log(`Unknown component: ${filter}. Available: ${Object.keys(TESTS).join(', ')}`);
    process.exit(1);
  }

  for (const [component, tests] of Object.entries(components)) {
    console.log(`\n  \x1b[1m${component}\x1b[0m`);
    for (const test of tests) {
      const r = await runTest(component, test, rebuild);
      results.push({ component, test: test.name, ...r });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m out of ${results.length}`);

  if (failed) {
    console.log('\nFailed:');
    results.filter(r => !r.pass).forEach(r => console.log(`  \x1b[31m✗\x1b[0m ${r.component}/${r.test}: ${r.reason}`));
    process.exit(1);
  }
  console.log('');
}

main();
