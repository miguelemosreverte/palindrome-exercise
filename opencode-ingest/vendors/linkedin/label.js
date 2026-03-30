/**
 * LinkedIn — Two-pass LLM labeling pipeline
 *
 * Pass 1 (Extract): LLM reads profile, outputs raw labels — everything it finds.
 *   No constraints. Explicit + inferred with confidence. → raw_labels column.
 *
 * Pass 2 (Normalize): LLM receives raw labels + the known taxonomy.
 *   Maps to pipe-delimited hierarchy: "DevOps|Containers|Docker"
 *   Infers missing labels from the taxonomy. → normalized label columns.
 *
 * Pipe format: parent|child|grandchild (unlimited depth, queryable with LIKE)
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

// ─── Model Catalog ───────────────────────────────────────────────────

export const MODELS = {
  'mistral-nemo':  { provider: 'chutes', id: 'unsloth/Mistral-Nemo-Instruct-2407', cost: '$0.02/$0.04' },
  'mistral-small': { provider: 'chutes', id: 'chutesai/Mistral-Small-3.2-24B-Instruct-2506', cost: '$0.06/$0.18' },
  'gemma-4b':      { provider: 'chutes', id: 'unsloth/gemma-3-4b-it', cost: '$0.01/$0.03' },
  'hermes-14b':    { provider: 'chutes', id: 'NousResearch/Hermes-4-14B', cost: '$0.01/$0.05' },
  'qwen-32b':      { provider: 'chutes', id: 'Qwen/Qwen3-32B-TEE', cost: '$0.08/$0.24' },
};

// ─── LLM Call ────────────────────────────────────────────────────────

async function callLLM(modelId, prompt, apiKey) {
  const res = await fetch('https://llm.chutes.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800, temperature: 0.1,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.choices[0].message.content;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

// ─── Pass 1: Extract ─────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are a senior technical recruiter. Extract ALL skills from this LinkedIn profile.

Profile:
- Name: {name}
- Title: {title}
- Headline: {headline}
- Raw Skills (NOISY — may contain names, UI text. IGNORE non-skills): {skills}
- Company: {company}
- Location: {location}

Return JSON:
{
  "domain": "engineering|hr|design|data|product|management|sales|other",
  "seniority_level": "junior|mid|senior|staff|principal|lead|manager|director|vp|cto",
  "seniority_score": 65,
  "city": "Normalized City Name",
  "labels": [
    {"label": "Spring Boot", "confidence": 1.0, "source": "explicit"},
    {"label": "Docker", "confidence": 0.85, "source": "inferred"},
    ...
  ]
}

RULES:
- Extract EVERY real skill/technology/competency. Min 5, max 15.
- "explicit": directly mentioned in title, headline, or skills
- "inferred": not mentioned but highly likely given the role. A Java backend dev probably knows Maven, Git, REST APIs, SQL. An HR recruiter probably knows ATS systems, interviewing, sourcing.
- Confidence 0-1: how sure are you this person has this skill
- Disambiguate by domain: "Automation" for HR = "HR Process Automation". "Automation" for DevOps = "CI/CD Automation"
- NO names, NO Spanish UI text, NO "Mostrar todo"/"Validar"/etc.
- Include soft skills for non-tech roles (negotiation, stakeholder management, etc.)`;

// ─── Pass 2: Normalize ───────────────────────────────────────────────

const NORMALIZE_PROMPT = `You are normalizing skill labels into a standard taxonomy using pipe-delimited hierarchy.

Format: "Parent|Child|Grandchild" — left is broader, right is more specific.

EXISTING TAXONOMY (use these paths when possible, add new ones if needed):
{taxonomy}

RAW LABELS from previous extraction:
{raw_labels}

Person's domain: {domain}

Return JSON:
{
  "skills": [
    {"path": "Engineering|Backend|Java", "confidence": 1.0, "source": "explicit"},
    {"path": "Engineering|Backend|Spring Boot", "confidence": 1.0, "source": "explicit"},
    {"path": "DevOps|Containers|Docker", "confidence": 0.85, "source": "inferred"},
    {"path": "Engineering|Practices|REST APIs", "confidence": 0.9, "source": "inferred"},
    ...
  ]
}

RULES:
- Map EACH raw label to a pipe-delimited path in the taxonomy
- If a raw label doesn't fit existing paths, create a new path following the pattern
- Keep confidence and source from the raw labels
- You may infer skills ONLY if they are directly implied by the person's actual role/domain.
  Do NOT copy skills from the taxonomy that don't match the person's domain.
  An Operations Manager should NOT get Java/Docker/Kubernetes unless their profile mentions coding.
- Every path MUST have at least 2 levels (parent|child). No orphan top-level labels.
- Each skill can only appear ONCE in the taxonomy. If "Kubernetes" already has a path, reuse it.
- The domain context is critical: HR person → HR paths. Manager → Management paths. Engineer → Engineering paths.
- Normalize spelling: "Kubernetes" not "k8s", "JavaScript" not "js"`;

// ─── Pipeline ────────────────────────────────────────────────────────

/**
 * Run the two-pass labeling pipeline.
 * @param {string} dbPath
 * @param {object} options - { model, apiKey, limit, offset }
 */
