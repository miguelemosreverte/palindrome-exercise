#!/usr/bin/env node
/**
 * Local test harness for tool use scenarios.
 *
 * Usage:
 *   node tests/harness.js                    # run all test cases
 *   node tests/harness.js python             # run only python cases
 *   node tests/harness.js chart              # run only chart cases
 *   node tests/harness.js search             # run only search cases
 *   node tests/harness.js composite          # run composite scenarios
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const SYSTEM_PROMPT = require('../lib/system-prompt');

const API_BASE = 'https://llm.chutes.ai/v1';
const API_KEY = process.env.CHUTESAI_API_KEY;
const MODEL = process.env.TEST_MODEL || 'chutesai/Mistral-Small-3.1-24B-Instruct-2503-TEE';
const GOLDEN_DIR = path.join(__dirname, 'golden');

// ─── Test cases ───
const CASES = [
  // === PYTHON ===
  {
    name: 'python_fibonacci',
    category: 'python',
    prompt: 'Calculá los primeros 10 números de Fibonacci usando Python.',
    validate(text) {
      const pyBlock = extractBlock(text, 'python');
      if (!pyBlock) return { pass: false, reason: 'No <python> block found' };
      if (!pyBlock.includes('print')) return { pass: false, reason: 'No print() in Python code' };
      return { pass: true, blocks: { python: pyBlock } };
    },
  },
  {
    name: 'python_math',
    category: 'python',
    prompt: 'Usá Python para calcular la raíz cuadrada de 144 y el factorial de 10.',
    validate(text) {
      const pyBlock = extractBlock(text, 'python');
      if (!pyBlock) return { pass: false, reason: 'No <python> block found' };
      if (!pyBlock.includes('print')) return { pass: false, reason: 'No print()' };
      return { pass: true, blocks: { python: pyBlock } };
    },
  },

  // === CHART ===
  {
    name: 'chart_simple_bar',
    category: 'chart',
    prompt: 'Hacé un gráfico de barras con las ventas trimestrales: Q1=150, Q2=230, Q3=180, Q4=310.',
    validate(text) {
      const chartBlock = extractBlock(text, 'chart');
      if (!chartBlock) return { pass: false, reason: 'No <chart> block found' };
      return validateChartJSON(chartBlock);
    },
  },
  {
    name: 'chart_timeline',
    category: 'chart',
    prompt: 'Hacé un gráfico que muestre estos eventos históricos de Argentina: Revolución de Mayo (1810), Independencia (1816), Batalla de Caseros (1852), Constitución (1853), Ley Sáenz Peña (1912).',
    validate(text) {
      const chartBlock = extractBlock(text, 'chart');
      if (!chartBlock) return { pass: false, reason: 'No <chart> block found' };
      const result = validateChartJSON(chartBlock);
      if (!result.pass) return result;
      // Check years aren't used as Y-axis numeric data starting near 0
      const datasets = result.parsed.data?.datasets;
      if (datasets?.[0]?.data?.some(d => typeof d === 'number' && d > 1500 && d < 2100)) {
        const scales = result.parsed.options?.scales || {};
        const yAxis = scales.y || {};
        if (yAxis.beginAtZero || (!yAxis.min && !yAxis.suggestedMin)) {
          return { pass: false, reason: 'Years used as numeric data without proper axis range — should be labels not data values' };
        }
      }
      return result;
    },
  },
  {
    name: 'chart_pie',
    category: 'chart',
    prompt: 'Hacé un gráfico de torta que muestre la distribución: Frontend 35%, Backend 40%, DevOps 15%, QA 10%.',
    validate(text) {
      const chartBlock = extractBlock(text, 'chart');
      if (!chartBlock) return { pass: false, reason: 'No <chart> block found' };
      const result = validateChartJSON(chartBlock);
      if (!result.pass) return result;
      if (!['pie', 'doughnut'].includes(result.parsed.type)) {
        return { pass: false, reason: `Expected pie/doughnut, got "${result.parsed.type}"` };
      }
      return result;
    },
  },

  // === SEARCH ===
  {
    name: 'search_basic',
    category: 'search',
    prompt: 'Buscá en internet cuáles fueron las últimas noticias de tecnología de esta semana.',
    validate(text) {
      const searchBlock = extractBlock(text, 'web_search');
      if (!searchBlock) return { pass: false, reason: 'No <web_search> block found' };
      if (searchBlock.trim().length < 3) return { pass: false, reason: 'Search query too short' };
      return { pass: true, blocks: { web_search: searchBlock } };
    },
  },

  // === COMPOSITE ===
  {
    name: 'composite_search_and_chart',
    category: 'composite',
    prompt: 'Buscá las 5 ciudades más pobladas de Sudamérica y después hacé un gráfico de barras con esos datos.',
    validate(text) {
      const searchBlock = extractBlock(text, 'web_search');
      const chartBlock = extractBlock(text, 'chart');
      const issues = [];
      if (!searchBlock) issues.push('No <web_search> block');
      if (!chartBlock) issues.push('No <chart> block');
      if (chartBlock) {
        const r = validateChartJSON(chartBlock);
        if (!r.pass) issues.push('Chart: ' + r.reason);
      }
      if (issues.length) return { pass: false, reason: issues.join('; ') };
      return { pass: true, blocks: { web_search: searchBlock, chart: chartBlock } };
    },
  },
  {
    name: 'composite_python_and_chart',
    category: 'composite',
    prompt: 'Usá Python para generar 20 números aleatorios entre 1 y 100, y después hacé un gráfico de línea con esos datos.',
    validate(text) {
      const pyBlock = extractBlock(text, 'python');
      const chartBlock = extractBlock(text, 'chart');
      const issues = [];
      if (!pyBlock) issues.push('No <python> block');
      if (!chartBlock) issues.push('No <chart> block');
      if (chartBlock) {
        const r = validateChartJSON(chartBlock);
        if (!r.pass) issues.push('Chart: ' + r.reason);
      }
      return issues.length
        ? { pass: false, reason: issues.join('; ') }
        : { pass: true, blocks: { python: pyBlock, chart: chartBlock } };
    },
  },
  // === PIPELINE: search → python → chart ===
  {
    name: 'pipeline_invasiones_inglesas',
    category: 'pipeline',
    prompt: 'Buscá en Wikipedia la cronología de las Invasiones Inglesas a Buenos Aires. Después usá Python para generar el JSON de Chart.js que represente esa timeline. Finalmente usá la herramienta <chart> para renderizar el gráfico.',
    validate(text) {
      const searchBlock = extractBlock(text, 'web_search');
      const pyBlock = extractBlock(text, 'python');
      const chartBlock = extractBlock(text, 'chart');
      const issues = [];

      if (!searchBlock) issues.push('No <web_search> block');
      if (!pyBlock) issues.push('No <python> block');
      if (!chartBlock) issues.push('No <chart> block');

      if (pyBlock && !pyBlock.includes('print')) issues.push('Python has no print() — needed to output data');
      if (chartBlock) {
        const r = validateChartJSON(chartBlock);
        if (!r.pass) issues.push('Chart: ' + r.reason);
      }

      // Check ordering: search should come before python, python before chart
      if (searchBlock && pyBlock) {
        const searchPos = text.indexOf('<web_search>');
        const pyPos = text.indexOf('<python>');
        if (pyPos < searchPos) issues.push('Python appears before search — should search first');
      }
      if (pyBlock && chartBlock) {
        const pyPos = text.indexOf('<python>');
        const chartPos = text.indexOf('<chart>');
        if (chartPos < pyPos) issues.push('Chart appears before python — should generate data first');
      }

      return issues.length
        ? { pass: false, reason: issues.join('; ') }
        : { pass: true, blocks: { web_search: searchBlock, python: pyBlock, chart: chartBlock } };
    },
  },
];

// ─── Helpers ───

function extractBlock(text, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  // Find the LAST occurrence of the open tag (skip mentions in prose)
  let i = text.lastIndexOf(open);
  while (i >= 0) {
    const afterTag = text[i + open.length];
    // Skip if tag is followed by : or other non-whitespace on same line (it's prose, not a tool call)
    if (afterTag && afterTag !== '\n' && afterTag !== '\r' && afterTag !== ' ' && afterTag !== '{' && afterTag !== '"') {
      i = text.lastIndexOf(open, i - 1);
      continue;
    }
    const j = text.indexOf(close, i + open.length);
    if (j === -1) { i = text.lastIndexOf(open, i - 1); continue; }
    return text.slice(i + open.length, j).trim();
  }
  return null;
}

function validateChartJSON(str) {
  let clean = str.trim();
  // Strip markdown fences if model wrapped them
  if (clean.startsWith('```')) clean = clean.replace(/^```\w*\n?/, '').replace(/```$/, '').trim();
  // Try parsing, if it fails try trimming trailing chars
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (firstErr) {
    // Try fixing common issues: extra trailing brace/bracket
    let fixed = clean;
    for (let i = 0; i < 3; i++) {
      fixed = fixed.replace(/\}\s*\}$/, '}').replace(/\]\s*\]$/, ']');
    }
    try { parsed = JSON.parse(fixed); } catch {
      return { pass: false, reason: `Invalid JSON: ${firstErr.message}` };
    }
  }
  try {
    if (!parsed.type) return { pass: false, reason: 'Missing "type"' };
    if (!parsed.data) return { pass: false, reason: 'Missing "data"' };
    if (parsed.type === 'horizontalBar') return { pass: false, reason: '"horizontalBar" not valid in Chart.js v4' };
    if (clean.includes('function(') || clean.includes('function (')) {
      return { pass: false, reason: 'JSON contains JS functions' };
    }
    // Check accessible colors
    const colors = JSON.stringify(parsed).match(/#[0-9a-fA-F]{6}/g) || [];
    const hasOptions = !!parsed.options;
    return { pass: true, parsed, blocks: { chart: clean }, meta: { colors, hasOptions } };
  } catch (err) {
    return { pass: false, reason: `Invalid JSON: ${err.message}` };
  }
}

// ─── Simulated tool execution (for multi-turn tests) ───

function simulateSearch(query) {
  // Return fake but realistic search results for testing
  return `[Resultados de búsqueda para "${query}"]\n- Wikipedia: Invasiones Inglesas al Río de la Plata. Primera invasión: junio 1806, William Carr Beresford tomó Buenos Aires. Reconquista: 12 agosto 1806 por Santiago de Liniers. Segunda invasión: junio 1807, John Whitelocke atacó con 8000 hombres. Defensa: 5-7 julio 1807, vecinos de Buenos Aires rechazaron al invasor. Rendición británica: 7 julio 1807.`;
}

function simulatePython(code) {
  // We can't run Python here but we can check if it prints JSON
  if (code.includes('json.dumps')) return '{"simulated":"python output would go here"}';
  return '(Python output)';
}

// ─── API call ───

async function callLLM(messages) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callLLMMultiTurn(prompt, maxTurns = 3) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  const allText = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const text = await callLLM(messages);
    allText.push(text);
    messages.push({ role: 'assistant', content: text });

    // Check if there are tool calls that need execution
    const searchBlock = extractBlock(text, 'web_search');
    const pyBlock = extractBlock(text, 'python');

    const toolResults = [];

    if (searchBlock) {
      const result = simulateSearch(searchBlock);
      toolResults.push(result);
    }

    if (pyBlock) {
      const result = simulatePython(pyBlock);
      toolResults.push(`[Resultado de Python]\n${result}`);
    }

    // If no tools were called, or chart was the last thing, we're done
    const chartBlock = extractBlock(text, 'chart');
    if (!searchBlock && !pyBlock) break;
    if (chartBlock && !searchBlock && !pyBlock) break;

    // Inject tool results and continue
    if (toolResults.length) {
      messages.push({ role: 'user', content: toolResults.join('\n\n') + '\n\nContinuá con el siguiente paso.' });
    } else {
      break;
    }
  }

  return allText.join('\n\n---TURN---\n\n');
}

// ─── Runner ───

async function runCase(tc) {
  const start = Date.now();
  process.stdout.write(`  ${tc.name} ... `);

  try {
    const isMultiTurn = tc.category === 'pipeline';
    const text = isMultiTurn
      ? await callLLMMultiTurn(tc.prompt)
      : await callLLM([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: tc.prompt }]);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const result = tc.validate(text);

    // Save golden file
    const goldenPath = path.join(GOLDEN_DIR, `${tc.name}.txt`);
    const lines = [
      `# Prompt: ${tc.prompt}`,
      `# Model: ${MODEL}`,
      `# Date: ${new Date().toISOString()}`,
      `# Pass: ${result.pass}`,
      result.reason ? `# Reason: ${result.reason}` : null,
      result.meta ? `# Meta: ${JSON.stringify(result.meta)}` : null,
      '',
      '---RESPONSE---',
      text,
      '',
      '---BLOCKS---',
      JSON.stringify(result.blocks || {}, null, 2),
    ].filter(l => l !== null);
    fs.writeFileSync(goldenPath, lines.join('\n'));

    if (result.pass) {
      console.log(`\x1b[32m✓\x1b[0m (${elapsed}s)`);
      if (result.blocks) {
        for (const [tool, content] of Object.entries(result.blocks)) {
          const preview = String(content).slice(0, 80).replace(/\n/g, '\\n');
          console.log(`    ${tool}: ${preview}${content.length > 80 ? '...' : ''}`);
        }
      }
      if (result.meta?.colors?.length) {
        console.log(`    colors: ${result.meta.colors.join(', ')}`);
      }
    } else {
      console.log(`\x1b[31m✗\x1b[0m (${elapsed}s) — ${result.reason}`);
    }

    return { name: tc.name, ...result, elapsed, text };
  } catch (err) {
    console.log(`\x1b[31m✗\x1b[0m — ${err.message}`);
    return { name: tc.name, pass: false, reason: err.message };
  }
}

async function main() {
  const filter = process.argv[2];

  if (!API_KEY) {
    console.error('Missing CHUTESAI_API_KEY in .env');
    process.exit(1);
  }

  console.log(`\nModel: ${MODEL}`);
  console.log(`Prompt: lib/system-prompt.js`);
  console.log(`Golden: ${GOLDEN_DIR}\n`);

  let cases = CASES;
  if (filter) cases = CASES.filter(c => c.category === filter || c.name === filter);

  if (!cases.length) {
    console.log('No matching test cases. Categories: python, chart, search, composite');
    process.exit(1);
  }

  console.log(`Running ${cases.length} test(s):\n`);

  const results = [];
  for (const c of cases) results.push(await runCase(c));

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${'─'.repeat(40)}`);
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
