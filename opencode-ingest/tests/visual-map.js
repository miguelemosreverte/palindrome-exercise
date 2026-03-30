#!/usr/bin/env node
/**
 * Visual test for the Leaflet map component.
 * Takes screenshots at 3 viewports (desktop, tablet, phone).
 *
 * Usage: node tests/visual-map.js
 * Output: tests/map-screenshots/
 *
 * Prerequisites: the report must exist at output/ar-senior-devs-linkedin/index.html
 *   Generate it with: node bin/ingest.js report ar-senior-devs-linkedin
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SS_DIR = join(__dirname, 'map-screenshots');
mkdirSync(SS_DIR, { recursive: true });

const REPORT_PATH = join(__dirname, '..', 'output', 'ar-senior-devs-linkedin', 'index.html');

if (!existsSync(REPORT_PATH)) {
  console.error('Report not found at:', REPORT_PATH);
  console.error('Generate it first: node bin/ingest.js report ar-senior-devs-linkedin');
  process.exit(1);
}

const viewports = [
  { name: 'desktop', width: 1200, height: 900 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'phone',   width: 375,  height: 812 },
];

const browser = await chromium.launch();

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto('file://' + REPORT_PATH);

  // Wait for map tiles to load
  await page.waitForSelector('#data-map', { timeout: 10000 });
  await page.waitForTimeout(3000); // tiles + cluster animation

  // Scroll to map section
  await page.evaluate(() => {
    const mapEl = document.getElementById('data-map');
    if (mapEl) mapEl.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(500);

  // Screenshot: map area
  const mapBox = await page.locator('.map-section').boundingBox();
  if (mapBox) {
    await page.screenshot({
      path: join(SS_DIR, `map-${vp.name}.png`),
      clip: {
        x: Math.max(0, mapBox.x - 10),
        y: Math.max(0, mapBox.y - 10),
        width: Math.min(mapBox.width + 20, vp.width),
        height: Math.min(mapBox.height + 20, vp.height),
      },
    });
  } else {
    // Fallback: full page
    await page.screenshot({ path: join(SS_DIR, `map-${vp.name}.png`), fullPage: true });
  }
  console.log(`  OK ${vp.name} (${vp.width}x${vp.height})`);

  // Test filter integration: select a city and check map updates
  if (vp.name === 'desktop') {
    const citySelect = page.locator('.facet-select[data-facet="city"]');
    if (await citySelect.count() > 0) {
      // Select first non-empty option
      const options = await citySelect.locator('option').allTextContents();
      const firstCity = options.find(o => o !== 'All Cities' && !o.startsWith('All'));
      if (firstCity) {
        await citySelect.selectOption({ label: firstCity });
        await page.waitForTimeout(1500); // map zoom animation

        await page.evaluate(() => {
          const mapEl = document.getElementById('data-map');
          if (mapEl) mapEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        });
        await page.waitForTimeout(500);

        const filteredBox = await page.locator('.map-section').boundingBox();
        if (filteredBox) {
          await page.screenshot({
            path: join(SS_DIR, `map-filtered.png`),
            clip: {
              x: Math.max(0, filteredBox.x - 10),
              y: Math.max(0, filteredBox.y - 10),
              width: Math.min(filteredBox.width + 20, vp.width),
              height: Math.min(filteredBox.height + 20, vp.height),
            },
          });
        }
        console.log(`  OK filtered (city: ${firstCity.trim()})`);
      }
    }
  }

  await page.close();
}

await browser.close();
console.log(`\nScreenshots saved to: tests/map-screenshots/`);
