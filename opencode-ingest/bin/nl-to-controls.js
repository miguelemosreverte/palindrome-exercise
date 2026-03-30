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
  return `You are a UI control translator. The user describes what they want to find in natural language. You map their words to EXACT filter control values.

AVAILABLE CONTROLS:
- domain: [${controls.domains.join(', ')}]
- seniority_level: [${controls.seniority_levels.join(', ')}]
- city: [${controls.cities.join(', ')}]
- skill_categories (top-level): [${controls.skill_categories.join(', ')}]
- skill_subcategories: ${JSON.stringify(controls.skill_subcategories)}
- skills (leaves): ${JSON.stringify(controls.skills)}
- seniority_min: 0-100 (slider)

USER QUERY: "${query}"

Return ONLY valid JSON with the controls to activate. Omit controls that should stay at "all"/default.
Example: {"domain": "engineering", "city": "Córdoba", "skill_categories": ["Backend"], "skills": ["Java"]}

RULES:
- Use EXACT values from the lists above. Do not invent values.
- "sr devs" = seniority_level: "senior", domain: "engineering"
- "HR people" = domain: "hr"
- "backend java developers" = domain: "engineering", skill_categories: ["Engineering"], skill_subcategories: ["Backend"], skills: ["Java"]
- "people in cordoba who know python" = city: "Córdoba", skills: ["Python"]
- If the user mentions a skill not in the list, find the closest match or omit it.`;
}

// ─── Call LLM ────────────────────────────────────────────────────────

export async function translateQuery(query, controls, options = {}) {
  const { model = 'mistral-nemo', apiKey } = options;

  const MODELS = {
    'mistral-nemo': 'unsloth/Mistral-Nemo-Instruct-2407',
    'gemma-4b': 'unsloth/gemma-3-4b-it',
    'hermes-14b': 'NousResearch/Hermes-4-14B',
    'qwen-32b': 'Qwen/Qwen3-32B-TEE',
  };

  const modelId = MODELS[model] || model;
  const prompt = buildPrompt(query, controls);

  const start = Date.now();
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
  const elapsed = Date.now() - start;

  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const text = data.choices[0].message.content;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');

  const result = JSON.parse(match[0]);
  result._meta = {
    model,
    modelId,
    elapsedMs: elapsed,
    tokens: data.usage?.total_tokens || 0,
    promptTokens: data.usage?.prompt_tokens || 0,
  };

  return result;
}

// ─── Validate result against controls ────────────────────────────────

export function validateResult(result, controls) {
  const issues = [];

  if (result.domain && !controls.domains.includes(result.domain)) {
    issues.push(`domain "${result.domain}" not in [${controls.domains}]`);
  }
  if (result.seniority_level && !controls.seniority_levels.includes(result.seniority_level)) {
    issues.push(`seniority "${result.seniority_level}" not in [${controls.seniority_levels}]`);
  }
  if (result.city && !controls.cities.includes(result.city)) {
    issues.push(`city "${result.city}" not in [${controls.cities}]`);
  }
  if (result.skill_categories) {
    for (const cat of result.skill_categories) {
      if (!controls.skill_categories.includes(cat)) issues.push(`skill_category "${cat}" not available`);
    }
  }
  if (result.skills) {
    const allLeaves = Object.values(controls.skills).flat();
    for (const skill of result.skills) {
      if (!allLeaves.includes(skill)) issues.push(`skill "${skill}" not in available leaves`);
    }
  }

  return issues;
}

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

    const models = ['mistral-nemo', 'gemma-4b', 'hermes-14b'];
    const results = [];

    for (const m of models) {
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
    const benchPath = join(ROOT, 'tests', 'nl-controls-benchmark.json');
    writeFileSync(benchPath, JSON.stringify(results, null, 2));
    console.log(`\nBenchmark saved: ${benchPath}`);

    // Summary
    console.log('\n  ╔══════════════════════════════════════╗');
    console.log('  ║     NL→Controls Benchmark Summary     ║');
    console.log('  ╚══════════════════════════════════════╝');
    for (const m of models) {
      const mr = results.filter(r => r.model === m);
      const passed = mr.filter(r => !r.error && r.issues?.length === 0).length;
      const avgMs = Math.round(mr.reduce((s, r) => s + (r.elapsed || 0), 0) / mr.length);
      const avgTokens = Math.round(mr.reduce((s, r) => s + (r.tokens || 0), 0) / mr.length);
      console.log(`  ${m.padEnd(18)} ${passed}/${mr.length} valid  avg ${avgMs}ms  avg ${avgTokens} tokens`);
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
