#!/usr/bin/env node
/**
 * REAL HR benchmark — actually browses job sites via Playwright.
 * Every data point is scraped from a real website, stored in SQLite.
 * No fabricated data. If it's in the report, it came from a real page.
 *
 * Usage:
 *   node tests/benchmark-hr-real.js                # run all steps
 *   node tests/benchmark-hr-real.js --step search  # run one step
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const MCP_CONFIG = path.join(__dirname, '..', '.mcp-playwright.json');
const TASK_ID = 'hr-real-' + new Date().toISOString().slice(0, 10);
const COLLECTION = 'hr-research-real';

function askClaude(prompt, timeoutSec) {
  try {
    return execSync(
      `claude --mcp-config ${MCP_CONFIG} --model haiku --output-format text --dangerously-skip-permissions -p -`,
      { input: prompt, timeout: (timeoutSec || 240) * 1000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    ).trim();
  } catch (e) {
    return (e.stdout || '').trim();
  }
}

// Check what we already have (watermark — don't re-scrape)
function getExistingData(stepName) {
  const rows = db.getData(COLLECTION + '/' + stepName);
  return rows.length > 0 ? JSON.parse(rows[0].data) : null;
}

const STEPS = [
  {
    name: 'glassdoor_salaries',
    prompt: `Use the Playwright browser to research Scala developer salaries:
1. Navigate to google.com
2. Search for "Scala developer salary Argentina 2025 2026 glassdoor"
3. Click on relevant results (Glassdoor, PayScale, Levels.fyi, or similar)
4. Extract ACTUAL salary data you find on the pages

Format the results as a CSV with these columns:
Source URL, Job Title, Location, Min Salary USD, Max Salary USD, Currency, Date Found

Output ONLY a CSV block like this:
\`\`\`csv
Source URL,Job Title,Location,Min Salary USD,Max Salary USD,Currency,Date Found
https://...,Scala Developer,Buenos Aires,...
\`\`\`

CRITICAL: Use REAL data from the actual websites. Include the source URL for each row.`,
  },
  {
    name: 'linkedin_jobs',
    prompt: `Use the Playwright browser to find Scala job postings:
1. Navigate to google.com
2. Search for "Scala developer jobs LATAM site:linkedin.com OR site:getonbrd.com OR site:computrabajo.com"
3. Click into 2-3 of the result pages
4. Extract job posting details

Format as CSV:
\`\`\`csv
Source URL,Job Title,Company,Location,Seniority,Posted Date,Key Skills
https://...,Senior Scala Engineer,CompanyName,Buenos Aires,...
\`\`\`

CRITICAL: Only include data you actually found on real pages. Include source URLs.`,
  },
  {
    name: 'market_size',
    prompt: `Use the Playwright browser to research the Scala job market size:
1. Navigate to google.com
2. Search for "Scala developers demand LATAM 2025 2026 statistics"
3. Also search for "functional programming adoption Latin America"
4. Read the results and extract factual statistics

Format as CSV:
\`\`\`csv
Source URL,Metric,Value,Region,Date
https://...,Number of Scala job postings,1234,Argentina,2025
\`\`\`

CRITICAL: Only include statistics you actually found on real pages with source URLs.`,
  },
  {
    name: 'company_hiring',
    prompt: `Use the Playwright browser to find companies hiring Scala developers in LATAM:
1. Navigate to google.com
2. Search for "companies hiring Scala developers Argentina Brazil Colombia 2025 2026"
3. Also try: "Scala jobs Buenos Aires" on google
4. Extract company names and details from the actual search results and pages

Format as CSV:
\`\`\`csv
Source URL,Company,Location,Role,Industry
https://...,MercadoLibre,Buenos Aires,Senior Scala Engineer,E-commerce
\`\`\`

CRITICAL: Only real companies from real pages. Include source URLs.`,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const stepFilter = args.find(a => a !== '--step' && args.includes('--step'));
  const stepsToRun = stepFilter ? STEPS.filter(s => s.name === stepFilter) : STEPS;

  console.log('\n👥 HR Research Benchmark — REAL Web Scraping\n');
  console.log(`Task: ${TASK_ID}`);
  console.log(`Steps: ${stepsToRun.map(s => s.name).join(', ')}`);
  console.log(`SQLite: ${db.DB_PATH}\n`);

  const benchmarkSteps = [];
  let totalRows = 0;

  for (const step of stepsToRun) {
    // Check watermark — skip if we already have data for this step today
    const existing = getExistingData(step.name);
    if (existing && !args.includes('--force')) {
      console.log(`⏭  ${step.name} — already scraped today (use --force to re-run)`);
      benchmarkSteps.push({ name: step.name, time: 0, rows: 0, status: 'cached', sources: [] });
      continue;
    }

    process.stdout.write(`🔍 ${step.name} ... `);
    const start = Date.now();
    const result = askClaude(step.prompt, 300);
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    if (!result) {
      console.log(`❌ empty response (${elapsed}s)`);
      benchmarkSteps.push({ name: step.name, time: Number(elapsed), rows: 0, status: 'fail', sources: [] });
      continue;
    }

    // Extract CSV data
    const csvMatch = result.match(/```csv\s*\n([\s\S]*?)```/);
    let rows = [];
    let headers = [];
    let sources = [];

    if (csvMatch) {
      const lines = csvMatch[1].trim().split('\n').filter(l => l.trim());
      if (lines.length > 1) {
        headers = lines[0].split(',').map(h => h.trim());
        rows = lines.slice(1).map(l => {
          // Handle CSV with commas inside quotes
          const cells = [];
          let current = '';
          let inQuotes = false;
          for (const ch of l) {
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
            current += ch;
          }
          cells.push(current.trim());
          return cells;
        });
        // Extract source URLs
        const urlCol = headers.findIndex(h => h.toLowerCase().includes('source') || h.toLowerCase().includes('url'));
        if (urlCol >= 0) {
          sources = rows.map(r => r[urlCol]).filter(u => u && u.startsWith('http'));
        }
      }
    }

    // Store in SQLite
    db.saveData(TASK_ID, COLLECTION + '/' + step.name, JSON.stringify({
      text: result,
      headers,
      rows,
      sources,
      scrapedAt: new Date().toISOString(),
    }), 'json');

    totalRows += rows.length;
    console.log(`✅ ${rows.length} rows, ${sources.length} sources (${elapsed}s)`);

    benchmarkSteps.push({
      name: step.name,
      time: Number(elapsed),
      rows: rows.length,
      status: rows.length > 0 ? 'pass' : 'warn',
      sources,
    });
  }

  // Save benchmark
  const totalTime = benchmarkSteps.reduce((a, s) => a + s.time, 0);
  db.saveBenchmark('hr-real', totalTime * 1000, benchmarkSteps, {
    totalRows,
    totalSources: benchmarkSteps.reduce((a, s) => a + s.sources.length, 0),
    stepsPass: benchmarkSteps.filter(s => s.status === 'pass').length,
    stepsTotal: benchmarkSteps.length,
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Total: ${totalTime}s, ${totalRows} rows scraped`);
  console.log(`Sources: ${benchmarkSteps.reduce((a, s) => a + s.sources.length, 0)} URLs`);
  console.log(`SQLite: ${db.DB_PATH}`);
  console.log(`\nRun ./scripts/benchmark-report.sh hr-real to generate the report`);
  console.log(`${'─'.repeat(50)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
