#!/usr/bin/env node
/**
 * Visual test harness for chart components.
 * Renders sample data at multiple viewports, takes screenshots.
 *
 * Usage: node tests/visual-charts.js
 * Output: tests/chart-screenshots/
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { horizontalBar, tagCloud, chartRow, CHARTS_CSS } from '../bin/charts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SS_DIR = join(__dirname, 'chart-screenshots');
mkdirSync(SS_DIR, { recursive: true });

// Sample data
const domainData = [
  { label: 'Engineering', value: 13, color: '#2c3e50' },
  { label: 'Management', value: 7, color: '#5a7d9a' },
  { label: 'HR', value: 4, color: '#c0392b' },
  { label: 'Data', value: 3, color: '#27ae60' },
  { label: 'Consulting', value: 2, color: '#8e44ad' },
  { label: 'Education', value: 1, color: '#f39c12' },
];

const seniorityData = [
  { label: 'Senior', value: 10, color: '#2c3e50' },
  { label: 'Director', value: 3, color: '#c0392b' },
  { label: 'Manager', value: 3, color: '#5a7d9a' },
  { label: 'Mid', value: 2, color: '#27ae60' },
];

const skillsData = [
  { label: 'Java', value: 8 },
  { label: 'REST APIs', value: 7 },
  { label: 'Docker', value: 7 },
  { label: 'Spring Boot', value: 6 },
  { label: 'SQL', value: 6 },
  { label: 'Git', value: 5 },
  { label: 'Microservices', value: 4 },
  { label: 'Python', value: 3 },
  { label: 'Agile', value: 3 },
  { label: 'Kubernetes', value: 2 },
  { label: 'Machine Learning', value: 2 },
  { label: 'Talent Acquisition', value: 2 },
  { label: 'Go', value: 2 },
  { label: 'React', value: 1 },
  { label: 'Terraform', value: 1 },
];

// Build HTML
const charts = chartRow([
  horizontalBar('Domain', domainData, { id: 'domain-chart' }),
  horizontalBar('Seniority', seniorityData, { id: 'seniority-chart' }),
  tagCloud('Top Skills', skillsData, { id: 'skills-chart' }),
]);

const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #f8f5f0; padding: 1rem; }
  ${CHARTS_CSS}
</style>
</head><body>
<h2 style="font-family:'Playfair Display',serif;margin-bottom:1rem">Chart Components — Visual Test</h2>
${charts}

<h3 style="margin-top:2rem;font-family:'Playfair Display',serif">Filtered state (HR only)</h3>
${chartRow([
  horizontalBar('Domain', [{ label: 'HR', value: 4, color: '#c0392b' }], { id: 'filtered-domain' }),
  horizontalBar('Seniority', [{ label: 'Senior', value: 3, color: '#2c3e50' }, { label: 'Director', value: 1, color: '#c0392b' }], { id: 'filtered-sen' }),
  tagCloud('Skills', [{ label: 'Talent Acquisition', value: 3 }, { label: 'Recruiting', value: 2 }, { label: 'HR Automation', value: 2 }, { label: 'Sourcing', value: 1 }], { id: 'filtered-skills' }),
])}
</body></html>`;

const testPath = join(SS_DIR, 'test.html');
writeFileSync(testPath, html);

// Screenshot at different viewports
const viewports = [
  { name: 'desktop', width: 1200, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 375, height: 812 },
];

const browser = await chromium.launch();
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto('file://' + testPath);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(SS_DIR, `charts-${vp.name}.png`), fullPage: true });
  console.log(`  ✓ ${vp.name} (${vp.width}x${vp.height})`);
  await page.close();
}
await browser.close();

console.log(`\nScreenshots saved to: tests/chart-screenshots/`);
console.log(`HTML test file: ${testPath}`);
