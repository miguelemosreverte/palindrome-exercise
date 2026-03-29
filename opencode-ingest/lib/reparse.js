import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Re-parse saved HTML files to extract richer data.
 * This is the core iteration loop: scrape once, parse many times.
 *
 * Each domain has a parser that reads raw HTML and returns records.
 * The parser can be improved over time without re-fetching.
 */

// ─── MercadoLibre HTML parser ────────────────────────────────────────────

function parseMercadoLibre(html, url) {
  const records = [];
  const re = /<li[^>]*ui-search-layout__item[^>]*>([\s\S]*?)(?=<li[^>]*ui-search-layout__item|<\/ol|<\/ul|$)/g;
  let match;

  // Split by list items
  const items = html.split(/<li[^>]*class="[^"]*ui-search-layout__item[^"]*"/);

  for (let i = 1; i < items.length; i++) {
    const chunk = items[i].substring(0, 8000); // each item is ~3-5KB

    // Title — poly-component__title or polycard__title
    const titleMatch = chunk.match(/poly-component__title[^>]*>([^<]+)/)
      || chunk.match(/polycard_[^>]*title[^>]*>([^<]+)/);
    const title = titleMatch?.[1]?.trim() || '';

    // URL — first href in the item
    const urlMatch = chunk.match(/href="(https:\/\/[^"]*(?:mercadolibre|articulo|click1)[^"]*)"/);
    const itemUrl = urlMatch?.[1]?.split('#')[0] || '';

    // Price — andes-money-amount__fraction
    const fractionMatch = chunk.match(/andes-money-amount__fraction[^>]*>([^<]+)/);
    const currencyMatch = chunk.match(/andes-money-amount__currency-symbol[^>]*>([^<]+)/);
    const centsMatch = chunk.match(/andes-money-amount__cents[^>]*>([^<]+)/);
    const currency = currencyMatch?.[1]?.trim() || '$';
    const fraction = fractionMatch?.[1]?.trim() || '';
    const cents = centsMatch?.[1]?.trim() || '';
    const priceNum = fraction ? parseFloat(fraction.replace(/\./g, '')) + (cents ? parseFloat(`0.${cents}`) : 0) : 0;

    // Image — product images from mlstatic
    const imgMatch = chunk.match(/src="(https:\/\/http2\.mlstatic\.com\/D_[^"]+)"/);
    const image = imgMatch?.[1] || '';

    // Seller — official store label or poly seller
    const sellerMatch = chunk.match(/official-store[^>]*>([^<]+)/)
      || chunk.match(/poly-component__seller[^>]*>([^<]+)/)
      || chunk.match(/polycard_[^>]*seller[^>]*>([^<]+)/);
    const seller = sellerMatch?.[1]?.trim() || '';

    // Shipping
    const shippingMatch = chunk.match(/poly-component__shipping[^>]*>([^<]+)/)
      || chunk.match(/ui-pb-highlight[^>]*>([^<]+)/)
      || chunk.match(/shipping[^>]*>([^<]*(?:gratis|Llega)[^<]*)/i);
    const shipping = shippingMatch?.[1]?.trim() || '';
    const freeShipping = /gratis|free|fulfillment/i.test(chunk);

    // Location
    const locMatch = chunk.match(/poly-component__location[^>]*>([^<]+)/)
      || chunk.match(/ui-search-item__location[^>]*>([^<]+)/);
    const location = locMatch?.[1]?.trim() || '';

    // Installments
    const installMatch = chunk.match(/(\d+x)\s*[\$]?\s*([\d.,]+)/);
    const installments = installMatch ? `${installMatch[1]} $${installMatch[2]}` : '';

    // Reviews
    const reviewMatch = chunk.match(/reviews__amount[^>]*>\(?(\d+)\)?/);
    const reviews = reviewMatch ? parseInt(reviewMatch[1]) : 0;
    const ratingMatch = chunk.match(/reviews__rating-number[^>]*>([\d.]+)/);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

    // MLA ID from URL
    const mlaMatch = itemUrl.match(/(MLA[\d-]+)/);
    const mlaId = mlaMatch?.[1] || '';

    if (title) {
      records.push({
        title,
        price: priceNum > 0 ? `${currency}${fraction}${cents ? `,${cents}` : ''}` : '',
        _price_num: priceNum,
        url: mlaId ? `https://articulo.mercadolibre.com.ar/${mlaId}` : itemUrl,
        image,
        location,
        seller,
        shipping: freeShipping ? (shipping || 'Envío gratis') : shipping,
        installments,
        reviews,
        rating,
        source: 'mercadolibre',
      });
    }
  }
  return records;
}

