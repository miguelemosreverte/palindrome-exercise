#!/usr/bin/env node
/**
 * Filter playground — automated testing of the skill tree + faceted filters.
 * Clicks through every combination, screenshots, verifies counts.
 *
 * Usage: node tests/playground-filters.js [--fix]
 *   --fix: also attempt to fix issues found
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT = join(ROOT, 'output', 'ar-senior-devs-linkedin', 'index.html');
const SS_DIR = join(__dirname, 'filter-screenshots');
mkdirSync(SS_DIR, { recursive: true });

let step = 0;
const issues = [];

async function ss(page, label) {
  step++;
  const path = join(SS_DIR, `${String(step).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path });
  return path;
}

async function getTableCount(page) {
  return page.evaluate(() => {
    const info = document.querySelector('.pag-info');
    if (!info) return -1;
    const match = info.textContent.match(/(\d+)\s+results/);
    return match ? parseInt(match[1]) : -1;
  });
}

async function getActiveFilters(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('.filter-chip')].map(c => c.textContent.replace('×', '').trim());
  });
}

async function getParentPills(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('.facet-tag-parent')].map(btn => ({
      name: btn.dataset.group,
      count: parseInt(btn.querySelector('small')?.textContent || '0'),
      active: btn.classList.contains('active'),
      expanded: btn.classList.contains('expanded'),
    }));
  });
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('file://' + REPORT);
  await page.waitForTimeout(2000);

  console.log('\n  ╔═══════════════════════════════════════╗');
  console.log('  ║   Filter Playground — Automated Test  ║');
  console.log('  ╚═══════════════════════════════════════╝\n');

  // ── Test 1: Initial state ──
  await page.evaluate(() => document.querySelector('.facet-tags')?.scrollIntoView());
  await page.waitForTimeout(300);
  const initialCount = await getTableCount(page);
  const pills = await getParentPills(page);
  console.log(`  Initial: ${initialCount} results, ${pills.length} parent pills`);
  pills.forEach(p => console.log(`    ${p.name} (${p.count})${p.active ? ' ACTIVE' : ''}${p.expanded ? ' EXPANDED' : ''}`));
  await ss(page, 'initial');

  if (pills.some(p => p.active || p.expanded)) {
    issues.push('ISSUE: Some pills are active/expanded on load');
  }

  // ── Test 2: Click each parent, verify filter + count ──
  for (const pill of pills) {
    console.log(`\n  Click: ${pill.name} (${pill.count})`);
    await page.click(`.facet-tag-parent[data-group="${pill.name}"]`);
    await page.waitForTimeout(300);

    const count = await getTableCount(page);
    const filters = await getActiveFilters(page);
    const state = await getParentPills(page);
    const thisPill = state.find(p => p.name === pill.name);

    console.log(`    Table: ${count} results, Active filters: [${filters.join(', ')}]`);
    console.log(`    Pill state: active=${thisPill?.active}, expanded=${thisPill?.expanded}`);

    if (count <= 0) issues.push(`ISSUE: ${pill.name} click → ${count} results`);
    if (!thisPill?.active) issues.push(`ISSUE: ${pill.name} not active after click`);
    if (!thisPill?.expanded) issues.push(`ISSUE: ${pill.name} not expanded after click`);

    await ss(page, `click-${pill.name}`);

    // Click again to toggle off
    await page.click(`.facet-tag-parent[data-group="${pill.name}"]`);
    await page.waitForTimeout(300);

    const countAfter = await getTableCount(page);
    const filtersAfter = await getActiveFilters(page);
    const stateAfter = await getParentPills(page);
    const pillAfter = stateAfter.find(p => p.name === pill.name);

    console.log(`    After toggle off: ${countAfter} results, filters: [${filtersAfter.join(', ')}]`);

    if (countAfter !== initialCount) {
      issues.push(`ISSUE: Toggle off ${pill.name} → ${countAfter} results (expected ${initialCount})`);
    }
    if (pillAfter?.active) {
      issues.push(`ISSUE: ${pill.name} still active after toggle off`);
    }
    if (filtersAfter.length > 0) {
      issues.push(`ISSUE: Filters remain after toggle off ${pill.name}: [${filtersAfter.join(', ')}]`);
    }

    await ss(page, `toggle-off-${pill.name}`);
  }

  // ── Test 3: Click parent, click child, then collapse parent ──
  console.log('\n  ── Test: Parent → Child → Collapse ──');
  const firstParent = pills[0];
  console.log(`  Click parent: ${firstParent.name}`);
  await page.click(`.facet-tag-parent[data-group="${firstParent.name}"]`);
  await page.waitForTimeout(300);

  // Find a child tag
  const childTags = await page.evaluate(() => {
    return [...document.querySelectorAll('.facet-tag-child[data-facet="tech_stack"]')]
      .filter(b => b.offsetParent !== null) // visible
      .map(b => ({ value: b.dataset.value, count: b.dataset.count }));
  });

  if (childTags.length > 0) {
    console.log(`  Click child: ${childTags[0].value}`);
    await page.click(`.facet-tag-child[data-value="${childTags[0].value}"]`);
    await page.waitForTimeout(300);

    const countWithChild = await getTableCount(page);
    const filtersWithChild = await getActiveFilters(page);
    console.log(`    With child filter: ${countWithChild} results, filters: [${filtersWithChild.join(', ')}]`);
    await ss(page, 'parent-child-active');

    // Now collapse the parent
    console.log(`  Collapse parent: ${firstParent.name}`);
    await page.click(`.facet-tag-parent[data-group="${firstParent.name}"]`);
    await page.waitForTimeout(300);

    const countAfterCollapse = await getTableCount(page);
    const filtersAfterCollapse = await getActiveFilters(page);
    const childStillActive = await page.evaluate((val) => {
      const btn = document.querySelector(`.facet-tag-child[data-value="${val}"]`);
      return btn?.classList.contains('active');
    }, childTags[0].value);

    console.log(`    After collapse: ${countAfterCollapse} results, filters: [${filtersAfterCollapse.join(', ')}]`);
    console.log(`    Child still active? ${childStillActive}`);

    if (childStillActive) {
      issues.push(`ISSUE: Child "${childTags[0].value}" still active after parent collapse`);
    }
    if (filtersAfterCollapse.some(f => f.includes('tech_stack'))) {
      issues.push(`ISSUE: tech_stack filters remain after collapse`);
    }

    await ss(page, 'after-collapse');
  }

  // ── Test 4: Clear all ──
  console.log('\n  ── Test: Clear All ──');
  // Click a couple things first
  await page.click(`.facet-tag-parent[data-group="${pills[0].name}"]`);
  await page.waitForTimeout(200);
  await page.selectOption('.facet-select[data-facet="domain"]', { index: 1 });
  await page.waitForTimeout(200);

  const beforeClear = await getActiveFilters(page);
  console.log(`  Before clear: filters [${beforeClear.join(', ')}]`);

  await page.click('#facet-clear');
  await page.waitForTimeout(300);

  const afterClear = await getTableCount(page);
  const filtersAfterClear = await getActiveFilters(page);
  const pillsAfterClear = await getParentPills(page);

  console.log(`  After clear: ${afterClear} results, filters: [${filtersAfterClear.join(', ')}]`);
  if (afterClear !== initialCount) {
    issues.push(`ISSUE: Clear all → ${afterClear} results (expected ${initialCount})`);
  }
  if (filtersAfterClear.length > 0) {
    issues.push(`ISSUE: Filters remain after Clear All: [${filtersAfterClear.join(', ')}]`);
  }
  if (pillsAfterClear.some(p => p.active)) {
    issues.push(`ISSUE: Pills still active after Clear All: [${pillsAfterClear.filter(p => p.active).map(p => p.name)}]`);
  }

  await ss(page, 'after-clear');

  // ── Test 5: Dropdown filter + tree count update ──
  console.log('\n  ── Test: Dropdown → Tree Count Update ──');
  const domainSelect = await page.$('.facet-select[data-facet="domain"]');
  if (domainSelect) {
    const options = await page.evaluate(() => {
      const sel = document.querySelector('.facet-select[data-facet="domain"]');
      return [...sel.options].filter(o => o.value).map(o => ({ value: o.value, text: o.textContent }));
    });

    for (const opt of options.slice(0, 3)) {
      await page.selectOption('.facet-select[data-facet="domain"]', opt.value);
      await page.waitForTimeout(300);
      const count = await getTableCount(page);
      const treeCounts = await getParentPills(page);
      console.log(`  Domain "${opt.value}": ${count} results`);
      treeCounts.forEach(p => console.log(`    ${p.name}: ${p.count}`));
      await ss(page, `domain-${opt.value}`);
    }

    // Reset
    await page.selectOption('.facet-select[data-facet="domain"]', '');
    await page.waitForTimeout(200);
  }

  // ── Summary ──
  await browser.close();

  console.log('\n  ════════════════════════════════════════');
  if (issues.length === 0) {
    console.log('  ✓ All filter tests passed!');
  } else {
    console.log(`  ✗ ${issues.length} issues found:\n`);
    issues.forEach(i => console.log(`    ${i}`));
  }
  console.log(`\n  Screenshots saved to: tests/filter-screenshots/\n`);

  return issues;
}

const result = await run();
process.exit(result.length > 0 ? 1 : 0);
