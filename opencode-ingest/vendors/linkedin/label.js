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
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

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
  const start = Date.now();
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
  const elapsed = Date.now() - start;
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const usage = data.usage || {};
  const text = data.choices[0].message.content;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');

  const result = JSON.parse(match[0]);
  result._llm_metrics = {
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    elapsedMs: elapsed,
  };
  return result;
}

// ─── Pass 1: Extract ─────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are a senior technical recruiter. You are given the FULL TEXT of a LinkedIn profile page. Extract structured information.

The text contains navigation, UI elements, ads — IGNORE all of that. Focus on:
- The person's name, title, headline
- Their "About" / "Acerca de" section
- Their experience / work history
- Their skills / "Aptitudes" section
- Their education

FULL PROFILE TEXT:
---
{profile_text}
---

Return JSON:
{
  "name": "Full Name",
  "title": "Current Job Title",
  "company": "Current Company",
  "headline": "Full headline text",
  "city": "Normalized City (e.g. Córdoba, Buenos Aires)",
  "domain": "engineering|hr|design|data|product|management|sales|education|consulting",
  "seniority_level": "junior|mid|senior|staff|principal|lead|manager|director|vp|cto",
  "seniority_score": 65,
  "about": "Summary from About section (1-2 sentences)",
  "labels": [
    {"label": "Spring Boot", "confidence": 1.0, "source": "explicit"},
    {"label": "Docker", "confidence": 0.85, "source": "inferred"}
  ]
}

