import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Offline data cleaning — iterate on raw JSONL without re-fetching.
 * Each cleaner receives a record and returns a cleaned version.
 *
 * Domain-specific cleaners are auto-detected by task name.
 */

// ─── LinkedIn cleaner ────────────────────────────────────────────────────

const LINKEDIN_SKILL_NOISE = new Set([
  'mostrar todo', 'validar', 'recomendaciones', 'recomendar', 'recibidas',
  'enviadas', 'no hay actividad en este momento', '… más', '• 2º', '• 3º',
  'nuevo', 'validada por', 'recomendado', 'ver más', 'mostrar menos',
  'cursos', 'publicaciones', 'entrevistas', 'idiomas', 'intereses',
  'educación', 'experiencia', 'aptitudes', 'skills', 'logros',
  'reconocimientos y premios', 'actividad', 'acerca de', 'about',
]);

const LINKEDIN_SKILL_PATTERN_NOISE = [
  /^· \d/,                              // "· 3er", "· 2º"
  /^sin dudas/i,                        // recommendation text
  /^(recibidas|enviadas|recomendar)/i,
  /^\d+\s+(años?|meses?|year|month)/i,  // durations
  /^(validada?|recomendado)\s/i,
  /\b(en|at|·)\s+\w/i,                  // role descriptions leaking: "X en Company"
  /^(senior|junior|developer|engineer|manager|director|lead|socio|fundador)\s/i,
];

function cleanLinkedIn(r) {
  // Clean skills: remove UI noise, section headers, person names
  if (r.skills) {
    const cleaned = r.skills.split(',')
      .map(s => s.trim())
      .filter(s => {
        const lower = s.toLowerCase();
        if (!s || s.length < 2 || s.length > 50) return false;
        if (LINKEDIN_SKILL_NOISE.has(lower)) return false;
        if (LINKEDIN_SKILL_PATTERN_NOISE.some(p => p.test(s))) return false;
        if (s.length > 30 && /\b(en|at|·)\s+\w/i.test(s)) return false;
        // Names: "Nombre Apellido" or "Nombre A." patterns
        if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][\w.]*$/.test(s)) return false;
        return true;
      });
    r.skills = [...new Set(cleaned)].join(', ');
  }

  // Clean company: remove noise patterns
  if (r.company) {
    r.company = r.company
      // Remove employment type suffixes
      .replace(/\s*·\s*(Jornada completa|Profesional independiente|Full-time|Part-time|Contract|Contrato temporal)$/i, '')
      .trim();
    // If it's just a time duration, clear it
    if (/^\d+\s+(años?|meses?|years?|months?)/i.test(r.company)) {
      r.company = '';
    }
    // If it's a full headline (too long, or has pipes/many words), truncate
    if (r.company.length > 60 && r.company.includes('|')) {
      r.company = r.company.split('|')[0].trim();
    }
    if (r.company.length > 80) {
      r.company = r.company.substring(0, 60).trim();
    }
  }

  // Clean title: remove trailing noise
  if (r.title) {
    r.title = r.title
      .replace(/\s*·\s*(Jornada completa|Profesional independiente|Full-time)$/i, '')
      .trim();
  }

  // Clean headline: truncate if too long (some have entire bios)
  if (r.headline && r.headline.length > 150) {
    r.headline = r.headline.substring(0, 150).trim();
  }

  return r;
}

// ─── MercadoLibre cleaner ────────────────────────────────────────────────

function cleanMercadoLibre(r) {
  // Fix price: extract numeric value from "$$751.113" or "$$" patterns
  if (r.price) {
    // Remove currency symbols, extract first number with dots/commas
    const numMatch = r.price.match(/[\d.,]+/);
    if (numMatch) {
      // Argentine format: 751.113 = 751113, or 751.113,50
      let num = numMatch[0];
      // If it has dots as thousands separators (no comma), remove dots
      if (num.includes('.') && !num.includes(',')) {
        num = num.replace(/\./g, '');
      } else if (num.includes(',')) {
        // 751.113,50 format
        num = num.replace(/\./g, '').replace(',', '.');
      }
      const parsed = parseFloat(num);
      if (!isNaN(parsed) && parsed > 0) {
        r.price = `$${parsed.toLocaleString('es-AR')}`;
        r._price_num = parsed; // numeric for sorting/charts
      } else {
        r.price = '';
        r._price_num = 0;
      }
    } else {
      r.price = '';
      r._price_num = 0;
    }
  }

  // Clean title: normalize whitespace, trim length
  if (r.title) {
    r.title = r.title.replace(/\s+/g, ' ').trim();
    if (r.title.length > 120) r.title = r.title.substring(0, 120).trim();
  }

  // Clean URL: strip tracking parameters (keep base MLA URL)
  if (r.url) {
    const mlaMatch = r.url.match(/MLA[\d-]+/);
    if (mlaMatch) {
      r.url = `https://articulo.mercadolibre.com.ar/${mlaMatch[0]}`;
    }
  }

  // Normalize shipping
  if (r.shipping) {
    r.shipping = r.shipping.replace(/\s+/g, ' ').trim();
  }

  return r;
}

// ─── YouTube cleaner ─────────────────────────────────────────────────────

function cleanYouTube(r) {
  // Clean views: extract number
  if (r.views) {
    const num = r.views.match(/[\d,.]+\s*[kKmM]?/);
    r.views = num ? num[0].trim() : r.views;
  }

  // Clean URL: remove tracking params
  if (r.url) {
    try {
      const u = new URL(r.url);
      const v = u.searchParams.get('v');
      if (v) r.url = `https://www.youtube.com/watch?v=${v}`;
    } catch {}
  }

  // Clean duration whitespace
  if (r.duration) {
    r.duration = r.duration.trim();
  }

  return r;
}

// ─── GitHub cleaner ──────────────────────────────────────────────────────

function cleanGitHub(r) {
  // Clean stars: "484k" → "484k", "1,234" → "1,234"
  if (r.stars) {
    r.stars = r.stars.trim();
  }

  // Clean name: remove leading/trailing whitespace
  if (r.name) {
    r.name = r.name.replace(/\s+/g, ' ').trim();
  }

  return r;
}

// ─── Cleaner registry ────────────────────────────────────────────────────

function getCleanerForTask(taskName) {
  const name = taskName.toLowerCase();
  if (name.includes('linkedin') || name.includes('devs')) return cleanLinkedIn;
  if (name.includes('mercado')) return cleanMercadoLibre;
  if (name.includes('youtube') || name.includes('video')) return cleanYouTube;
  if (name.includes('github')) return cleanGitHub;
  return (r) => r; // no-op
}

/**
 * Clean all raw JSONL files for a task in-place.
 * Rewrites the files with cleaned data.
 */
export function cleanTask(taskName) {
  const dataDir = join(ROOT, 'data', taskName);
  const rawDir = join(dataDir, 'raw');
  const cleaner = getCleanerForTask(taskName);

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
        cleaned.push(line); // keep unparseable lines as-is
      }
    }

    writeFileSync(path, cleaned.join('\n') + '\n');
  }

  console.log(`[${taskName}] Cleaned ${totalCleaned} records across ${files.length} files`);
  return totalCleaned;
}
