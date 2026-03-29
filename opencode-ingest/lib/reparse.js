import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { vendorForTask } from './clean.js';

const ROOT = new URL('..', import.meta.url).pathname;

/** Load vendor parser module */
async function loadParser(taskName) {
  const vendor = vendorForTask(taskName);
  if (!vendor) return null;
  try {
    return await import(`../vendors/${vendor}/parse.js`);
  } catch {
    return null;
  }
}

/**
 * Re-parse all saved HTML files for a task → regenerate JSONL.
 * Delegates to the vendor's parser module.
 */
export async function reparseTask(taskName) {
  const dataDir = join(ROOT, 'data', taskName);
  const htmlDir = join(dataDir, 'html');
  const rawDir = join(dataDir, 'raw');

  if (!existsSync(htmlDir)) {
    console.log(`[${taskName}] No HTML directory — nothing to reparse`);
    return 0;
  }

  const parser = await loadParser(taskName);
  if (!parser) {
    console.log(`[${taskName}] No parser found for vendor`);
    return 0;
  }

  const htmlFiles = readdirSync(htmlDir).filter(f => f.endsWith('.html')).sort();
  if (htmlFiles.length === 0) {
    console.log(`[${taskName}] No HTML files found`);
    return 0;
  }

  mkdirSync(rawDir, { recursive: true });
  const vendor = vendorForTask(taskName);

  if (vendor === 'linkedin') {
    return reparseLinkedIn(taskName, dataDir, htmlDir, rawDir, htmlFiles, parser);
  } else {
    return reparsePerPage(taskName, dataDir, htmlDir, rawDir, htmlFiles, parser);
  }
}

/** For page-based vendors (MercadoLibre, YouTube, GitHub): each HTML = one search page */
function reparsePerPage(taskName, dataDir, htmlDir, rawDir, htmlFiles, parser) {
  // Group by iteration prefix
  const byIter = {};
  for (const f of htmlFiles) {
    const iterMatch = f.match(/^(\d+)/);
    const iter = iterMatch ? iterMatch[1] : '001';
    if (!byIter[iter]) byIter[iter] = [];
    byIter[iter].push(f);
  }

  let totalRecords = 0;
  for (const [iter, files] of Object.entries(byIter).sort()) {
    const allRecords = [];
    for (const f of files) {
      const html = readFileSync(join(htmlDir, f), 'utf8');
      const records = parser.parsePage(html, f);
      allRecords.push(...records);
    }

    // Deduplicate by URL
    const seen = new Set();
    const unique = allRecords.filter(r => {
      const key = r.url || r.title || JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const rawFile = join(rawDir, `${iter}.jsonl`);
    writeFileSync(rawFile, unique.map(r => JSON.stringify(r)).join('\n') + '\n');
    totalRecords += unique.length;
    console.log(`[${taskName}] Iter ${iter}: reparsed ${unique.length} records from ${files.length} HTML files`);
  }

  updateMeta(dataDir, totalRecords);
  console.log(`[${taskName}] Total: ${totalRecords} records from ${htmlFiles.length} HTML files`);
  return totalRecords;
}

/** For LinkedIn: each HTML file is one profile page */
function reparseLinkedIn(taskName, dataDir, htmlDir, rawDir, htmlFiles, parser) {
  const readFile = (f) => readFileSync(join(htmlDir, f), 'utf8');
  const records = parser.parseAll(htmlFiles, readFile);

  // Write as single JSONL
  const rawFile = join(rawDir, '001.jsonl');
  writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

  // Clean up extra raw files
  for (const f of readdirSync(rawDir).filter(x => x !== '001.jsonl' && x.endsWith('.jsonl'))) {
    unlinkSync(join(rawDir, f));
  }

  updateMeta(dataDir, records.length);
  console.log(`[${taskName}] Reparsed ${records.length} profiles from ${htmlFiles.filter(f => f.includes('profile')).length} HTML files`);
  return records.length;
}

function updateMeta(dataDir, totalRecords) {
  const metaPath = join(dataDir, 'meta.json');
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.totalRecords = totalRecords;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}
