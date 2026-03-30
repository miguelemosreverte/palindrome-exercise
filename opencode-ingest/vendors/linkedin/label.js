/**
 * LinkedIn — LLM-powered labeling
 *
 * Reads each record, sends to an LLM, gets back structured labels.
 * Labels are written as new columns in SQLite.
 *
 * Model catalog: easily swap between providers/models.
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Model Catalog ───────────────────────────────────────────────────

export const MODELS = {
  // ChutesAI models (OpenAI-compatible, fast, cheap)
  'mistral-nemo': {
    provider: 'chutes',
    id: 'unsloth/Mistral-Nemo-Instruct-2407',
    cost: '$0.02/$0.04 per 1M tokens',
  },
  'mistral-small': {
    provider: 'chutes',
    id: 'chutesai/Mistral-Small-3.2-24B-Instruct-2506',
    cost: '$0.06/$0.18 per 1M tokens',
  },
  'gemma-4b': {
    provider: 'chutes',
    id: 'unsloth/gemma-3-4b-it',
    cost: '$0.01/$0.03 per 1M tokens (cheapest)',
  },
  'hermes-14b': {
    provider: 'chutes',
    id: 'NousResearch/Hermes-4-14B',
    cost: '$0.01/$0.05 per 1M tokens',
  },
  'qwen-32b': {
    provider: 'chutes',
    id: 'Qwen/Qwen3-32B-TEE',
    cost: '$0.08/$0.24 per 1M tokens (best quality)',
  },
  'deephermes': {
    provider: 'chutes',
    id: 'NousResearch/DeepHermes-3-Mistral-24B-Preview',
    cost: '$0.02/$0.10 per 1M tokens',
  },

  // OpenCode models (free, slower)
  'opencode-nemotron': {
    provider: 'opencode',
    id: 'opencode/nemotron-3-super-free',
    cost: 'free',
  },
  'opencode-bigpickle': {
    provider: 'opencode',
    id: 'opencode/big-pickle',
    cost: 'free',
  },
};

const DEFAULT_MODEL = 'mistral-nemo';

// ─── LLM Providers ──────────────────────────────────────────────────

async function callChutes(modelId, prompt, apiKey) {
  const res = await fetch('https://llm.chutes.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.1,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

async function callOpenCode(prompt, port = 9001) {
  const session = await fetch(`http://127.0.0.1:${port}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => r.json());

  await fetch(`http://127.0.0.1:${port}/session/${session.id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
  });

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const msgs = await fetch(`http://127.0.0.1:${port}/session/${session.id}/message`).then(r => r.json());
      for (const m of (Array.isArray(msgs) ? msgs : []).reverse()) {
        if (m.info?.role !== 'assistant') continue;
        if ((m.parts || []).some(p => p.type === 'step-finish')) {
          return (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
        }
      }
    } catch {}
  }
  throw new Error('OpenCode timeout');
}

// ─── Labeling ────────────────────────────────────────────────────────

const PROMPT_TEMPLATE = `You are a technical recruiter classifying a LinkedIn profile. Return ONLY valid JSON.

Profile:
- Name: {name}
- Title: {title}
- Headline: {headline}
- Raw Skills (NOISY — may contain names, UI text, Spanish phrases. IGNORE those, extract only REAL skills): {skills}
- Company: {company}
- Location: {location}

Return this JSON:
{
  "domain": "engineering|hr|design|data|product|management|sales|other",
  "seniority_level": "junior|mid|senior|staff|principal|lead|manager|director|vp|cto",
  "role_type": "individual_contributor|team_lead|manager|executive|founder|consultant",
  "remote_status": "remote|hybrid|onsite|unknown",
  "skills": [{"name":"Spring Boot","parent":"Java Ecosystem"}, {"name":"AWS","parent":"Cloud"}],
  "skill_tree": {"Java Ecosystem":["Spring Boot","Maven"], "Cloud":["AWS","OpenShift"]},
  "industries": ["fintech","enterprise"],
  "city": "Córdoba",
  "seniority_score": 65,
  "relevance_score": 85
}

Rules:
- skills: 5-10 REAL technical/professional skills. NO names, NO Spanish UI text, NO "Mostrar todo", "Validar", "Recibidas" etc.
- Each skill MUST have a parent category (e.g. "Programming Languages", "Cloud", "Architecture", "Databases", "Frameworks", "DevOps", "Management", "HR", "Data")
- skill_tree: hierarchy map of parent→[children]
- Extract skills from BOTH the headline AND the raw skills field
- If the person is non-technical (HR, sales), use professional skills like "Talent Acquisition", "Recruiting", "Executive Search" with parents like "HR", "Sales"
- seniority_score: junior=15, mid=35, senior=60, staff=75, principal=85, lead=70, manager=80, director=90, vp=95, cto=100`;

function buildPrompt(record) {
  return PROMPT_TEMPLATE
    .replace('{name}', record.name || '')
    .replace('{title}', record.title || '')
    .replace('{headline}', record.headline || '')
    .replace('{skills}', record.skills || '')
    .replace('{company}', record.company || '')
    .replace('{location}', record.location || '');
}

function parseLabels(text) {
  // Extract JSON from response (might be wrapped in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  const labels = JSON.parse(jsonMatch[0]);

  // Validate + normalize
  const valid = {
    domain: ['engineering', 'hr', 'design', 'data', 'product', 'management', 'sales', 'other'],
    seniority_level: ['junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', 'director', 'vp', 'cto'],
    role_type: ['individual_contributor', 'team_lead', 'manager', 'executive', 'founder', 'consultant'],
    remote_status: ['remote', 'hybrid', 'onsite', 'unknown'],
  };

  for (const [key, values] of Object.entries(valid)) {
    if (!values.includes(labels[key])) labels[key] = values.at(-1); // default to last
  }

  // Skills: array of {name, parent}
  labels.skills = Array.isArray(labels.skills) ? labels.skills.filter(s => s.name && s.parent) : [];
  // Flatten to tech_stack for backward compat
  labels.tech_stack = labels.skills.map(s => s.name);
  // Skill tree: {parent: [children]}
  labels.skill_tree = typeof labels.skill_tree === 'object' && !Array.isArray(labels.skill_tree) ? labels.skill_tree : {};
  labels.industries = Array.isArray(labels.industries) ? labels.industries : [];
  labels.city = typeof labels.city === 'string' ? labels.city : '';
  labels.seniority_score = Math.max(0, Math.min(100, parseInt(labels.seniority_score) || 50));
  labels.relevance_score = Math.max(0, Math.min(100, parseInt(labels.relevance_score) || 50));

  return labels;
}

/**
 * Label all unlabeled records in a task's database.
 * @param {string} dbPath — path to SQLite database
 * @param {string} modelName — key from MODELS catalog
 * @param {object} options — { apiKey, openCodePort, concurrency }
 */
