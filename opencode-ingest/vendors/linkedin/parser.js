/**
 * LinkedIn — HTML parser
 * Extracts profile data from saved LinkedIn profile HTML pages.
 * LinkedIn uses SDUI (no stable DOM classes), so we parse from page text.
 */

export function parseProfile(html, url) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = (titleMatch?.[1] || '').replace(/\s*\|?\s*LinkedIn\s*$/, '').trim();
  if (!name || name === 'LinkedIn') return null;

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

  const slug = url.match(/\/in\/([^/]+)/)?.[1] || url.match(/profile-([^.]+)/)?.[1] || '';

  return {
    name,
    title,
    company,
    location,
    skills: skills.join(', '),
    profileUrl: slug ? `https://www.linkedin.com/in/${slug}` : '',
    seniority,
    headline,
    source: 'linkedin',
  };
}

/** Parse all HTML files for a LinkedIn task. Profile files contain "profile" in name. */
export function parseAll(htmlFiles, readFile) {
  const records = [];
  const profileFiles = htmlFiles.filter(f => f.includes('profile'));

  for (const { name, content } of profileFiles.map(f => ({ name: f, content: readFile(f) }))) {
    const record = parseProfile(content, name);
    if (record && record.name) records.push(record);
  }

  // Deduplicate by profileUrl
  const seen = new Set();
  return records.filter(r => {
    if (!r.profileUrl || seen.has(r.profileUrl)) return false;
    seen.add(r.profileUrl);
    return true;
  });
}
