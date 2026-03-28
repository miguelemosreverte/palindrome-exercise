#!/usr/bin/env node
/**
 * HR Research Benchmark — thin wrapper over the task-runner.
 *
 * Creates an HR research task in Firebase, then runs it via task-runner.sh.
 * The task-runner does ALL the work: engine cascade, SQLite persistence,
 * watermarks, benchmarking, reporting.
 *
 * Usage:
 *   node tests/benchmark-hr-real.js              # one iteration
 *   node tests/benchmark-hr-real.js --loop        # keep going until stopped
 *   node tests/benchmark-hr-real.js --report      # just generate report
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FIREBASE_URL = 'https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app';
const TASKS_PATH = 'mercadopago-bridge/bridge-tasks';
const TASK_ID = 'hr-scala-latam';

const args = process.argv.slice(2);
const report = args.includes('--report');

// Task definition — the steps that the task-runner will execute
const TASK = {
  goal: 'Find Scala developers in LATAM — salaries, job postings, market data, companies',
  status: 'pending',
  currentStep: 0,
  steps: [
    {
      name: 'glassdoor_salaries',
      prompt: 'Use the Playwright browser to research Scala developer salaries:\n1. Navigate to google.com\n2. Search for "Scala developer salary Argentina 2025 2026 glassdoor"\n3. Click on relevant results (Glassdoor, PayScale, Levels.fyi, or similar)\n4. Extract ACTUAL salary data from the pages\n\nFormat as CSV:\n```csv\nSource URL,Job Title,Location,Min Salary USD,Max Salary USD,Currency,Date Found\nhttps://...,Scala Developer,Buenos Aires,...\n```\nCRITICAL: Use REAL data from actual websites. Include source URLs.',
      status: 'pending',
      result: null,
    },
    {
      name: 'linkedin_jobs',
      prompt: 'Use the Playwright browser to find Scala job postings:\n1. Navigate to google.com\n2. Search for "Scala developer jobs LATAM site:linkedin.com OR site:getonbrd.com"\n3. Click into 2-3 result pages and extract job details\n\nFormat as CSV:\n```csv\nSource URL,Job Title,Company,Location,Seniority,Posted Date,Key Skills\nhttps://...,Senior Scala Engineer,CompanyName,Buenos Aires,...\n```\nCRITICAL: Only real data from real pages with source URLs.',
      status: 'pending',
      result: null,
    },
    {
      name: 'market_size',
      prompt: 'Use the Playwright browser to research Scala job market:\n1. Navigate to google.com\n2. Search for "Scala developers demand LATAM 2025 2026 statistics"\n3. Read results and extract factual statistics\n\nFormat as CSV:\n```csv\nSource URL,Metric,Value,Region,Date\nhttps://...,Number of Scala job postings,1234,Argentina,2025\n```\nCRITICAL: Only statistics from real pages with source URLs.',
      status: 'pending',
      result: null,
    },
    {
      name: 'company_hiring',
      prompt: 'Use the Playwright browser to find companies hiring Scala developers:\n1. Navigate to google.com\n2. Search for "companies hiring Scala developers Argentina Brazil 2025 2026"\n3. Extract company names and details from search results\n\nFormat as CSV:\n```csv\nSource URL,Company,Location,Role,Industry\nhttps://...,MercadoLibre,Buenos Aires,Senior Scala Engineer,E-commerce\n```\nCRITICAL: Only real companies from real pages with source URLs.',
      status: 'pending',
      result: null,
    },
    {
      name: 'scala_engineers_profiles',
      prompt: 'Use the Playwright browser to find individual Scala engineers in LATAM:\n1. Navigate to google.com\n2. Search for "Scala engineer Argentina LinkedIn profile"\n3. Also search for "Scala developer Brazil profile github"\n4. Extract names and details from search results (NOT from LinkedIn pages directly — from Google snippets)\n\nFormat as CSV:\n```csv\nSource URL,Name,Location,Title,Company,Skills Found\nhttps://...,Juan Perez,Buenos Aires,Senior Scala Engineer,MercadoLibre,"Scala Akka Spark"\n```\nCRITICAL: Only real names from real search results. Include source URLs.',
      status: 'pending',
      result: null,
    },
    {
      name: 'scala_companies_latam',
      prompt: 'Use the Playwright browser to find companies USING Scala in LATAM (not just hiring):\n1. Navigate to google.com\n2. Search for "companies using Scala Latin America tech stack"\n3. Also search for "Scala case study Argentina Brazil"\n4. Extract company details\n\nFormat as CSV:\n```csv\nSource URL,Company,Country,Use Case,Tech Stack,Team Size Estimate\nhttps://...,MercadoLibre,Argentina,Payment processing,"Scala Akka Kafka",200+\n```\nCRITICAL: Only real companies with real source URLs.',
      status: 'pending',
      result: null,
    },
    {
      name: 'scala_meetups_communities',
      prompt: 'Use the Playwright browser to find Scala communities in LATAM:\n1. Navigate to google.com\n2. Search for "Scala meetup Argentina Brazil Colombia"\n3. Also search for "Scala user group Latin America"\n4. Extract community details\n\nFormat as CSV:\n```csv\nSource URL,Community,Location,Platform,Members,Last Active\nhttps://...,Scala Buenos Aires,Argentina,Meetup.com,450,2026\n```\nCRITICAL: Only real communities from real pages with source URLs.',
      status: 'pending',
      result: null,
    },
  ],
  results: {},
  createdAt: new Date().toISOString(),
};

// Create/update task in Firebase
console.log(`\n📋 Task: ${TASK_ID}`);
console.log(`Goal: ${TASK.goal}\n`);

try {
  // Check if task already exists
  const existing = JSON.parse(execSync(
    `curl -sf "${FIREBASE_URL}/${TASKS_PATH}/${TASK_ID}/status.json"`,
    { encoding: 'utf8', timeout: 5000 }
  ));
  if (existing && existing !== 'completed' && !report) {
    console.log(`Task exists (status: ${existing}). Resuming...\n`);
    // Reset steps for next iteration
    execSync(
      `curl -sf -X PATCH "${FIREBASE_URL}/${TASKS_PATH}/${TASK_ID}.json" -H "Content-Type: application/json" -d '{"currentStep":0,"status":"pending"}'`,
      { timeout: 5000, stdio: 'pipe' }
    );
  }
} catch (e) {
  // Task doesn't exist — create it
  console.log('Creating task in Firebase...');
  execSync(
    `curl -sf -X PUT "${FIREBASE_URL}/${TASKS_PATH}/${TASK_ID}.json" -H "Content-Type: application/json" -d '${JSON.stringify(TASK).replace(/'/g, "'\\''")}'`,
    { timeout: 5000, stdio: 'pipe' }
  );
  console.log('Task created.\n');
}

// Run the task-runner (the core primitive)
const flag = report ? '--report' : '';
const cmd = `${REPO}/scripts/task-runner.sh ${TASK_ID} ${flag}`;
console.log(`Running: task-runner.sh ${TASK_ID} ${flag}\n`);

try {
  execSync(cmd, { stdio: 'inherit', timeout: 600000 });
} catch (e) {
  console.error('Task runner error:', e.message);
}
