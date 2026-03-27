#!/usr/bin/env node
/**
 * Benchmark: HR Scala LATAM Research Pipeline
 *
 * Creates an HR research task, executes it via the task runner,
 * measures time per step, and saves a benchmark report.
 *
 * Usage:
 *   node tests/benchmark-hr.js              # run benchmark
 *   node tests/benchmark-hr.js --compare    # show comparison with last run
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BENCHMARKS_DIR = path.join(__dirname, 'benchmarks');
const FIREBASE_URL = 'https://signaling-dcfad-default-rtdb.europe-west1.firebasedatabase.app';
const TASKS_PATH = 'mercadopago-bridge/bridge-tasks';
const BRIDGE_API = 'https://palindrome-exercise.vercel.app';
const REPO_DIR = path.join(__dirname, '..');
const MCP_CONFIG = path.join(REPO_DIR, '.mcp-playwright.json');

if (!fs.existsSync(BENCHMARKS_DIR)) fs.mkdirSync(BENCHMARKS_DIR, { recursive: true });

// --- Firebase helpers ---

function fbRead(fbPath) {
  try {
    var out = execSync(`curl -sf "${FIREBASE_URL}/${fbPath}.json"`, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch { return null; }
}

function fbWrite(fbPath, data) {
  execSync(`curl -sf -X PUT "${FIREBASE_URL}/${fbPath}.json" -H "Content-Type: application/json" -d '${JSON.stringify(data).replace(/'/g, "'\\''")}'`, { timeout: 15000 });
}

function fbPatch(fbPath, data) {
  execSync(`curl -sf -X PATCH "${FIREBASE_URL}/${fbPath}.json" -H "Content-Type: application/json" -d '${JSON.stringify(data).replace(/'/g, "'\\''")}'`, { timeout: 15000 });
}

// --- Claude CLI execution ---

function askClaude(prompt, timeoutSec) {
  try {
    var result = execSync(
      `claude --mcp-config ${MCP_CONFIG} --model haiku --output-format text --dangerously-skip-permissions -p -`,
      { input: prompt, timeout: (timeoutSec || 300) * 1000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
    ).trim();
    return result;
  } catch (e) {
    return (e.stdout || '').trim();
  }
}

// --- Template expansion ---

function expandTemplate(template, results) {
  return template.replace(/\{\{results\.(\w+)\}\}/g, function (_, key) {
    return (results[key] || '').toString().substring(0, 4000);
  });
}

// --- Get previous benchmarks ---

function getPreviousBenchmarks() {
  if (!fs.existsSync(BENCHMARKS_DIR)) return [];
  var files = fs.readdirSync(BENCHMARKS_DIR)
    .filter(function (f) { return f.startsWith('hr-research-') && f.endsWith('.json'); })
    .sort()
    .reverse();
  return files.map(function (f) {
    return JSON.parse(fs.readFileSync(path.join(BENCHMARKS_DIR, f), 'utf8'));
  });
}

// --- Comparison mode ---

if (process.argv.includes('--compare')) {
  var benchmarks = getPreviousBenchmarks();
  if (benchmarks.length === 0) {
    console.log('No benchmark results found. Run without --compare first.');
    process.exit(0);
  }
  var latest = benchmarks[0];
  console.log('=== Latest Benchmark ===');
  console.log('Date:', latest.date);
  console.log('Total time:', latest.totalTime, 'seconds');
  console.log('');
  console.log('Steps:');
  latest.steps.forEach(function (s) {
    console.log('  ' + s.name + ': ' + s.time + 's | ' + s.dataPoints + ' data points | ' + s.status);
  });
  console.log('');
  console.log('Results:', JSON.stringify(latest.results, null, 2));

  if (benchmarks.length > 1) {
    var prev = benchmarks[1];
    var timeChange = ((latest.totalTime - prev.totalTime) / prev.totalTime * 100).toFixed(1);
    var qualityChange = latest.results.dataQuality && prev.results.dataQuality
      ? ((latest.results.dataQuality - prev.results.dataQuality) / prev.results.dataQuality * 100).toFixed(1)
      : 'N/A';
    console.log('');
    console.log('=== Comparison with previous run ===');
    console.log('Previous:', prev.date);
    console.log('Time change:', (timeChange > 0 ? '+' : '') + timeChange + '%');
    console.log('Quality change:', qualityChange === 'N/A' ? qualityChange : (qualityChange > 0 ? '+' : '') + qualityChange + '%');
  }
  process.exit(0);
}

// --- Run benchmark ---

console.log('=== HR Scala LATAM Research Benchmark ===');
console.log('');

var steps = [
  { name: 'search', prompt: 'Use Playwright browser to go to google.com and search for "Scala developers LATAM LinkedIn GitHub". Read the first 5 results. Format as: Source, Title, URL, Summary (one line each).' },
  { name: 'collect', prompt: 'From the search results in {{results.search}}, extract candidate names, locations, skills, and profile URLs. Format as a structured list.' },
  { name: 'enrich', prompt: 'For each candidate in {{results.collect}}, search for more details about their experience and projects. Add years of experience and notable projects.' },
  { name: 'csv', prompt: 'Take this data:\n{{results.enrich}}\n\nFormat as CSV with headers: Name,Location,Skills,Experience,Projects,Source. Output ONLY the CSV text, no markdown.' },
  { name: 'chart', prompt: 'Given this CSV data:\n{{results.csv}}\n\nGenerate a ```chartjs bar chart showing candidates by experience years. Output ONLY the chartjs block.' },
];

var results = {};
var stepReports = [];
var totalStart = Date.now();

// Create task in Firebase for tracking
var taskId = 'bench-' + Date.now();
var taskData = {
  goal: 'Benchmark: Find Scala developers in LATAM',
  sessionId: 'benchmark',
  status: 'running',
  currentStep: 0,
  steps: steps.map(function (s) { return { name: s.name, prompt: s.prompt, status: 'pending', result: null }; }),
  results: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
fbWrite(TASKS_PATH + '/' + taskId, taskData);

for (var i = 0; i < steps.length; i++) {
  var step = steps[i];
  var expandedPrompt = expandTemplate(step.prompt, results);

  console.log('Step ' + (i + 1) + '/' + steps.length + ': ' + step.name);
  var stepStart = Date.now();

  var result = askClaude(expandedPrompt, 300);
  var stepTime = Math.round((Date.now() - stepStart) / 1000);

  results[step.name] = result;

  // Count data points (lines with actual content)
  var dataPoints = result.split('\n').filter(function (l) { return l.trim().length > 10; }).length;

  var stepStatus = result.length > 50 ? 'pass' : 'fail';
  stepReports.push({
    name: step.name,
    time: stepTime,
    tokensUsed: Math.round(result.length * 0.75), // rough estimate
    dataPoints: dataPoints,
    status: stepStatus,
  });

  // Persist to Firebase
  fbPatch(TASKS_PATH + '/' + taskId + '/steps/' + i, { status: stepStatus === 'pass' ? 'completed' : 'failed', result: result });
  fbPatch(TASKS_PATH + '/' + taskId + '/results', JSON.parse('{"' + step.name + '":' + JSON.stringify(result) + '}'));
  fbPatch(TASKS_PATH + '/' + taskId, { currentStep: i + 1, updatedAt: new Date().toISOString() });

  console.log('  ' + stepTime + 's | ' + dataPoints + ' data points | ' + stepStatus);
}

var totalTime = Math.round((Date.now() - totalStart) / 1000);

// Mark task complete
fbPatch(TASKS_PATH + '/' + taskId, { status: 'completed', updatedAt: new Date().toISOString() });

// Analyze results quality
var csvResult = results.csv || '';
var candidateLines = csvResult.split('\n').filter(function (l) { return l.trim().length > 10 && !l.startsWith('Name'); });
var candidatesFound = candidateLines.length;
var countries = {};
candidateLines.forEach(function (line) {
  var parts = line.split(',');
  if (parts[1]) countries[parts[1].trim()] = true;
});
var countriesCovered = Object.keys(countries).length;
var passingSteps = stepReports.filter(function (s) { return s.status === 'pass'; }).length;
var dataQuality = parseFloat((passingSteps / steps.length).toFixed(2));

// Build report
var report = {
  task: 'HR Scala LATAM Research',
  date: new Date().toISOString(),
  taskId: taskId,
  totalTime: totalTime,
  steps: stepReports,
  results: {
    candidatesFound: candidatesFound,
    countriesCovered: countriesCovered,
    dataQuality: dataQuality,
  },
};

// Compare with previous
var previous = getPreviousBenchmarks();
if (previous.length > 0) {
  var prev = previous[0];
  var timeChange = ((totalTime - prev.totalTime) / prev.totalTime * 100).toFixed(1);
  var qualityChange = prev.results.dataQuality
    ? ((dataQuality - prev.results.dataQuality) / prev.results.dataQuality * 100).toFixed(1)
    : null;
  report.comparison = {
    previousRun: prev.date,
    timeChange: (timeChange > 0 ? '+' : '') + timeChange + '%',
    qualityChange: qualityChange !== null ? (qualityChange > 0 ? '+' : '') + qualityChange + '%' : 'N/A',
  };
}

// Save report
var dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
var reportPath = path.join(BENCHMARKS_DIR, 'hr-research-' + dateStr + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log('');
console.log('=== Benchmark Complete ===');
console.log('Total time: ' + totalTime + 's');
console.log('Candidates found: ' + candidatesFound);
console.log('Countries covered: ' + countriesCovered);
console.log('Data quality: ' + dataQuality);
console.log('Report saved: ' + reportPath);

if (report.comparison) {
  console.log('');
  console.log('vs previous: time ' + report.comparison.timeChange + ', quality ' + report.comparison.qualityChange);
}
