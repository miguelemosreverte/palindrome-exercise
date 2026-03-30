/**
 * LinkedIn — HTML parser
 * Extracts profile data + photos + company logos from saved HTML pages.
 * Runs OFFLINE on saved HTML — no network needed.
 */

export function parseProfile(html, filename) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = (titleMatch?.[1] || '').replace(/\s*\|?\s*LinkedIn\s*$/, '').trim();
  if (!name || name === 'LinkedIn') return null;

  // Profile photo — use 200x200+ (the profile owner's photo, not nav thumbnails which are 100x100)
  const photoMatch = html.match(/(https:\/\/media\.licdn\.com\/dms\/image\/[^"]+?profile-displayphoto-shrink_(?:200_200|400_400|800_800)[^"]+)/)
    || html.match(/(https:\/\/media\.licdn\.com\/dms\/image\/[^"]+?profile-displayphoto-shrink_(?!100_100)[^"]+)/);
  const photo = photoMatch?.[1]?.replace(/&amp;/g, '&') || '';

  // Company logo
  const companyLogoMatch = html.match(/(https:\/\/media\.licdn\.com\/dms\/image\/[^"]+?(?:company-logo|C4[DE]0[A-Z]+)[^"]+)/);
  const companyLogo = companyLogoMatch?.[1]?.replace(/&amp;/g, '&') || '';

  // Strip to text
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

  const expIdx = lines.findIndex(l => /^experiencia$|^experience$/i.test(l));
  if (expIdx > 0) {
    const expLines = lines.slice(expIdx + 1, expIdx + 10).filter(l => l.length > 3 && l.length < 120);
    if (expLines[0] && !title) title = expLines[0];
    if (expLines[1] && !company) company = expLines[1];
  }

  // Skills: find "Aptitudes"/"Skills" section, filter aggressively
  const SKILL_NOISE = /^(ha comentado|ha indicado|ha recomendado|ha publicado|mostrar|ver más|más$|validar|recomendar|recibidas|enviadas|seguir|conectar|mensaje|•|…|actividad)/i;
  const TIMESTAMP = /^\d+\s+(mes|año|día|hour|min|week|month|year|day|de\s)/i;
  const NAME_PATTERN = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ]/; // "María Laura", "Guillermo Rafael"
  const VALIDATION = /\d+\s+validaci/i; // "26 validaciones", "1 validación"
  const DATE_PATTERN = /^\d+\s+de\s+\w+\s+de\s+\d{4}/; // "3 de octubre de 2020"
  const NOISE_PHRASES = /^(estudió con|trabaj[óo] con|compartir con|suertón|Thank you)/i;

  const skillIdx = lines.findIndex(l => /^aptitudes$|^skills$|^competencias$/i.test(l));
  const skills = [];
  if (skillIdx > 0) {
    for (let i = skillIdx + 1; i < Math.min(skillIdx + 30, lines.length); i++) {
      const l = lines[i];
      if (/^(experiencia|experience|educación|education|idiomas|languages|intereses|actividad|activity)/i.test(l)) break;
      if (l.length <= 1 || l.length > 50) continue;
      if (SKILL_NOISE.test(l)) continue;
      if (TIMESTAMP.test(l)) continue;
      if (VALIDATION.test(l)) continue;
      if (DATE_PATTERN.test(l)) continue;
      if (NOISE_PHRASES.test(l)) continue;
      if (NAME_PATTERN.test(l) && !l.includes('(') && l.split(' ').length <= 3) continue;
      if (/^\d+$/.test(l)) continue;
      if (/^(que |Que |lo |Lo |me |Me |se |Se |es |Es )/.test(l)) continue;
      if (l === 'más' || l === 'Más') continue;
      skills.push(l);
    }
  }

  const connMatch = text.match(/(\d+)\+?\s*(?:contactos|connections)/i);
  const connections = connMatch ? parseInt(connMatch[1]) : 0;

  let seniority = 'senior';
  const t = (title + ' ' + headline).toLowerCase();
  if (t.includes('staff')) seniority = 'staff';
  if (t.includes('principal')) seniority = 'principal';
  if (t.includes('lead') || t.includes('líder')) seniority = 'lead';
  if (t.includes('architect')) seniority = 'architect';
  if (t.includes('director') || t.includes('vp') || t.includes('cto')) seniority = 'executive';
  if (t.includes('manager') || t.includes('head of')) seniority = 'manager';

  const slug = filename.match(/profile-([^.]+)/)?.[1] || '';

  return {
    name, title, company, location,
    skills: skills.join(', '),
    profileUrl: slug ? `https://www.linkedin.com/in/${slug}` : '',
    photo, companyLogo, connections, seniority, headline,
    source: 'linkedin',
  };
}

/** Parse all HTML files for a LinkedIn task */
export function parseAll(htmlFiles, readFile) {
  const records = [];
  for (const f of htmlFiles.filter(f => f.includes('profile'))) {
    const record = parseProfile(readFile(f), f);
    if (record && record.name) records.push(record);
  }
  const seen = new Set();
  return records.filter(r => {
    if (!r.profileUrl || seen.has(r.profileUrl)) return false;
    seen.add(r.profileUrl);
    return true;
  });
}