export async function labelRecords(dbPath, options = {}) {
  const { model = 'mistral-nemo', apiKey, limit = 0, offset = 0 } = options;
  const modelConfig = MODELS[model];
  if (!modelConfig) throw new Error(`Unknown model: ${model}. Available: ${Object.keys(MODELS).join(', ')}`);
  if (!apiKey) throw new Error('API key required. Set CHUTESAI_API_KEY.');

  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));

  // Add columns
  for (const col of ['_labeled', 'raw_labels', 'domain', 'seniority_level', 'seniority_score', 'city', 'skills_normalized']) {
    try { db.run(`ALTER TABLE records ADD COLUMN "${col}" TEXT`); } catch {}
  }

  // Get unlabeled records
  const q = `SELECT _id, name, title, headline, skills, company, location FROM records WHERE _labeled IS NULL OR _labeled = 0`
    + (limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '');
  const unlabeled = db.exec(q);
  if (!unlabeled.length || !unlabeled[0].values.length) { console.log('All records labeled'); db.close(); return 0; }

  const records = unlabeled[0].values;
  const cols = unlabeled[0].columns;

  // Build existing taxonomy from already-labeled records
  let taxonomy = [];
  try {
    const existing = db.exec("SELECT skills_normalized FROM records WHERE skills_normalized IS NOT NULL AND skills_normalized != ''");
    if (existing.length) {
      const paths = new Set();
      existing[0].values.forEach(row => {
        try { JSON.parse(row[0]).forEach(s => paths.add(s.path)); } catch {}
      });
      taxonomy = [...paths].sort();
    }
  } catch {}

  console.log(`Labeling ${records.length} records with ${model} (${modelConfig.id})`);
  console.log(`Existing taxonomy: ${taxonomy.length} paths`);

  let labeled = 0;
  for (const row of records) {
    const record = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const id = record._id;

    try {
      // ── Pass 1: Extract raw labels ──
      const extractPrompt = EXTRACT_PROMPT
        .replace('{name}', record.name || '')
        .replace('{title}', record.title || '')
        .replace('{headline}', record.headline || '')
        .replace('{skills}', record.skills || '')
        .replace('{company}', record.company || '')
        .replace('{location}', record.location || '');

      const raw = await callLLM(modelConfig.id, extractPrompt, apiKey);

      // ── Pass 2: Normalize to taxonomy ──
      const rawLabelsStr = (raw.labels || []).map(l => `${l.label} (${l.confidence}, ${l.source})`).join('\n');
      const taxonomyStr = taxonomy.length ? taxonomy.join('\n') : '(empty — you are building the initial taxonomy)';

      const normPrompt = NORMALIZE_PROMPT
        .replace('{taxonomy}', taxonomyStr)
        .replace('{raw_labels}', rawLabelsStr)
        .replace('{domain}', raw.domain || 'unknown');

      const normalized = await callLLM(modelConfig.id, normPrompt, apiKey);

      // Update taxonomy with new paths
      (normalized.skills || []).forEach(s => { if (s.path && !taxonomy.includes(s.path)) taxonomy.push(s.path); });
      taxonomy.sort();

      // NEVER overwrite the original skills column — it's raw data.
      // Write labels to their own columns only.
      db.run(`UPDATE records SET
        _labeled = 1, raw_labels = ?,
        domain = ?, seniority_level = ?, seniority_score = ?, city = ?,
        skills_normalized = ?
        WHERE _id = ?`, [
        JSON.stringify(raw),
        raw.domain, raw.seniority_level, raw.seniority_score, raw.city,
        JSON.stringify(normalized.skills || []),
        id,
      ]);

      labeled++;
      const pct = Math.round(labeled / records.length * 100);
      const skillSummary = (normalized.skills || []).slice(0, 4).map(s => s.path.split('|').pop()).join(', ');
      console.log(`  [${pct}%] ${record.name} → ${raw.domain}/${raw.seniority_level} | ${skillSummary}`);

    } catch (err) {
      console.log(`  ✗ ${record.name} — ${err.message.substring(0, 80)}`);
    }
  }

  // Save
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  console.log(`\nLabeled ${labeled}/${records.length}. Taxonomy: ${taxonomy.length} paths.`);
  return labeled;
}
