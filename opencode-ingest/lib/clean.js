import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Resolve vendor from task name */
function vendorForTask(taskName) {
  const name = taskName.toLowerCase();
  if (name.includes('linkedin') || name.includes('devs')) return 'linkedin';
  if (name.includes('mercado')) return 'mercadolibre';
  if (name.includes('youtube') || name.includes('video')) return 'youtube';
  if (name.includes('github')) return 'github';
  return null;
}

/** Load vendor cleaner — returns the clean(record) function */
async function loadCleaner(taskName) {
  const vendor = vendorForTask(taskName);
  if (!vendor) return (r) => r;
  try {
    const mod = await import(`../vendors/${vendor}/clean.js`);
    return mod.clean;
  } catch {
    return (r) => r;
  }
}

/**
 * Clean all raw JSONL files for a task in-place using the vendor's cleaner.
 */
export async function cleanTask(taskName) {
  const dataDir = join(ROOT, 'data', taskName);
  const rawDir = join(dataDir, 'raw');
  const cleaner = await loadCleaner(taskName);

  const files = readdirSync(rawDir).filter(f => f.endsWith('.jsonl')).sort();
  let totalCleaned = 0;

  for (const file of files) {
    const path = join(rawDir, file);
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(l => l && !l.startsWith('//'));
    const cleaned = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        cleaned.push(JSON.stringify(cleaner(record)));
        totalCleaned++;
      } catch {
        cleaned.push(line);
      }
    }

    writeFileSync(path, cleaned.join('\n') + '\n');
  }

  console.log(`[${taskName}] Cleaned ${totalCleaned} records across ${files.length} files`);
  return totalCleaned;
}

export { vendorForTask };