export async function labelRecords(dbPath, modelName = DEFAULT_MODEL, options = {}) {
  const { apiKey, openCodePort = 9001, onProgress } = options;
  const model = MODELS[modelName];
  if (!model) throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(MODELS).join(', ')}`);

  if (model.provider === 'chutes' && !apiKey) {
    throw new Error('ChutesAI API key required. Set CHUTESAI_API_KEY env var.');
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));

  // Add label columns if they don't exist
  const labelCols = ['_labeled', 'domain', 'seniority_level', 'role_type', 'remote_status', 'tech_stack', 'skill_tree', 'industries', 'city', 'seniority_score', 'relevance_score'];
  for (const col of labelCols) {
    try { db.run(`ALTER TABLE records ADD COLUMN "${col}" TEXT`); } catch {} // ignore if exists
  }

  // Get unlabeled records
  const unlabeled = db.exec('SELECT _id, name, title, headline, skills, company, location FROM records WHERE _labeled IS NULL OR _labeled = 0');
  if (!unlabeled.length || !unlabeled[0].values.length) {
    console.log('All records already labeled');
    db.close();
    return 0;
  }

  const records = unlabeled[0].values;
  const cols = unlabeled[0].columns;
  console.log(`Labeling ${records.length} records with ${modelName} (${model.id})...`);

  let labeled = 0;
  for (const row of records) {
    const record = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const id = record._id;
    const prompt = buildPrompt(record);

    try {
      let response;
      if (model.provider === 'chutes') {
        response = await callChutes(model.id, prompt, apiKey);
      } else {
        response = await callOpenCode(prompt, openCodePort);
      }

      const labels = parseLabels(response);

      // Overwrite the messy 'skills' column with clean tech_stack names
      const cleanSkills = labels.tech_stack.join(', ');

      db.run(`UPDATE records SET
        _labeled = 1,
        skills = ?,
        domain = ?, seniority_level = ?, role_type = ?, remote_status = ?,
        tech_stack = ?, skill_tree = ?, industries = ?, city = ?,
        seniority_score = ?, relevance_score = ?
        WHERE _id = ?`,
        [
          cleanSkills,
          labels.domain, labels.seniority_level, labels.role_type, labels.remote_status,
          JSON.stringify(labels.skills), JSON.stringify(labels.skill_tree), JSON.stringify(labels.industries), labels.city,
          labels.seniority_score, labels.relevance_score,
          id,
        ]);

      labeled++;
      const pct = Math.round(labeled / records.length * 100);
      console.log(`  [${pct}%] ${record.name} → ${labels.domain}/${labels.seniority_level} (${labels.tech_stack.join(', ') || 'no stack'}) score:${labels.seniority_score}`);
      if (onProgress) onProgress(labeled, records.length, record.name, labels);

    } catch (err) {
      console.log(`  ✗ ${record.name} — ${err.message.substring(0, 60)}`);
    }
  }

  // Save
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  console.log(`Labeled ${labeled}/${records.length} records`);
  return labeled;
}
