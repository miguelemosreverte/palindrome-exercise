#!/usr/bin/env node
/**
 * HR Talent Search workflow integration test.
 * Demonstrates: Browse web → collect candidate data → CSV → ChartJS visualizations.
 *
 * Usage:
 *   node tests/e2e-hr-workflow.js                  # run all (uses cache)
 *   node tests/e2e-hr-workflow.js --rebuild         # re-run all live
 *   node tests/e2e-hr-workflow.js talent_research   # run one category
 *   node tests/e2e-hr-workflow.js data_to_chart     # run one category
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'hr-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const MCP_CONFIG = path.join(__dirname, '..', '.mcp-playwright.json');
if (!fs.existsSync(MCP_CONFIG)) {
  fs.writeFileSync(MCP_CONFIG, JSON.stringify({
    mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }
  }, null, 2));
}

// Format instruction appended to every prompt
const FORMAT_RULES = `

CRITICAL FORMAT RULES:
- You MUST output rich component blocks using triple backticks with the component name
- Example: \`\`\`chartjs followed by a newline, then a JSON object, then \`\`\` to close
- The JSON must be valid and parseable
- For CSV output, use \`\`\`code blocks with language "csv"
- For table output, use \`\`\`table blocks with JSON format
- Do NOT add any text before or after the block unless the test asks for multiple blocks.`;

function askClaude(prompt, timeoutSec) {
  const fullPrompt = prompt + FORMAT_RULES;
  try {
    const result = execSync(
      `claude --mcp-config ${MCP_CONFIG} --model haiku --output-format text --dangerously-skip-permissions -p -`,
      { input: fullPrompt, timeout: (timeoutSec || 240) * 1000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
    ).trim();
    return result;
  } catch (e) {
    return (e.stdout || '').trim();
  }
}

function extractBlock(text, lang) {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```');
  const m = re.exec(text);
  if (m) return m[1].trim();
  // Fallback: find any JSON object/array in the text
  const jsonRe = /(\{[\s\S]*\}|\[[\s\S]*\])/;
  const jm = jsonRe.exec(text);
  if (jm) { try { JSON.parse(jm[1]); return jm[1]; } catch(e) {} }
  return null;
}

function tryParse(json) {
  try { return { ok: true, data: JSON.parse(json) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function hasRealData(text) {
  return text.length > 20 && !/I cannot|I can't|I don't have|error|403|forbidden/i.test(text);
}

const TESTS = {
  talent_research: [
    {
      name: 'scala_latam_search',
      prompt: 'Use the Playwright browser to go to google.com and search for "Scala developers LATAM Argentina hiring 2026". Read the search results. Create a CSV-formatted text block with columns: Source, Role, Location, Skills, Seniority. Include at least 5 rows based on what you find. Output the CSV inside a ```code block: {"language":"csv","title":"Scala Talent LATAM","code":"Source,Role,Location,Skills,Seniority\\n..."}',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data (blocked or error)';
        // Check for CSV-like content: commas, multiple lines, real data indicators
        if (/Source.*Role.*Location/i.test(text) || /csv/i.test(text)) {
          // Check for real data: URLs, company names, locations
          if (/Argentina|Buenos Aires|LATAM|Brazil|Colombia/i.test(text) &&
              /Scala|developer|engineer/i.test(text)) return null;
        }
        // Fallback: any structured data with real content
        if (/\.(com|org|io)/i.test(text) && /Scala/i.test(text)) return null;
        return 'No CSV data with real talent info found';
      },
    },
    {
      name: 'salary_research',
      prompt: 'Use the Playwright browser to go to google.com and search for "Scala developer salary Argentina 2026 USD". Read the results. Output a ```table block with: {"headers":["Seniority","Salary Range (USD)","Source"],"rows":[["Junior","$XX-$XX","source"],["Mid","..."],["Senior","..."],["Lead","..."]]}',
      validate: (text) => {
        if (!hasRealData(text)) return 'No real data';
        // Check for salary data
        if (/\$[\d,]+/.test(text) && /Junior|Senior|Mid|Lead/i.test(text)) return null;
        const block = extractBlock(text, 'table');
        if (block) {
          const p = tryParse(block);
          if (p.ok && p.data.rows && p.data.rows.length >= 3) return null;
        }
        return 'No salary data found';
      },
    },
  ],
  data_to_chart: [
    {
      name: 'talent_distribution_chart',
      prompt: 'Given this talent distribution data for LATAM Scala developers:\n- Argentina: 45%\n- Brazil: 25%\n- Colombia: 15%\n- Chile: 10%\n- Other: 5%\n\nGenerate a ```chartjs pie chart showing this distribution. Use nice colors. Output ONLY the ```chartjs block.',
      validate: (text) => {
        const block = extractBlock(text, 'chartjs');
        if (!block) return 'No ```chartjs block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON in chartjs block: ' + p.error;
        if (!/pie|doughnut/i.test(block)) return 'Chart type is not pie/doughnut';
        if (!/Argentina/i.test(block)) return 'Missing Argentina data';
        return null;
      },
    },
    {
      name: 'salary_comparison_chart',
      prompt: 'Given these average Scala developer salaries by seniority in Argentina:\n- Junior: $25,000/yr\n- Mid: $45,000/yr\n- Senior: $70,000/yr\n- Lead: $95,000/yr\n- Architect: $120,000/yr\n\nGenerate a ```chartjs bar chart showing salaries by level. Use a blue gradient. Output ONLY the ```chartjs block.',
      validate: (text) => {
        const block = extractBlock(text, 'chartjs');
        if (!block) return 'No ```chartjs block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON in chartjs block: ' + p.error;
        if (!/bar/i.test(block)) return 'Chart type is not bar';
        if (!/Junior|Senior/i.test(block)) return 'Missing seniority labels';
        return null;
      },
    },
    {
      name: 'hiring_trend_chart',
      prompt: 'Given these Scala job postings in LATAM by quarter:\n- Q1 2025: 120\n- Q2 2025: 145\n- Q3 2025: 180\n- Q4 2025: 210\n- Q1 2026: 250\n- Q2 2026: 290\n\nGenerate a ```chartjs line chart showing the hiring trend. Include a trend annotation. Output ONLY the ```chartjs block.',
      validate: (text) => {
        const block = extractBlock(text, 'chartjs');
        if (!block) return 'No ```chartjs block found';
        const p = tryParse(block);
        if (!p.ok) return 'Invalid JSON in chartjs block: ' + p.error;
        if (!/line/i.test(block)) return 'Chart type is not line';
        if (!/Q1|Q2|2025|2026/i.test(block)) return 'Missing quarterly labels';
        return null;
      },
    },
  ],
};

// ─── Runner ───
function runTest(cat, test, rebuild) {
  const cacheFile = path.join(CACHE_DIR, `${cat}_${test.name}.json`);
  if (!rebuild && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    process.stdout.write(`  ${test.name} (cached) ... `);
    const err = test.validate(cached.text);
    if (err) { console.log(`\x1b[31m✗ ${err}\x1b[0m`); return false; }
    console.log(`\x1b[32m✓\x1b[0m`);
    return true;
  }
  process.stdout.write(`  ${test.name} (live) ... `);
  const start = Date.now();
  const text = askClaude(test.prompt, 240);
  const sec = ((Date.now() - start) / 1000).toFixed(0);
  if (!text) { console.log(`\x1b[31m✗ Empty (${sec}s)\x1b[0m`); return false; }
  fs.writeFileSync(cacheFile, JSON.stringify({ prompt: test.prompt, text, date: new Date().toISOString() }, null, 2));
  const err = test.validate(text);
  if (err) { console.log(`\x1b[31m✗ ${err} (${sec}s)\x1b[0m`); return false; }
  console.log(`\x1b[32m✓\x1b[0m (${sec}s)`);
  return true;
}

// ─── Main ───
const args = process.argv.slice(2);
const rebuild = args.includes('--rebuild');
const filter = args.find(a => a !== '--rebuild');

console.log('\n👥 HR Talent Search Workflow — Integration Tests\n');
console.log(`Pipeline: Browse Web → Collect Data → CSV → ChartJS Visualizations`);
console.log(`Engine: Claude CLI + Playwright MCP (headed browser)`);
console.log(`Mode: ${rebuild ? 'LIVE' : 'cached (--rebuild for live)'}\n`);

let pass = 0, fail = 0;
for (const cat of (filter ? [filter] : Object.keys(TESTS))) {
  if (!TESTS[cat]) { console.log(`Unknown: ${cat}`); continue; }
  console.log(`📂 ${cat}`);
  for (const test of TESTS[cat]) {
    if (runTest(cat, test, rebuild)) pass++; else fail++;
  }
  console.log();
}
console.log(`${'─'.repeat(50)}`);
console.log(`${pass} passed, ${fail} failed, ${pass + fail} total\n`);
process.exit(fail > 0 ? 1 : 0);
