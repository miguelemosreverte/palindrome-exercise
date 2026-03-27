#!/usr/bin/env node
/**
 * Imports cached test/benchmark data into SQLite.
 * Run once to migrate from JSON files to the database.
 */
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const DIRS = [
  { dir: 'tests/hr-cache', collection: 'hr-research' },
  { dir: 'tests/browse-cache', collection: 'web-browse' },
  { dir: 'tests/component-cache', collection: 'components' },
];

let imported = 0;
for (const { dir, collection } of DIRS) {
  const fullDir = path.join(__dirname, '..', dir);
  if (!fs.existsSync(fullDir)) continue;
  for (const file of fs.readdirSync(fullDir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(fullDir, file), 'utf8'));
    const name = file.replace('.json', '');
    db.saveData(null, collection + '/' + name, JSON.stringify(data), 'json');
    imported++;
  }
}

// Import benchmark results
const benchDir = path.join(__dirname, '..', 'tests', 'benchmarks');
if (fs.existsSync(benchDir)) {
  for (const file of fs.readdirSync(benchDir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(benchDir, file), 'utf8'));
    db.saveBenchmark(
      data.task || 'hr-research',
      (data.totalTime || 0) * 1000,
      data.steps || [],
      data.results || {}
    );
    imported++;
  }
}

console.log(`Imported ${imported} records into SQLite at ${db.DB_PATH}`);
console.log('Stats:', db.getStats());