RULES:
- Extract 5-15 REAL skills/technologies/competencies
- "explicit": directly mentioned anywhere in the profile text
- "inferred": highly likely given the role but not mentioned
- Confidence 0-1
- Disambiguate: "Automation" for HR ≠ "Automation" for DevOps
- IGNORE: navigation text, UI labels, names of other people, ads, "Mostrar todo", "Validar", timestamps`;

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
  for (const col of ['_labeled', 'raw_labels', 'domain', 'seniority_level', 'seniority_score', 'city', 'skills_normalized', '_metrics']) {
    try { db.run(`ALTER TABLE records ADD COLUMN "${col}" TEXT`); } catch {}
  }

  // Pipeline metrics aggregated across all records
  const pipelineMetrics = {
    model: model,
    modelId: modelConfig.id,
    records: 0,
    totalTimeMs: 0,
    stages: {
      htmlToText: { totalBytes: 0, totalChars: 0, totalMs: 0 },
      extract: { totalTokensIn: 0, totalTokensOut: 0, totalMs: 0, totalCost: 0 },
      normalize: { totalTokensIn: 0, totalTokensOut: 0, totalMs: 0, totalCost: 0 },
      postProcess: { synonymsMerged: 0, orphansFixed: 0, duplicatesRemoved: 0, totalMs: 0 },
    },
  };

  // Get unlabeled records
  const q = `SELECT _id, name, profileUrl FROM records WHERE _labeled IS NULL OR _labeled = 0`
    + (limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '');
  const unlabeled = db.exec(q);
  if (!unlabeled.length || !unlabeled[0].values.length) { console.log('All records labeled'); db.close(); return 0; }

  const records = unlabeled[0].values;
  const cols = unlabeled[0].columns;

  // Find HTML directory
  const htmlDir = dbPath.replace('/db.sqlite', '/html');
  const { readdirSync } = await import('fs');
  const htmlFiles = existsSync(htmlDir) ? readdirSync(htmlDir).filter(f => f.includes('profile')) : [];

  const taxonomy = FIXED_TAXONOMY.split('\n').map(l => l.trim()).filter(Boolean);

  console.log(`Labeling ${records.length} records with ${model} (${modelConfig.id})`);
  console.log(`HTML profiles available: ${htmlFiles.length}`);

  let labeled = 0;
  for (const row of records) {
    const record = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const id = record._id;

    try {
      // ── Find the HTML file for this profile ──
      const slug = (record.profileUrl || '').split('/in/')[1]?.replace(/\//g, '') || record.name?.toLowerCase().replace(/\s/g, '-');
      const htmlFile = htmlFiles.find(f => f.includes(slug));
      let profileText = '';

      if (htmlFile) {
        const html = readFileSync(join(htmlDir, htmlFile), 'utf8');
        // Convert HTML to clean text
        profileText = html
          .replace(/<script.*?<\/script>/gis, '')
          .replace(/<style.*?<\/style>/gis, '')
          .replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis, '\n## $1\n')
          .replace(/<li[^>]*>/gi, '\n- ')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<p[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        // Truncate to ~12K chars (~3K tokens) to stay well within limits
        if (profileText.length > 12000) profileText = profileText.substring(0, 12000);
      }

      // ── Pass 1: Extract from full profile text ──
      let extractPrompt;
      if (profileText) {
        extractPrompt = EXTRACT_PROMPT.replace('{profile_text}', profileText);
      } else {
        // Fallback: use DB fields if no HTML available
        extractPrompt = EXTRACT_PROMPT.replace('{profile_text}',
          `Name: ${record.name}\nNo HTML available — limited data.`);
      }

      const t1 = Date.now();
      const raw = await callLLM(modelConfig.id, extractPrompt, apiKey);
      const extractMetrics = raw._llm_metrics || {};
      delete raw._llm_metrics;
      pipelineMetrics.stages.extract.totalMs += extractMetrics.elapsedMs || 0;
      pipelineMetrics.stages.extract.totalTokensIn += extractMetrics.promptTokens || 0;
      pipelineMetrics.stages.extract.totalTokensOut += extractMetrics.completionTokens || 0;

      // ── Option B: Feed existing labels to normalize prompt ──
      let existingLabels = '';
      try {
        const existing = db.exec("SELECT skills_normalized FROM records WHERE skills_normalized IS NOT NULL AND skills_normalized != ''");
        if (existing.length) {
          const leafCounts = {};
          existing[0].values.forEach(row => {
            try { JSON.parse(row[0]).forEach(s => { const leaf = s.path?.split('|').pop(); if (leaf) leafCounts[leaf] = (leafCounts[leaf]||0)+1; }); } catch {}
          });
          const sorted = Object.entries(leafCounts).sort((a,b) => b[1]-a[1]).slice(0, 50);
          if (sorted.length) {
            existingLabels = '\n\nALREADY USED LABELS (reuse these exact names, do NOT create synonyms):\n' +
              sorted.map(([name, count]) => `  ${name} (${count}x)`).join('\n');
          }
        }
      } catch {}

      // ── Pass 2: Normalize to taxonomy ──
      const rawLabelsStr = (raw.labels || []).map(l => `${l.label} (${l.confidence}, ${l.source})`).join('\n');

      const normPrompt = NORMALIZE_PROMPT
        .replace('{raw_labels}', rawLabelsStr + existingLabels)
        .replace('{domain}', raw.domain || 'unknown');

      const normalized = await callLLM(modelConfig.id, normPrompt, apiKey);
      const normMetrics = normalized._llm_metrics || {};
      delete normalized._llm_metrics;
      pipelineMetrics.stages.normalize.totalMs += normMetrics.elapsedMs || 0;
      pipelineMetrics.stages.normalize.totalTokensIn += normMetrics.promptTokens || 0;
      pipelineMetrics.stages.normalize.totalTokensOut += normMetrics.completionTokens || 0;

      const t2 = Date.now();
      let synonymsMerged = 0, orphansFixed = 0, duplicatesRemoved = 0;

      // Post-process: fix common LLM mistakes
      if (normalized.skills) {
        normalized.skills = normalized.skills.map(s => {
          if (!s.path) return s;
          let p = s.path;
          // Fix spelling variants
          p = p.replace('Problem-solving', 'Problem Solving').replace('Problem-Solving', 'Problem Solving');
          // Fix stuttering
          const parts = p.split('|');
          if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) { parts.pop(); synonymsMerged++; }
          // Fix misplacements
          if (p.startsWith('Languages|Programming|Spanish')) p = 'Languages|Spoken|Spanish';
          if (p.startsWith('Languages|Programming|English')) p = 'Languages|Spoken|English';
          if (p.startsWith('Languages|Programming|French')) p = 'Languages|Spoken|French';
          if (p.startsWith('Languages|Programming|Portuguese')) p = 'Languages|Spoken|Portuguese';
          if (p.startsWith('Languages|Programming|Git')) p = 'Practices|Tools|Git';
          // Fix orphans: map to proper categories
          if (!p.includes('|')) {
            const orphanMap = {
              'psychology': 'HR|Strategy', 'administration': 'Management|Operations',
              'storytelling': 'Management|Strategy', 'volunteer management': 'Management|Leadership',
              'coaching': 'Management|Leadership', 'mentoring': 'Management|Leadership',
              'teamwork': 'Practices|Collaboration', 'negotiation': 'Management|Operations',
            };
            p = (orphanMap[p.toLowerCase()] || 'Management|Operations') + '|' + p;
            orphansFixed++;
          }
          // Fix "DevOps|CI/CD|CI/CD" stutter
          if (p === 'DevOps|CI/CD|CI/CD' || p === 'DevOps|CI/CD|Continuous Integration/Continuous Deployment (CI/CD)') p = 'DevOps|CI/CD';
          // Remove "Custom Skill" prefix
          p = p.replace('|Custom Skill|', '|');
          s.path = parts.length >= 2 ? parts.join('|') : p;
          return s;
        }).filter(s => s.path && s.path.length > 2);

        // Deduplicate paths
        const seen = new Set();
        const beforeDedup = normalized.skills.length;
        normalized.skills = normalized.skills.filter(s => {
          if (seen.has(s.path)) return false;
          seen.add(s.path);
          return true;
        });
        duplicatesRemoved = beforeDedup - normalized.skills.length;
      }

      // Post-process domain: ensure single clean value
      if (raw.domain) {
        const d = raw.domain.split('|')[0].trim().toLowerCase();
        if (d === 'other') raw.domain = 'management'; // no wildcards
        else raw.domain = d;
      }

      // Post-process seniority: clean
      if (raw.seniority_level) {
        const s = raw.seniority_level.split('|')[0].trim().toLowerCase();
        const valid = ['junior','mid','senior','staff','principal','lead','manager','director','vp','cto'];
        raw.seniority_level = valid.includes(s) ? s : (s === 'co-founder' ? 'director' : 'senior');
      }

      // Post-process city
      if (raw.city) {
        const cityMap = { 'cordoba': 'Córdoba', 'córdoba': 'Córdoba', 'buenos aires': 'Buenos Aires' };
        raw.city = cityMap[raw.city.toLowerCase()] || raw.city;
      }

      const t3 = Date.now();
      pipelineMetrics.stages.postProcess.synonymsMerged += synonymsMerged;
      pipelineMetrics.stages.postProcess.orphansFixed += orphansFixed;
      pipelineMetrics.stages.postProcess.duplicatesRemoved += duplicatesRemoved;
      pipelineMetrics.stages.postProcess.totalMs += (t3 - t2);

      // Per-record metrics
      const recordMetrics = {
        htmlBytes: htmlFile ? readFileSync(join(htmlDir, htmlFile)).length : 0,
        textChars: profileText.length,
        extract: { tokens: extractMetrics.totalTokens || 0, ms: extractMetrics.elapsedMs || 0 },
        normalize: { tokens: normMetrics.totalTokens || 0, ms: normMetrics.elapsedMs || 0 },
        postProcess: { synonymsMerged, orphansFixed, duplicatesRemoved, ms: t3 - t2 },
        totalMs: t3 - t1,
        rawLabelsCount: (raw.labels || []).length,
        normalizedCount: (normalized.skills || []).length,
      };

      pipelineMetrics.stages.htmlToText.totalBytes += recordMetrics.htmlBytes;
      pipelineMetrics.stages.htmlToText.totalChars += recordMetrics.textChars;

      // Write labels + metrics
      db.run(`UPDATE records SET
        _labeled = 1, raw_labels = ?, _metrics = ?,
        title = COALESCE(?, title), company = COALESCE(?, company), headline = COALESCE(?, headline),
        domain = ?, seniority_level = ?, seniority_score = ?, city = ?,
        skills_normalized = ?
        WHERE _id = ?`, [
        JSON.stringify(raw), JSON.stringify(recordMetrics),
        raw.title || null, raw.company || null, raw.headline || null,
        raw.domain, raw.seniority_level, raw.seniority_score, raw.city,
        JSON.stringify(normalized.skills || []),
        id,
      ]);

      labeled++;
      pipelineMetrics.records = labeled;
      pipelineMetrics.totalTimeMs += recordMetrics.totalMs;
      const pct = Math.round(labeled / records.length * 100);
      const skillSummary = (normalized.skills || []).slice(0, 4).map(s => s.path.split('|').pop()).join(', ');
      console.log(`  [${pct}%] ${record.name} → ${raw.domain}/${raw.seniority_level} | ${skillSummary} (${(recordMetrics.totalMs/1000).toFixed(1)}s)`);

    } catch (err) {
      console.log(`  ✗ ${record.name} — ${(err.message || String(err)).substring(0, 80)}`);
    }
  }

  // ── Option A: Dedup pass — merge synonyms across all records ──
  console.log('\n  Running dedup pass...');
  const dedupStart = Date.now();
  try {
    const allLabeled = db.exec("SELECT _id, skills_normalized FROM records WHERE skills_normalized IS NOT NULL");
    if (allLabeled.length) {
      // Collect all leaf names
      const leafCounts = {};
      allLabeled[0].values.forEach(row => {
        try { JSON.parse(row[1]).forEach(s => { const leaf = s.path?.split('|').pop(); if (leaf) leafCounts[leaf] = (leafCounts[leaf]||0)+1; }); } catch {}
      });

      // Find likely synonyms (similar names)
      const synonyms = {};
      const leaves = Object.keys(leafCounts);
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          const a = leaves[i], b = leaves[j];
          const al = a.toLowerCase(), bl = b.toLowerCase();
          if (al === bl && a !== b) { synonyms[b] = a; } // case diff
          else if (al.replace(/[^a-z]/g, '') === bl.replace(/[^a-z]/g, '')) { synonyms[leafCounts[a] < leafCounts[b] ? a : b] = leafCounts[a] >= leafCounts[b] ? a : b; }
          else if (al === bl + 's' || bl === al + 's') { synonyms[a.length > b.length ? a : b] = a.length <= b.length ? a : b; } // plural
        }
      }
      // Known synonyms
      const knownSynonyms = { 'Golang': 'Go', 'Spring Framework': 'Spring Boot', 'Problem-Solving': 'Problem Solving', 'Problem-solving': 'Problem Solving', 'Code Reviews': 'Code Review' };
      Object.assign(synonyms, knownSynonyms);

      if (Object.keys(synonyms).length) {
        console.log('  Merging synonyms:', Object.entries(synonyms).map(([from, to]) => `${from}→${to}`).join(', '));
        let totalMerged = 0;
        allLabeled[0].values.forEach(row => {
          const skills = JSON.parse(row[1]);
          let changed = false;
          skills.forEach(s => {
            const leaf = s.path?.split('|').pop();
            if (leaf && synonyms[leaf]) {
              const parts = s.path.split('|');
              parts[parts.length - 1] = synonyms[leaf];
              s.path = parts.join('|');
              changed = true;
              totalMerged++;
            }
          });
          if (changed) {
            // Dedup after merge
            const seen = new Set();
            const deduped = skills.filter(s => { if (seen.has(s.path)) return false; seen.add(s.path); return true; });
            db.run('UPDATE records SET skills_normalized = ? WHERE _id = ?', [JSON.stringify(deduped), row[0]]);
          }
        });
        pipelineMetrics.stages.postProcess.synonymsMerged += totalMerged;
        console.log(`  Merged ${totalMerged} synonym occurrences`);
      } else {
        console.log('  No synonyms found');
      }
    }
  } catch (err) {
    console.log(`  Dedup error: ${err.message}`);
  }
  pipelineMetrics.stages.postProcess.totalMs += (Date.now() - dedupStart);

  // Save
  writeFileSync(dbPath, Buffer.from(db.export()));

  // Save pipeline metrics alongside the DB
  const metricsPath = dbPath.replace('db.sqlite', 'pipeline-metrics.json');
  writeFileSync(metricsPath, JSON.stringify(pipelineMetrics, null, 2));

  db.close();

  // Print summary
  const s = pipelineMetrics.stages;
  const pricing = modelConfig.cost;
  console.log(`\n  ╔═══════════════════════════════════════╗`);
  console.log(`  ║        Pipeline Metrics Summary        ║`);
  console.log(`  ╚═══════════════════════════════════════╝`);
  console.log(`  Records:    ${labeled}/${records.length}`);
  console.log(`  Model:      ${model} (${modelConfig.id})`);
  console.log(`  Total time: ${(pipelineMetrics.totalTimeMs/1000).toFixed(1)}s`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  HTML→Text:  ${(s.htmlToText.totalBytes/1024).toFixed(0)}KB → ${(s.htmlToText.totalChars/1024).toFixed(0)}KB text`);
  console.log(`  Extract:    ${s.extract.totalTokensIn}+${s.extract.totalTokensOut} tokens, ${(s.extract.totalMs/1000).toFixed(1)}s`);
  console.log(`  Normalize:  ${s.normalize.totalTokensIn}+${s.normalize.totalTokensOut} tokens, ${(s.normalize.totalMs/1000).toFixed(1)}s`);
  console.log(`  PostProc:   ${s.postProcess.synonymsMerged} synonyms, ${s.postProcess.orphansFixed} orphans, ${s.postProcess.duplicatesRemoved} dupes`);
  console.log(`  Saved:      ${metricsPath}`);

  return labeled;
}