// ─── YouTube HTML parser ─────────────────────────────────────────────────

function parseYouTube(html, url) {
  // YouTube stores everything in ytInitialData JSON
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
  if (!match) return [];

  let data;
  try { data = JSON.parse(match[1]); } catch { return []; }

  const videos = [];
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.videoRenderer) {
      const vr = obj.videoRenderer;
      const title = vr.title?.runs?.[0]?.text || '';
      const videoId = vr.videoId || '';
      const channel = vr.ownerText?.runs?.[0]?.text || '';
      const channelUrl = vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
      const views = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.[0]?.text || '';
      const duration = vr.lengthText?.simpleText || '';
      const published = vr.publishedTimeText?.simpleText || '';
      const thumbnail = vr.thumbnail?.thumbnails?.at(-1)?.url || '';
      const description = vr.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map(r => r.text).join('') || '';

      // Parse view count to number
      const viewNum = parseInt((views.match(/[\d.,]+/) || ['0'])[0].replace(/[.,]/g, '')) || 0;

      if (title && videoId) {
        videos.push({
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          channel,
          channelUrl: channelUrl ? `https://www.youtube.com${channelUrl}` : '',
          views,
          _views_num: viewNum,
          duration,
          published,
          thumbnail,
          description: description.substring(0, 300),
          source: 'youtube',
        });
      }
    }
    if (Array.isArray(obj)) obj.forEach(walk);
    else Object.values(obj).forEach(walk);
  }

  walk(data);
  return videos;
}

// ─── GitHub HTML parser ──────────────────────────────────────────────────

