#!/usr/bin/env node
/**
 * Natural Language → UI Controls translator.
 *
 * Takes a natural language query + the available filter controls,
 * returns exact control state changes (dropdown values, tag selections, slider positions).
 *
 * This is NOT NL→SQL. The output is a set of UI actions:
 *   { domain: "engineering", city: "Córdoba", skill_categories: ["Backend"], skills: ["Java"], seniority_min: 70 }
 *
 * Benchmarkable across models. Integration-testable.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Load available controls from the DB ─────────────────────────────

export async function loadControls(taskName) {
  const dbPath = join(ROOT, 'data', taskName, 'db.sqlite');
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));

  const controls = {
    domains: [],
    seniority_levels: [],
    cities: [],
    skill_categories: [],  // top-level: Engineering, Management, HR...
    skill_subcategories: {}, // mid-level: { Engineering: [Backend, Frontend, Databases...] }
    skills: {},             // leaves: { Backend: [Java, Spring Boot, REST APIs...] }
    seniority_score_range: [0, 100],
  };

  // Enums from DB
  try { controls.domains = db.exec("SELECT DISTINCT domain FROM records WHERE domain IS NOT NULL AND domain != ''")[0]?.values.map(v => v[0]) || []; } catch {}
  try { controls.seniority_levels = db.exec("SELECT DISTINCT seniority_level FROM records WHERE seniority_level IS NOT NULL")[0]?.values.map(v => v[0]) || []; } catch {}
  try { controls.cities = db.exec("SELECT DISTINCT city FROM records WHERE city IS NOT NULL AND city != ''")[0]?.values.map(v => v[0]) || []; } catch {}

  // Skill tree from skills_normalized
  try {
    const all = db.exec("SELECT skills_normalized FROM records WHERE skills_normalized IS NOT NULL");
    if (all.length) {
      all[0].values.forEach(row => {
        try {
          JSON.parse(row[0]).forEach(s => {
            if (!s.path) return;
            const parts = s.path.split('|');
            const top = parts[0];
            const mid = parts.length > 2 ? parts[1] : null;
            const leaf = parts[parts.length - 1];

            if (!controls.skill_categories.includes(top)) controls.skill_categories.push(top);
            if (mid) {
              if (!controls.skill_subcategories[top]) controls.skill_subcategories[top] = [];
              if (!controls.skill_subcategories[top].includes(mid)) controls.skill_subcategories[top].push(mid);
              if (!controls.skills[mid]) controls.skills[mid] = [];
              if (!controls.skills[mid].includes(leaf) && leaf !== mid) controls.skills[mid].push(leaf);
            }
          });
        } catch {}
      });
    }
  } catch {}

  db.close();
  return controls;
}

// ─── Build prompt for the LLM ────────────────────────────────────────

export function buildPrompt(query, controls) {
  // Build a flat list of all leaf skills for easy matching
  const allLeaves = [];
  for (const [sub, leaves] of Object.entries(controls.skills)) {
    allLeaves.push(...leaves);
  }

  // Build the tree as a readable format
  const treeLines = [];
  for (const cat of controls.skill_categories) {
    const subs = controls.skill_subcategories[cat] || [];
    if (subs.length) {
      const subStr = subs.map(s => {
        const leaves = (controls.skills[s] || []).slice(0, 8);
        return leaves.length ? `${s} → [${leaves.join(', ')}]` : s;
      }).join('; ');
      treeLines.push(`  ${cat}: ${subStr}`);
    } else {
      treeLines.push(`  ${cat}`);
    }
  }

  return `Map this query to filters. Return ONLY JSON. Omit fields that should stay at default.

FILTERS:
  domain: ${controls.domains.join(' | ')}
  seniority_level: ${controls.seniority_levels.join(' | ')}
  city: ${controls.cities.join(' | ')}
  skill_categories: ${controls.skill_categories.join(' | ')}
  skill_subcategories: ${Object.entries(controls.skill_subcategories).map(([k,v]) => k + '→[' + v.join(', ') + ']').join('; ')}

QUERY: "${query}"

Example: {"domain":"engineering","city":"Córdoba","skill_categories":["Engineering"],"skill_subcategories":["Backend"],"skills":["Java"]}

Notes: "sr"→senior, "devs"→engineering, "HR"→domain:hr. Only set fields the user mentions.`;
}

// ─── Call LLM ────────────────────────────────────────────────────────

export async function translateQuery(query, controls, options = {}) {
  const { model = 'gemma-4b', apiKey, openCodePort = 9001 } = options;

  const CHUTES_MODELS = {
    'mistral-nemo': 'unsloth/Mistral-Nemo-Instruct-2407',
    'gemma-4b': 'unsloth/gemma-3-4b-it',
    'hermes-14b': 'NousResearch/Hermes-4-14B',
    'qwen-32b': 'Qwen/Qwen3-32B-TEE',
  };

  const OPENCODE_MODELS = {
    'oc-bigpickle': 'opencode/big-pickle',
    'oc-nemotron': 'opencode/nemotron-3-super-free',
    'oc-gpt5nano': 'opencode/gpt-5-nano',
    'oc-minimax': 'opencode/minimax-m2.5-free',
  };

  const GEMINI_MODELS = {
    'gemini-flash-lite': 'gemini-2.5-flash-lite',
    'gemini-flash': 'gemini-2.5-flash',
  };

  const isOpenCode = model.startsWith('oc-');
  const isGemini = model.startsWith('gemini-');
  const prompt = buildPrompt(query, controls);
  const start = Date.now();

  let text, tokens = 0, promptTokens = 0;

  if (isGemini) {
    // ── Google Gemini API ──
    const geminiKey = options.geminiKey || process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('GEMINI_API_KEY required');
    const modelId = GEMINI_MODELS[model] || model.replace('gemini-', 'gemini-');

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 300, temperature: 0.1 },
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    tokens = data.usageMetadata?.totalTokenCount || 0;
    promptTokens = data.usageMetadata?.promptTokenCount || 0;
  } else if (isOpenCode) {
    // ── OpenCode API ──
    const OC = `http://127.0.0.1:${openCodePort}`;
    const session = await fetch(OC + '/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json());

    await fetch(OC + '/session/' + session.id + '/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
    });

    // Poll for response (max 60s)
    text = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const msgs = await fetch(OC + '/session/' + session.id + '/message').then(r => r.json());
        for (let j = (Array.isArray(msgs) ? msgs : []).length - 1; j >= 0; j--) {
          const m = msgs[j];
          if (m.info?.role !== 'assistant') continue;
          if ((m.parts || []).some(p => p.type === 'step-finish')) {
            text = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
            break;
          }
        }
      } catch {}
      if (text) break;
    }
    if (!text) throw new Error('OpenCode timeout');
  } else {
    // ── ChutesAI API ──
    const modelId = CHUTES_MODELS[model] || model;
    if (!apiKey) throw new Error('ChutesAI API key required');

    const res = await fetch('https://llm.chutes.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, temperature: 0.1,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    text = data.choices[0].message.content;
    tokens = data.usage?.total_tokens || 0;
    promptTokens = data.usage?.prompt_tokens || 0;
  }

  const elapsed = Date.now() - start;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response: ' + text.substring(0, 100));

  const result = JSON.parse(match[0]);
  result._meta = {
    model,
    provider: isGemini ? 'gemini' : isOpenCode ? 'opencode' : 'chutes',
    elapsedMs: elapsed,
    tokens,
    promptTokens,
  };

  return result;
}

// ─── Validate result against controls ────────────────────────────────

export function validateAndFix(result, controls) {
  const issues = [];

  // Fix case: domain, seniority are lowercase enums
  if (result.domain) {
    const fixed = controls.domains.find(d => d.toLowerCase() === result.domain.toLowerCase());
    if (fixed) result.domain = fixed;
    else { issues.push(`domain "${result.domain}" not in [${controls.domains}]`); delete result.domain; }
  }
  if (result.seniority_level) {
    const fixed = controls.seniority_levels.find(s => s.toLowerCase() === result.seniority_level.toLowerCase());
    if (fixed) result.seniority_level = fixed;
    else { issues.push(`seniority "${result.seniority_level}"`); delete result.seniority_level; }
  }
  // Fix city: match case-insensitively, reject multi-value
  if (result.city) {
    const cityStr = String(result.city).split(',')[0].trim(); // take first if comma-separated
    const fixed = controls.cities.find(c => c.toLowerCase() === cityStr.toLowerCase());
    if (fixed) result.city = fixed;
    else { issues.push(`city "${result.city}"`); delete result.city; }
  }
  // Fix skill_categories
  if (result.skill_categories) {
    result.skill_categories = result.skill_categories
      .map(c => controls.skill_categories.find(sc => sc.toLowerCase() === c.toLowerCase()))
      .filter(Boolean);
    if (!result.skill_categories.length) delete result.skill_categories;
  }
  // Fix skills: only keep valid leaves
  if (result.skills) {
    const allLeaves = Object.values(controls.skills).flat();
    const valid = result.skills.filter(s => allLeaves.some(l => l.toLowerCase() === s.toLowerCase()));
    const invalid = result.skills.filter(s => !allLeaves.some(l => l.toLowerCase() === s.toLowerCase()));
    if (invalid.length) issues.push(`unknown skills removed: [${invalid.join(', ')}]`);
    result.skills = valid.length ? valid : undefined;
    if (!result.skills) delete result.skills;
  }
  // Remove empty arrays/fields
  for (const k of Object.keys(result)) {
    if (Array.isArray(result[k]) && result[k].length === 0) delete result[k];
    if (result[k] === '' || result[k] === null) delete result[k];
  }

  return issues;
}

// Backward compat
export const validateResult = validateAndFix;

// ─── CLI: test + benchmark ───────────────────────────────────────────

if (process.argv[1]?.endsWith('nl-to-controls.js')) {
  const task = process.argv[2] || 'ar-senior-devs-linkedin';
  const query = process.argv.slice(3).filter(a => !a.startsWith('--')).join(' ');
  const model = process.argv.find(a => a.startsWith('--model='))?.split('=')[1] || 'mistral-nemo';
  const benchmark = process.argv.includes('--benchmark');

  let apiKey = process.env.CHUTESAI_API_KEY;
  if (!apiKey) try { apiKey = readFileSync(join(ROOT, '..', '.env'), 'utf8').match(/CHUTESAI_API_KEY=(.+)/)?.[1]?.trim(); } catch {}

  const controls = await loadControls(task);
  console.log('Controls loaded:', controls.domains.length, 'domains,', controls.skill_categories.length, 'categories,', Object.values(controls.skills).flat().length, 'skills');

  if (benchmark) {
    // Benchmark mode: run test queries across models
    const testQueries = [
      'show me senior backend java developers in córdoba',
      'HR people who do recruiting',
      'find me data scientists',
      'managers in buenos aires',
      'devops engineers with docker experience',
      'senior engineers who know python or go',
      'people in consulting',
      'frontend developers',
      'everyone with machine learning skills',
      'show architects and leads',
    ];

    // Check if OpenCode is running
    let ocAvailable = false;
    try { await fetch(`http://127.0.0.1:9001/`); ocAvailable = true; } catch {}

    const models = ['gemma-4b', 'mistral-nemo'];

    // Add Gemini if key available
    let geminiKey;
    try { geminiKey = process.env.GEMINI_API_KEY || readFileSync(join(ROOT, '..', '.env'), 'utf8').match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim(); } catch {}
    if (geminiKey) models.push('gemini-flash-lite');
    else console.log('  (No GEMINI_API_KEY — skipping Gemini models)\n');

    if (ocAvailable) models.push('oc-bigpickle', 'oc-nemotron');
    else console.log('  (OpenCode not running — skipping oc-* models)\n');
    const rebuild = process.argv.includes('--rebuild');
    const specifiedModels = process.argv.filter(a => a.startsWith('--model=')).map(a => a.split('=')[1]);

    // Load existing results
    const benchPath = join(ROOT, 'tests', 'nl-controls-benchmark.json');
    let existingResults = [];
    try { existingResults = JSON.parse(readFileSync(benchPath, 'utf8')); } catch {}

    // Only run models that are missing (or specified, or --rebuild)
    const modelsToRun = specifiedModels.length ? specifiedModels :
      rebuild ? models :
      models.filter(m => !existingResults.some(r => r.model === m));

    if (!modelsToRun.length) {
      console.log('  All models already benchmarked. Use --rebuild to re-run all.');
      const results = existingResults;
      // Print summary from cache
      const modelSet = [...new Set(results.map(r => r.model))];
      console.log('\n  ╔══════════════════════════════════════╗');
      console.log('  ║     NL→Controls Benchmark Summary     ║');
      console.log('  ╚══════════════════════════════════════╝');
      for (const m of modelSet) {
        const mr = results.filter(r => r.model === m);
        const passed = mr.filter(r => !r.error && (!r.issues || r.issues.length === 0 || r.issues.every(i => i.startsWith('unknown')))).length;
        const avgMs = Math.round(mr.reduce((s, r) => s + (r.elapsed || 0), 0) / mr.length);
        console.log(`  ${m.padEnd(22)} ${passed}/${mr.length} valid  avg ${avgMs}ms`);
      }
      process.exit(0);
    }

    console.log(`  Running: ${modelsToRun.join(', ')}${rebuild ? ' (rebuild)' : ' (new only)'}`);

    // Keep results from models we're NOT re-running
    const results = rebuild ? [] : existingResults.filter(r => !modelsToRun.includes(r.model));

    for (const m of modelsToRun) {
      console.log(`\n  ── ${m} ──`);
      for (const q of testQueries) {
        try {
          const r = await translateQuery(q, controls, { model: m, apiKey });
          const issues = validateResult(r, controls);
          const status = issues.length ? '✗' : '✓';
          console.log(`  ${status} (${r._meta.elapsedMs}ms) "${q}" → ${JSON.stringify({...r, _meta: undefined})}`);
          if (issues.length) console.log(`    Issues: ${issues.join(', ')}`);
          results.push({ model: m, query: q, result: r, issues, elapsed: r._meta.elapsedMs, tokens: r._meta.tokens });
        } catch (err) {
          console.log(`  ✗ "${q}" → ERROR: ${err.message.substring(0, 60)}`);
          results.push({ model: m, query: q, error: err.message, elapsed: 0, tokens: 0 });
        }
      }
    }

    // Save benchmark results
    writeFileSync(benchPath, JSON.stringify(results, null, 2));

    // Auto-generate Markdown + HTML report
    const allModels = [...new Set(results.map(r => r.model))];
    let md = '# NL→Controls Benchmark Report\n\n';
    md += `*Generated: ${new Date().toLocaleString()}*\n\n`;
    md += '## Results\n\n| Model | Provider | Accuracy | Avg Latency | Avg Tokens |\n|---|---|---|---|---|\n';
    for (const m of allModels) {
      const mr = results.filter(r => r.model === m);
      const passed = mr.filter(r => !r.error && (!r.issues || r.issues.length === 0 || r.issues.every(i => i.startsWith('unknown')))).length;
      const avgMs = Math.round(mr.reduce((s, r) => s + (r.elapsed || 0), 0) / mr.length);
      const avgTokens = Math.round(mr.reduce((s, r) => s + (r.tokens || 0), 0) / mr.length);
      const prov = mr[0]?.result?._meta?.provider || '?';
      const b = passed === 10 ? '**' : '';
      md += `| ${b}${m}${b} | ${prov} | ${b}${passed}/10${b} | ${b}${avgMs}ms${b} | ${avgTokens} |\n`;
    }
    md += '\n## Queries\n\n';
    // One table per model showing query → mapped controls clearly
    for (const m of allModels) {
      const mr = results.filter(r => r.model === m);
      const passed = mr.filter(r => !r.error && (!r.issues || r.issues.length === 0 || r.issues.every(i => i.startsWith('unknown')))).length;
      md += `### ${m} (${passed}/10)\n\n`;
      md += '| Query | ms | domain | seniority | city | categories | subcategories | skills |\n';
      md += '|---|---|---|---|---|---|---|---|\n';
      for (const r of mr) {
        const ok = !r.error && (!r.issues || r.issues.length === 0 || r.issues.every(i => i.startsWith('unknown')));
        if (r.error) { md += `| ${r.query} | ✗ | | | | | | ${r.error.substring(0,30)} |\n`; continue; }
        const v = r.result || {};
        md += `| ${ok?'✓':'✗'} ${r.query} | ${r.elapsed||0} | ${v.domain||''} | ${v.seniority_level||''} | ${v.city||''} | ${(v.skill_categories||[]).join(', ')} | ${(v.skill_subcategories||[]).join(', ')} | ${(v.skills||[]).join(', ')} |\n`;
      }
      md += '\n';
    }
    const mdPath = benchPath.replace('.json', '.md');
    const htmlPath = benchPath.replace('.json', '.html');
    writeFileSync(mdPath, md);
    try { const { md2html } = await import('./md2html.js'); md2html(mdPath, htmlPath); } catch {}
    console.log(`\nReport: ${htmlPath}`);

    // Summary
    console.log('\n  ╔══════════════════════════════════════╗');
    console.log('  ║     NL→Controls Benchmark Summary     ║');
    console.log('  ╚══════════════════════════════════════╝');
    for (const m of allModels) {
      const mr = results.filter(r => r.model === m);
      const passed = mr.filter(r => !r.error && (!r.issues || r.issues.length === 0 || r.issues.every(i => i.startsWith('unknown')))).length;
      const avgMs = Math.round(mr.reduce((s, r) => s + (r.elapsed || 0), 0) / mr.length);
      const avgTokens = Math.round(mr.reduce((s, r) => s + (r.tokens || 0), 0) / mr.length);
      console.log(`  ${m.padEnd(22)} ${passed}/${mr.length} valid  avg ${avgMs}ms  avg ${avgTokens} tokens`);
    }
  } else if (query) {
    // Single query mode
    const result = await translateQuery(query, controls, { model, apiKey });
    const issues = validateResult(result, controls);
    console.log('\nQuery:', query);
    console.log('Model:', model, `(${result._meta.elapsedMs}ms, ${result._meta.tokens} tokens)`);
    console.log('Controls:', JSON.stringify({ ...result, _meta: undefined }, null, 2));
    if (issues.length) console.log('Issues:', issues);
    else console.log('✓ All values valid');
  } else {
    console.log(`
  Usage:
    node bin/nl-to-controls.js <task> <query>                 Single query
    node bin/nl-to-controls.js <task> --benchmark             Benchmark all models
    node bin/nl-to-controls.js <task> <query> --model=gemma-4b  Specific model
    `);
  }
}
