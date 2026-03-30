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

// Fixed taxonomy skeleton — the LLM maps to these, never invents top/mid levels
const FIXED_TAXONOMY = `Engineering|Backend (Java, Spring Boot, Node.js, Python, Go, C#, REST APIs, GraphQL, Microservices)
Engineering|Frontend (JavaScript, TypeScript, React, Vue, Angular, Nuxt.js, Next.js, CSS)
Engineering|Databases (SQL, NoSQL, PostgreSQL, MongoDB, Redis, Elasticsearch)
Engineering|Architecture (System Design, API Design, Event-Driven, Domain-Driven Design)
Engineering|Mobile (iOS, Android, React Native, Flutter)
DevOps|Containers (Docker, Kubernetes, OpenShift)
DevOps|CI/CD (Jenkins, GitHub Actions, GitLab CI, CircleCI)
DevOps|Cloud (AWS, GCP, Azure, Terraform, Infrastructure as Code)
DevOps|Monitoring (Prometheus, Grafana, DataDog, New Relic)
Data|Analysis (Data Analysis, Data Visualization, Business Intelligence)
Data|Engineering (ETL, Data Pipelines, Spark, Kafka, Big Data)
Data|Science (Machine Learning, Deep Learning, NLP, Statistics, Python)
HR|Recruiting (Talent Acquisition, Sourcing, Candidate Screening, Interviewing)
HR|Tools (ATS, AVATURE, LinkedIn Recruiter, HR Automation)
HR|Strategy (Employer Branding, Workforce Planning, Talent Analytics, D&I)
HR|Executive (Executive Search, Headhunting, Strategic Recruitment)
Management|Leadership (Team Leadership, Team Management, Mentoring, Coaching)
Management|Operations (Process Improvement, Service Delivery, Change Management, Stakeholder Management)
Management|Strategy (Strategic Planning, Business Development, Digital Transformation, Innovation)
Management|Project (Project Management, Agile, Scrum, Program Management)
Management|Product (Product Management, Product Strategy, Roadmapping)
Management|Finance (Investment, Fundraising, M&A, Venture Capital, Entrepreneurship)
Practices|Collaboration (Teamwork, Cross-functional, Pair Programming)
Practices|Quality (Problem Solving, Troubleshooting, Code Review, Testing)
Practices|Tools (Git, Maven, Gradle, npm, IDE)
Languages|Spoken (English, Spanish, Portuguese, French)
Languages|Programming (Python, Java, JavaScript, Go, Rust, Scala, C#, C++)`;

const NORMALIZE_PROMPT = `Map each raw label to ONE path from the FIXED taxonomy below. Use EXACT paths.

FIXED TAXONOMY:
${FIXED_TAXONOMY}

RAW LABELS to map:
{raw_labels}

Person's domain: {domain}

Return JSON:
{
  "skills": [
    {"path": "Engineering|Backend|Java", "confidence": 1.0, "source": "explicit"},
    {"path": "DevOps|Containers|Docker", "confidence": 0.85, "source": "inferred"}
  ]
}

RULES:
1. ONLY map raw labels listed above — do NOT add skills not in the list
2. Use EXACT taxonomy paths. Pick the BEST match from the fixed taxonomy.
3. If a raw label doesn't fit any path, use the closest parent + the label name: e.g. "Management|Operations|Custom Skill"
4. "REST APIs" → "Engineering|Backend|REST APIs" (NEVER "Engineering|Practices|REST APIs")
5. "Backend Development" is not a skill — skip it or map to "Engineering|Backend"
6. "Python" the programming language → "Languages|Programming|Python", NOT "Languages|Spoken"
7. "Nuxt.js" → "Engineering|Frontend|Nuxt.js", NOT top-level
8. One skill = one path. No duplicates. No stuttering (no "Management|Leadership|Leadership").`;

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

  const taxonomy = FIXED_TAXONOMY.split('\n').map(l => l.trim()).filter(Boolean);

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

      const normPrompt = NORMALIZE_PROMPT
        .replace('{raw_labels}', rawLabelsStr)
        .replace('{domain}', raw.domain || 'unknown');

      const normalized = await callLLM(modelConfig.id, normPrompt, apiKey);


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
      console.log(`  ✗ ${record.name} — ${(err.message || String(err)).substring(0, 80)}`);
    }
  }

  // Save
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  console.log(`\nLabeled ${labeled}/${records.length}. Taxonomy: ${taxonomy.length} paths.`);
  return labeled;
}
