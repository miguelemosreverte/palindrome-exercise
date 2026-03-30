/**
 * City -> {lat, lng} geocoding with hardcoded lookup + Nominatim fallback.
 * Results are cached to disk to avoid repeated API calls.
 *
 * Usage:
 *   import { geocode, geocodeAll } from './geocode.js';
 *   const coords = await geocode('Argentina|Córdoba');
 *   const map = await geocodeAll(records, 'city');
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', 'data', '.geocode-cache.json');

// Known cities — avoids network calls for common LATAM locations
const KNOWN = {
  'Argentina':                { lat: -34.603, lng: -58.381 },
  'Argentina|Buenos Aires':   { lat: -34.603, lng: -58.381 },
  'Argentina|Córdoba':        { lat: -31.416, lng: -64.183 },
  'Argentina|Cordoba':        { lat: -31.416, lng: -64.183 },
  'Argentina|Rosario':        { lat: -32.947, lng: -60.639 },
  'Argentina|Mendoza':        { lat: -32.889, lng: -68.845 },
  'Argentina|Tucumán':        { lat: -26.808, lng: -65.217 },
  'Argentina|Mar del Plata':  { lat: -38.005, lng: -57.542 },
  'Argentina|San Luis':       { lat: -33.302, lng: -66.338 },
  'Argentina|La Plata':       { lat: -34.921, lng: -57.954 },
  'Argentina|Santa Fe':       { lat: -31.610, lng: -60.697 },
  'Argentina|Neuquén':        { lat: -38.952, lng: -68.059 },
  'Argentina|Salta':          { lat: -24.789, lng: -65.410 },
  'Argentina|San Juan':       { lat: -31.537, lng: -68.527 },
  'Argentina|Bahía Blanca':   { lat: -38.717, lng: -62.266 },
  'Argentina|Resistencia':    { lat: -27.451, lng: -58.987 },
  'Argentina|Paraná':         { lat: -31.732, lng: -60.530 },
  'Argentina|Santiago del Estero': { lat: -27.783, lng: -64.264 },
  'Argentina|Corrientes':     { lat: -27.469, lng: -58.831 },
  'Argentina|San Miguel de Tucumán': { lat: -26.808, lng: -65.217 },
  'Brazil':                   { lat: -23.550, lng: -46.633 },
  'Brazil|São Paulo':         { lat: -23.550, lng: -46.633 },
  'Brazil|Rio de Janeiro':    { lat: -22.907, lng: -43.173 },
  'Chile':                    { lat: -33.447, lng: -70.673 },
  'Chile|Santiago':           { lat: -33.447, lng: -70.673 },
  'Uruguay':                  { lat: -34.901, lng: -56.164 },
  'Uruguay|Montevideo':       { lat: -34.901, lng: -56.164 },
  'Colombia':                 { lat: 4.711, lng: -74.072 },
  'Colombia|Bogotá':          { lat: 4.711, lng: -74.072 },
  'Mexico':                   { lat: 19.432, lng: -99.133 },
  'Mexico|Mexico City':       { lat: 19.432, lng: -99.133 },
  'Peru':                     { lat: -12.046, lng: -77.043 },
  'Peru|Lima':                { lat: -12.046, lng: -77.043 },
};

let diskCache = null;

function loadCache() {
  if (diskCache) return diskCache;
  try {
    diskCache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    diskCache = {};
  }
  return diskCache;
}

function saveCache() {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(diskCache, null, 2));
  } catch {}
}

/**
 * Geocode a single "Country|City" string.
 * Returns {lat, lng} or null.
 */
export async function geocode(cityStr) {
  if (!cityStr) return null;

  // 1. Check hardcoded
  if (KNOWN[cityStr]) return KNOWN[cityStr];

  // 2. Check disk cache
  const cache = loadCache();
  if (cache[cityStr]) return cache[cityStr];
  if (cache[cityStr] === null) return null; // previously failed

  // 3. Nominatim fallback
  const parts = cityStr.split('|');
  const query = parts.reverse().join(', '); // "Córdoba, Argentina"
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'opencode-ingest/1.0 (geocoding for data reports)' },
    });
    const data = await res.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      cache[cityStr] = result;
      saveCache();
      return result;
    }
  } catch (e) {
    // Network error — don't cache failure
    return null;
  }

  // Cache miss
  cache[cityStr] = null;
  saveCache();
  return null;
}

/**
 * Geocode all unique city values from a record set.
 * Returns a Map: cityString -> {lat, lng}
 */
export async function geocodeAll(records, field = 'city') {
  const unique = [...new Set(records.map(r => r[field]).filter(Boolean))];
  const result = new Map();

  for (const city of unique) {
    const coords = await geocode(city);
    if (coords) result.set(city, coords);
    // Rate-limit Nominatim (1 req/sec policy)
    if (!KNOWN[city] && !loadCache()[city]) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  return result;
}

/** Export the known table for embedding in client-side JS */
export function getKnownGeocode() {
  return { ...KNOWN, ...loadCache() };
}
