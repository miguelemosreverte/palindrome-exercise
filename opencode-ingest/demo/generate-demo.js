#!/usr/bin/env node
/**
 * generate-demo.js — Reads real test data from SQLite databases,
 * picks the best records, mixes with product announcements,
 * and outputs demo/feed.json.
 *
 * Usage: node demo/generate-demo.js
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT = join(__dirname, 'feed.json');

function makeItem(type, source, { title, body, url, thumbnail, data }) {
  return {
    id: `demo-${randomUUID().slice(0, 8)}`,
    type,
    source,
    title,
    body: body || '',
    url: url || '',
    thumbnail: thumbnail || '',
    timestamp: new Date().toISOString(),
    read: false,
    dismissed: false,
    demo: true,
    data: data || {},
  };
}

async function loadDB(relPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(join(DATA_DIR, relPath)));
  const result = db.exec('SELECT * FROM records');
  db.close();
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

// ─── Pick best records ──────────────────────────────────────────────

function pickLinkedIn(records) {
  return records
    .filter(r => r.seniority_score)
    .sort((a, b) => (b.seniority_score || 0) - (a.seniority_score || 0))
    .slice(0, 5)
    .map(r => makeItem('CANDIDATE_MATCH', 'ar-senior-devs-linkedin', {
      title: `High-match candidate: ${r.name}`,
      body: `Score: ${r.seniority_score}% · ${r.seniority_level || ''} · ${r.company || ''} · ${r.location || ''}`,
      url: r.profileUrl || '',
      thumbnail: r.photo || '',
      data: {
        matchScore: r.seniority_score,
        seniority: r.seniority_level,
        company: r.company,
        title: r.title,
        location: r.location,
        skills: r.skills_normalized || r.skills || '',
      },
    }));
}

function pickMercadoLibre(records) {
  // Best deals: lowest price with free shipping, or highest discount
  const withPrice = records.filter(r => r._price_num && r._price_num > 0);

  // Pick cheapest
  const cheapest = [...withPrice].sort((a, b) => a._price_num - b._price_num).slice(0, 3);
  // Pick ones with biggest discounts
  const discounted = withPrice
    .filter(r => r.discount && r.discount.length > 0)
    .sort((a, b) => {
      const da = parseInt(a.discount) || 0;
      const db = parseInt(b.discount) || 0;
      return db - da;
    })
    .slice(0, 2);

  const seen = new Set();
  const picks = [];
  for (const r of [...discounted, ...cheapest]) {
    if (seen.has(r._id)) continue;
    seen.add(r._id);
    if (picks.length >= 5) break;
    picks.push(r);
  }

  return picks.map(r => makeItem('NEW', 'mercado-libre-bikes-cordoba', {
    title: `Deal found: ${(r.title || '').slice(0, 80)}`,
    body: `${r.price || ''} ${r.discount ? '(' + r.discount + ')' : ''} · ${r.shipping || ''}`.trim(),
    url: r.url || '',
    thumbnail: r.image || '',
    data: {
      price: r._price_num,
      originalPrice: r.original_price,
      discount: r.discount,
      seller: r.seller,
      brand: r.brand,
      freeShipping: r.free_shipping,
    },
  }));
}

function pickYouTube(records) {
  return records
    .filter(r => r._views_num)
    .sort((a, b) => (b._views_num || 0) - (a._views_num || 0))
    .slice(0, 5)
    .map(r => makeItem('NEW', 'youtube-claude-code-tutorials', {
      title: `Trending video: ${(r.title || '').slice(0, 80)}`,
      body: `${r.channel || ''} · ${r.views || ''} · ${r.duration || ''}`,
      url: r.url || '',
      thumbnail: r.thumbnail || '',
      data: {
        channel: r.channel,
        views: r.views,
        viewsNum: r._views_num,
        duration: r.duration,
        published: r.published,
      },
    }));
}

// ─── Product features & changelog ───────────────────────────────────

function productFeatures() {
  return [
    makeItem('INSIGHT', 'opencode-ingest', {
      title: 'New: Natural language search',
      body: 'Just type what you\'re looking for — "senior React devs in Argentina" or "bikes under $200k with free shipping".',
      data: { feature: 'nl-search' },
    }),
    makeItem('INSIGHT', 'opencode-ingest', {
      title: 'New: Skill tree filtering',
      body: 'Click to explore candidates by technology. Interactive faceted filters built from your data.',
      data: { feature: 'skill-tree' },
    }),
    makeItem('INSIGHT', 'opencode-ingest', {
      title: 'How two-pass LLM labeling works',
      body: 'Pass 1: Gemini Flash-Lite classifies at 646ms/record. Pass 2: GPT-4o refines edge cases. 95%+ accuracy on structured data.',
      data: { feature: 'two-pass-labeling' },
    }),
    makeItem('INSIGHT', 'opencode-ingest', {
      title: 'Browser-based ingestion',
      body: 'Your Chrome session IS the universal API. No tokens, no rate limits. Just your browser visiting pages.',
      data: { feature: 'browser-ingestion' },
    }),
  ];
}

function changelog() {
  return [
    makeItem('ALERT', 'opencode-ingest', {
      title: 'v0.2: Gemini Flash-Lite support',
      body: '646ms query translation. Structured ingestion with pagination. 3 new paginatable steps.',
      data: { version: '0.2.0' },
    }),
    makeItem('ALERT', 'opencode-ingest', {
      title: 'v0.1: Faceted filter UI with skill tree',
      body: 'Interactive exploration views. WSJ-inspired theme. Feed system with real-time updates.',
      data: { version: '0.1.0' },
    }),
    makeItem('ALERT', 'opencode-ingest', {
      title: 'v0.0: First ingestion run',
      body: '18 LinkedIn profiles, 491 bike listings, 38 YouTube videos — all from a single CLI command.',
      data: { version: '0.0.1' },
    }),
  ];
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('Loading test data...');

  const [linkedin, bikes, youtube] = await Promise.all([
    loadDB('ar-senior-devs-linkedin/db.sqlite'),
    loadDB('mercado-libre-bikes-cordoba/db.sqlite'),
    loadDB('youtube-claude-code-tutorials/db.sqlite'),
  ]);

  console.log(`  LinkedIn: ${linkedin.length} profiles`);
  console.log(`  MercadoLibre: ${bikes.length} listings`);
  console.log(`  YouTube: ${youtube.length} videos`);

  const linkedinItems = pickLinkedIn(linkedin);
  const bikeItems = pickMercadoLibre(bikes);
  const youtubeItems = pickYouTube(youtube);
  const features = productFeatures();
  const changes = changelog();

  // Interleave: feature, linkedin, bike, youtube, feature, ...
  const items = [];
  const sources = [features, linkedinItems, bikeItems, youtubeItems, changes];
  const maxLen = Math.max(...sources.map(s => s.length));

  for (let i = 0; i < maxLen; i++) {
    for (const src of sources) {
      if (i < src.length) items.push(src[i]);
    }
  }

  // Stagger timestamps so they appear in order
  const now = Date.now();
  items.forEach((item, i) => {
    item.timestamp = new Date(now - i * 3600000).toISOString(); // 1 hour apart
  });

  const feed = { items, generated: new Date().toISOString(), demo: true };
  writeFileSync(OUTPUT, JSON.stringify(feed, null, 2));
  console.log(`\nGenerated ${items.length} demo feed items -> demo/feed.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