function parseGitHub(html, url) {
  const records = [];
  // GitHub search results use data-testid="results-list" or repo-list patterns
  const blocks = html.split(/data-testid="results-list"|class="repo-list-item"/);

  // Simple regex extraction from search result HTML
  const repoMatches = [...html.matchAll(/href="\/([^"]+?\/[^"]+?)"[^>]*class="[^"]*v-align-middle[^"]*"/g)];
  const seen = new Set();

  for (const m of repoMatches) {
    const repoPath = m[1];
    if (seen.has(repoPath) || repoPath.includes('/blob/') || repoPath.includes('/tree/')) continue;
    seen.add(repoPath);

    // Find description, language, stars near this repo link
    const idx = html.indexOf(m[0]);
    const context = html.substring(idx, idx + 3000);

    const descMatch = context.match(/class="[^"]*mb-1[^"]*"[^>]*>([^<]+)/);
    const langMatch = context.match(/programmingLanguage[^>]*>([^<]+)/);
    const starsMatch = context.match(/(\d[\d,kKmM.]*)\s*stars?/i) || context.match(/aria-label="(\d[\d,kKmM.]*)\s*stars?/i);

    records.push({
      name: repoPath,
      url: `https://github.com/${repoPath}`,
      description: (descMatch?.[1] || '').trim().substring(0, 300),
      language: (langMatch?.[1] || '').trim(),
      stars: (starsMatch?.[1] || '').trim(),
      source: 'github',
    });
  }
  return records;
}

// ─── LinkedIn HTML parser ────────────────────────────────────────────────

function parseLinkedInProfile(html, url) {
  // Extract from page text content (LinkedIn SDUI has no stable DOM classes)
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = (titleMatch?.[1] || '').replace(/\s*\|?\s*LinkedIn\s*$/, '').trim();
  if (!name || name === 'LinkedIn') return null;

  // Get all visible text
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const nameIdx = lines.findIndex(l => l === name);
  const headline = (nameIdx >= 0 && nameIdx < lines.length - 1) ? lines[nameIdx + 1] : '';

  const location = lines.find(l =>
    /argentina|buenos aires|córdoba|rosario|mendoza/i.test(l) && l.length < 80
  ) || 'Argentina';

  let title = headline;
  let company = '';
  for (const p of [/^(.+?)\s+(?:at|en|@)\s+(.+)$/i, /^(.+?)\s*[|·]\s*(.+)$/]) {
    const m = headline.match(p);
    if (m) { title = m[1].trim(); company = m[2].trim(); break; }
  }

  // Experience
  const expIdx = lines.findIndex(l => /^experiencia$|^experience$/i.test(l));
  if (expIdx > 0) {
    const expLines = lines.slice(expIdx + 1, expIdx + 10).filter(l => l.length > 3 && l.length < 120);
    if (expLines[0] && !title) title = expLines[0];
    if (expLines[1] && !company) company = expLines[1];
  }

  // Skills
  const skillIdx = lines.findIndex(l => /^aptitudes$|^skills$|^competencias$/i.test(l));
  const skills = [];
  if (skillIdx > 0) {
    for (let i = skillIdx + 1; i < Math.min(skillIdx + 20, lines.length); i++) {
      const l = lines[i];
      if (/^(experiencia|experience|educación|education|idiomas|languages|intereses)/i.test(l)) break;
      if (l.length > 1 && l.length < 40 && !/^\d+/.test(l)) skills.push(l);
    }
  }

  let seniority = 'senior';
  const t = (title + ' ' + headline).toLowerCase();
  if (t.includes('staff')) seniority = 'staff';
  if (t.includes('principal')) seniority = 'principal';
  if (t.includes('lead') || t.includes('líder')) seniority = 'lead';
  if (t.includes('architect')) seniority = 'architect';
  if (t.includes('director') || t.includes('vp') || t.includes('cto')) seniority = 'executive';
  if (t.includes('manager') || t.includes('head of')) seniority = 'manager';

  const slug = url.match(/\/in\/([^/]+)/)?.[1] || '';

  return {
    name,
    title,
    company,
    location,
    skills: skills.join(', '),
    profileUrl: slug ? `https://www.linkedin.com/in/${slug}` : url,
    salary: '',
    seniority,
    headline,
    contact: '',
    source: 'linkedin',
  };
}

// ─── Parser registry ─────────────────────────────────────────────────────

function getParserForTask(taskName) {
  const name = taskName.toLowerCase();
  if (name.includes('mercado')) return { parse: parseMercadoLibre, perFile: true };
  if (name.includes('youtube') || name.includes('video')) return { parse: parseYouTube, perFile: true };
  if (name.includes('github')) return { parse: parseGitHub, perFile: true };
  if (name.includes('linkedin') || name.includes('devs')) return { parse: parseLinkedInProfile, perFile: false };
  return null;
}

/**
 * Re-parse all saved HTML files for a task → regenerate JSONL.
 */
export async function reparseTask(taskName) {
  const dataDir = join(ROOT, 'data', taskName);
  const htmlDir = join(dataDir, 'html');
  const rawDir = join(dataDir, 'raw');

  if (!existsSync(htmlDir)) {
    console.log(`[${taskName}] No HTML directory — nothing to reparse`);
    return 0;
  }

  const parserInfo = getParserForTask(taskName);
  if (!parserInfo) {
    console.log(`[${taskName}] No parser registered for this task type`);
    return 0;
  }

  const htmlFiles = readdirSync(htmlDir).filter(f => f.endsWith('.html')).sort();
  if (htmlFiles.length === 0) {
    console.log(`[${taskName}] No HTML files found`);
    return 0;
  }

  mkdirSync(rawDir, { recursive: true });

  if (parserInfo.perFile) {
    // Group HTML files by iteration number (prefix)
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
        const url = f.replace(/^\d+-/, '').replace(/_/g, '/').replace(/\.html$/, '');
        const records = parserInfo.parse(html, url);
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

    // Update meta
    const metaPath = join(dataDir, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      meta.totalRecords = totalRecords;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    console.log(`[${taskName}] Total: ${totalRecords} records from ${htmlFiles.length} HTML files`);
    return totalRecords;

  } else {
    // LinkedIn: each HTML file is one profile
    const profileFiles = htmlFiles.filter(f => f.includes('profile'));
    const searchFiles = htmlFiles.filter(f => f.includes('search'));

    const allRecords = [];
    for (const f of profileFiles) {
      const html = readFileSync(join(htmlDir, f), 'utf8');
      const url = f; // filename contains the slug
      const record = parserInfo.parse(html, url);
      if (record && record.name) allRecords.push(record);
    }

    // Deduplicate by profileUrl
    const seen = new Set();
    const unique = allRecords.filter(r => {
      if (seen.has(r.profileUrl)) return false;
      seen.add(r.profileUrl);
      return true;
    });

    // Write as single JSONL (all profiles)
    const rawFile = join(rawDir, '001.jsonl');
    writeFileSync(rawFile, unique.map(r => JSON.stringify(r)).join('\n') + '\n');

    // Clear other raw files
    const { unlinkSync } = await import('fs');
    for (const f of readdirSync(rawDir).filter(x => x !== '001.jsonl' && x.endsWith('.jsonl'))) {
      unlinkSync(join(rawDir, f));
    }

    const metaPath = join(dataDir, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      meta.totalRecords = unique.length;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    console.log(`[${taskName}] Reparsed ${unique.length} profiles from ${profileFiles.length} HTML files`);
    return unique.length;
  }
}
