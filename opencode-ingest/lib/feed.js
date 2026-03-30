/**
 * Feed generator — compares current data snapshot with previous,
 * produces feed items (NEW, PRICE_DROP, CANDIDATE_MATCH, TRENDING, INSIGHT).
 *
 * Usage:
 *   import { generateFeed, loadFeed, saveFeed } from '../lib/feed.js';
 *   const items = await generateFeed('ar-senior-devs-linkedin');
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import initSqlJs from 'sql.js';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const FEED_PATH = join(DATA_DIR, 'feed.json');

// ─── Vendor detection ────────────────────────────────────────────────

function vendorForTask(name) {
  const n = name.toLowerCase();
  if (n.includes('linkedin') || n.includes('devs')) return 'linkedin';
  if (n.includes('mercado')) return 'mercadolibre';
  if (n.includes('youtube') || n.includes('video')) return 'youtube';
  if (n.includes('github')) return 'github';
  return 'generic';
}

// ─── SQLite helpers ──────────────────────────────────────────────────

async function loadRecords(task) {
  const dbPath = join(DATA_DIR, task, 'db.sqlite');
  if (!existsSync(dbPath)) return [];
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const result = db.exec('SELECT * FROM records');
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
  } finally { db.close(); }
}

// ─── Snapshot management ─────────────────────────────────────────────

function snapshotPath(task) {
  return join(DATA_DIR, task, 'snapshot.json');
}

function loadSnapshot(task) {
  const p = snapshotPath(task);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function saveSnapshot(task, records, vendor) {
  const keyField = vendor === 'linkedin' ? 'profileUrl' : 'url';
  const snap = {};
  for (const r of records) {
    const key = r[keyField] || r.url || r.profileUrl || `row-${r._id}`;
    snap[key] = {
      _id: r._id,
      title: r.title || r.name,
      price: r._price_num ?? r.price,
      seniority_score: r.seniority_score,
      rating: r.rating,
      timestamp: new Date().toISOString(),
    };
  }
  writeFileSync(snapshotPath(task), JSON.stringify(snap, null, 2));
  return snap;
}

// ─── Feed storage ────────────────────────────────────────────────────

export function loadFeed() {
  if (!existsSync(FEED_PATH)) return { items: [] };
  return JSON.parse(readFileSync(FEED_PATH, 'utf8'));
}

export function saveFeed(feed) {
  mkdirSync(dirname(FEED_PATH), { recursive: true });
  writeFileSync(FEED_PATH, JSON.stringify(feed, null, 2));
}

function makeItem(type, source, { title, body, url, thumbnail, data }) {
  return {
    id: `feed-${randomUUID().slice(0, 8)}`,
    type,
    source,
    title,
    body: body || '',
    url: url || '',
    thumbnail: thumbnail || '',
    timestamp: new Date().toISOString(),
    read: false,
    dismissed: false,
    data: data || {},
  };
}

// ─── Generators per type ─────────────────────────────────────────────

function detectNew(records, prevSnap, vendor, task) {
  const keyField = vendor === 'linkedin' ? 'profileUrl' : 'url';
  const items = [];
  for (const r of records) {
    const key = r[keyField] || r.url || r.profileUrl || `row-${r._id}`;
    if (!prevSnap[key]) {
      if (vendor === 'linkedin') {
        items.push(makeItem('NEW', task, {
          title: `New profile: ${r.name || r.title}`,
          body: [r.title, r.company, r.location].filter(Boolean).join(' · '),
          url: r.profileUrl || '',
          thumbnail: r.photo || '',
          data: { name: r.name, company: r.company, seniority: r.seniority_level },
        }));
      } else if (vendor === 'mercadolibre') {
        items.push(makeItem('NEW', task, {
          title: `New listing: ${(r.title || '').slice(0, 80)}`,
          body: `${r.price || ''} ${r.shipping || ''}`.trim(),
          url: r.url || '',
          thumbnail: r.image || '',
          data: { price: r._price_num, seller: r.seller },
        }));
      } else if (vendor === 'youtube') {
        items.push(makeItem('NEW', task, {
          title: `New video: ${(r.title || '').slice(0, 80)}`,
          body: [r.channel, r.views].filter(Boolean).join(' · '),
          url: r.url || '',
          thumbnail: r.thumbnail || '',
          data: { channel: r.channel, views: r.views },
        }));
      } else {
        items.push(makeItem('NEW', task, {
          title: `New record: ${(r.title || r.name || '').slice(0, 80)}`,
          body: '',
          url: r.url || '',
        }));
      }
    }
  }
  return items;
}

function detectPriceDrops(records, prevSnap, vendor, task) {
  if (vendor !== 'mercadolibre') return [];
  const items = [];
  for (const r of records) {
    const key = r.url || `row-${r._id}`;
    const prev = prevSnap[key];
    if (!prev || !prev.price || !r._price_num) continue;
    const oldPrice = Number(prev.price);
    const newPrice = Number(r._price_num);
    if (oldPrice > 0 && newPrice > 0 && newPrice < oldPrice) {
      const drop = ((oldPrice - newPrice) / oldPrice) * 100;
      if (drop >= 10) {
        items.push(makeItem('PRICE_DROP', task, {
          title: `Price drop: ${(r.title || '').slice(0, 60)}`,
          body: `Was $${oldPrice.toLocaleString()} -> Now $${newPrice.toLocaleString()} (${Math.round(drop)}% off)`,
          url: r.url || '',
          thumbnail: r.image || '',
          data: { oldPrice, newPrice, dropPercent: Math.round(drop) },
        }));
      }
    }
  }
  return items;
}

function detectCandidateMatches(records, prevSnap, vendor, task) {
  if (vendor !== 'linkedin') return [];
  const items = [];
  for (const r of records) {
    const key = r.profileUrl || `row-${r._id}`;
    if (prevSnap[key]) continue; // only new profiles
    const score = Number(r.seniority_score) || 0;
    if (score >= 75) {
      items.push(makeItem('CANDIDATE_MATCH', task, {
        title: `High-match candidate: ${r.name || r.title}`,
        body: `Score: ${score}% · ${r.seniority_level || ''} · ${r.company || ''}`,
        url: r.profileUrl || '',
        thumbnail: r.photo || '',
        data: { matchScore: score, seniority: r.seniority_level, company: r.company },
      }));
    }
  }
  return items;
}

function generateInsights(records, vendor, task) {
  const items = [];
  if (vendor === 'linkedin' && records.length >= 5) {
    // Most common skills
    const skillCount = {};
    for (const r of records) {
      try {
        const labels = JSON.parse(r.raw_labels || '{}');
        if (labels.labels) {
          for (const l of labels.labels) {
            if (l.confidence >= 0.9) {
              skillCount[l.label] = (skillCount[l.label] || 0) + 1;
            }
          }
        }
      } catch {}
    }
    const sorted = Object.entries(skillCount).sort((a, b) => b[1] - a[1]);
    if (sorted.length >= 3) {
      const top3 = sorted.slice(0, 3).map(([s, c]) => `${s} (${c})`).join(', ');
      items.push(makeItem('INSIGHT', task, {
        title: `Top skills across ${records.length} profiles`,
        body: top3,
        data: { topSkills: sorted.slice(0, 10).map(([label, count]) => ({ label, count })), totalProfiles: records.length },
      }));
    }
    // Seniority distribution
    const senCounts = {};
    for (const r of records) {
      const s = r.seniority_level || 'unknown';
      senCounts[s] = (senCounts[s] || 0) + 1;
    }
    items.push(makeItem('INSIGHT', task, {
      title: `Seniority distribution (${records.length} profiles)`,
      body: Object.entries(senCounts).map(([k, v]) => `${k}: ${v}`).join(', '),
      data: { seniority: senCounts },
    }));
  } else if (vendor === 'mercadolibre' && records.length >= 5) {
    const prices = records.map(r => Number(r._price_num)).filter(p => p > 0);
    if (prices.length) {
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      items.push(makeItem('INSIGHT', task, {
        title: `Price summary across ${prices.length} listings`,
        body: `Avg: $${avg.toLocaleString()} · Min: $${min.toLocaleString()} · Max: $${max.toLocaleString()}`,
        data: { avgPrice: avg, minPrice: min, maxPrice: max, count: prices.length },
      }));
    }
  }
  return items;
}

// ─── Main entry point ────────────────────────────────────────────────

export async function generateFeed(task) {
  const vendor = vendorForTask(task);
  const records = await loadRecords(task);
  if (!records.length) {
    console.log(`  No records found for task "${task}"`);
    return [];
  }

  const prevSnap = loadSnapshot(task) || {};
  const isFirstRun = Object.keys(prevSnap).length === 0;
  const newItems = [];

  if (isFirstRun) {
    console.log(`  First run for "${task}" — creating baseline snapshot (${records.length} records)`);
    // On first run, generate insights only (no NEW alerts for entire dataset)
    newItems.push(...generateInsights(records, vendor, task));
  } else {
    console.log(`  Comparing ${records.length} records against snapshot (${Object.keys(prevSnap).length} known)`);
    newItems.push(...detectNew(records, prevSnap, vendor, task));
    newItems.push(...detectPriceDrops(records, prevSnap, vendor, task));
    newItems.push(...detectCandidateMatches(records, prevSnap, vendor, task));
    newItems.push(...generateInsights(records, vendor, task));
  }

  // Save new snapshot
  saveSnapshot(task, records, vendor);

  // Append to global feed
  const feed = loadFeed();
  feed.items.unshift(...newItems);
  // Keep last 500 items
  feed.items = feed.items.slice(0, 500);
  saveFeed(feed);

  return newItems;
}

export { FEED_PATH, DATA_DIR };
