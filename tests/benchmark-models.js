#!/usr/bin/env node
/**
 * Model latency benchmark for OpenCode.
 *
 * Usage:
 *   node tests/benchmark-models.js              # benchmark all configured models
 *   node tests/benchmark-models.js --routing     # test routing prompt classification
 */

const OC = process.env.OPENCODE_URL || 'https://palindrome-exercise-production.up.railway.app';

async function benchmark(providerID, modelID, name, prompt) {
  const session = await fetch(OC + '/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  }).then(r => r.json());

  const start = Date.now();
  try {
    const r = await fetch(OC + '/session/' + session.id + '/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { providerID, modelID },
        parts: [{ type: 'text', text: prompt || 'Say hi in one word' }]
      }),
    });
    const elapsed = Date.now() - start;
    const data = await r.json();
    const text = (data.parts || []).find(p => p.type === 'text')?.text || '';
    return { name, elapsed, text: text.slice(0, 60), ok: true };
  } catch (e) {
    return { name, elapsed: Date.now() - start, error: e.message, ok: false };
  }
}

async function main() {
  const isRouting = process.argv.includes('--routing');

  // Verify connectivity
  const health = await fetch(OC + '/global/health').catch(() => null);
  if (!health?.ok) { console.error('Cannot reach', OC); process.exit(1); }

  const models = [
    ['opencode', 'mimo-v2-omni-free', 'MiMo V2 Omni Free'],
    ['opencode', 'mimo-v2-pro-free', 'MiMo V2 Pro Free'],
    ['opencode', 'gpt-5-nano', 'GPT-5 Nano'],
    ['opencode', 'big-pickle', 'Big Pickle'],
    ['opencode', 'nemotron-3-super-free', 'Nemotron 3 Super Free'],
    ['opencode', 'minimax-m2.5-free', 'MiniMax M2.5 Free'],
  ];

  if (!isRouting) {
    console.log('\n  Model Latency Benchmark');
    console.log('  ' + '─'.repeat(50));
    console.log('  Prompt: "Say hi in one word"\n');

    const results = [];
    for (const [prov, model, name] of models) {
      process.stdout.write(`  ${name.padEnd(28)} `);
      const r = await benchmark(prov, model, name);
      results.push(r);
      if (r.ok) console.log(`${String(r.elapsed).padStart(6)}ms  "${r.text}"`);
      else console.log(`  FAIL: ${r.error}`);
    }

    // Sort by latency
    results.sort((a, b) => a.elapsed - b.elapsed);
    console.log('\n  Ranking (fastest first):');
    results.filter(r => r.ok).forEach((r, i) => {
      const bar = '█'.repeat(Math.round(r.elapsed / 200));
      console.log(`  ${i + 1}. ${r.name.padEnd(28)} ${String(r.elapsed).padStart(6)}ms ${bar}`);
    });

    // Save results
    const fs = require('fs');
    const resultFile = require('path').join(__dirname, 'benchmark-results.json');
    const saved = {
      date: new Date().toISOString(),
      server: OC,
      prompt: 'Say hi in one word',
      results: results.map(r => ({ name: r.name, elapsed: r.elapsed, ok: r.ok })),
    };
    fs.writeFileSync(resultFile, JSON.stringify(saved, null, 2));
    console.log(`\n  Saved to ${resultFile}`);

  } else {
    // Routing benchmark: test how fast a model can classify a user intent
    console.log('\n  Routing Classifier Benchmark');
    console.log('  ' + '─'.repeat(50));

    const routingPrompt = `Classify this user message into exactly ONE category. Reply with ONLY the category name, nothing else.

Categories: timeline, options, tree, cards, table, steps, chart, conversation

User message: "Recomendame destinos de viaje en Argentina"

Category:`;

    const routingModels = [
      ['opencode', 'mimo-v2-omni-free', 'MiMo V2 Omni (router candidate)'],
      ['opencode', 'gpt-5-nano', 'GPT-5 Nano (router candidate)'],
    ];

    for (const [prov, model, name] of routingModels) {
      process.stdout.write(`  ${name.padEnd(38)} `);
      const r = await benchmark(prov, model, name, routingPrompt);
      if (r.ok) console.log(`${String(r.elapsed).padStart(6)}ms  → "${r.text}"`);
      else console.log(`  FAIL: ${r.error}`);
    }

    // Test multiple routing prompts
    const testPrompts = [
      ['Haceme una línea de tiempo de Argentina', 'timeline'],
      ['¿Qué opciones de carrera tengo?', 'options/tree'],
      ['Mostrá los datos de población en una tabla', 'table'],
      ['Creá un gráfico con las ventas', 'chart'],
      ['Hola, ¿cómo estás?', 'conversation'],
      ['Quiero planificar un viaje paso a paso', 'steps/tree'],
    ];

    console.log('\n  Routing accuracy (MiMo V2 Omni):');
    for (const [prompt, expected] of testPrompts) {
      const classifyPrompt = `Classify into ONE category (timeline/options/tree/cards/table/steps/chart/conversation). Reply ONLY the category.\n\nUser: "${prompt}"\n\nCategory:`;
      const r = await benchmark('opencode', 'mimo-v2-omni-free', 'router', classifyPrompt);
      const classified = (r.text || '').toLowerCase().trim();
      const expectedOpts = expected.split('/');
      const match = expectedOpts.some(e => classified.includes(e));
      console.log(`  ${match ? '✓' : '✗'} "${prompt.slice(0, 40)}..." → ${classified} (expected: ${expected})`);
    }
  }
}

main();
