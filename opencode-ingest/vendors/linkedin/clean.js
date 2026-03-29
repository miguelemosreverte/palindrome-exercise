/**
 * LinkedIn — record cleaner
 * Removes UI noise from skills, normalizes company/title fields,
 * marks expired-session junk records as _deleted.
 */

const SKILL_NOISE = new Set([
  'mostrar todo', 'validar', 'recomendaciones', 'recomendar', 'recibidas',
  'enviadas', 'no hay actividad en este momento', '… más', '• 2º', '• 3º',
  'nuevo', 'validada por', 'recomendado', 'ver más', 'mostrar menos',
  'cursos', 'publicaciones', 'entrevistas', 'idiomas', 'intereses',
  'educación', 'experiencia', 'aptitudes', 'skills', 'logros',
  'reconocimientos y premios', 'actividad', 'acerca de', 'about',
]);

const SKILL_PATTERN_NOISE = [
  /^· \d/,
  /^sin dudas/i,
  /^(recibidas|enviadas|recomendar)/i,
  /^\d+\s+(años?|meses?|year|month)/i,
  /^(validada?|recomendado)\s/i,
  /\b(en|at|·)\s+\w/i,
  /^(senior|junior|developer|engineer|manager|director|lead|socio|fundador)\s/i,
];

const JUNK_NAMES = new Set([
  'registrarse', 'regístrate', 'sign up', 'sign in', 'iniciar sesión',
  'linkedin', 'linkedin member', 'conectar', 'seguir',
]);

export function clean(r) {
  if (r.name && JUNK_NAMES.has(r.name.toLowerCase())) {
    r._deleted = true;
    return r;
  }

  if (r.skills) {
    const cleaned = r.skills.split(',')
      .map(s => s.trim())
      .filter(s => {
        const lower = s.toLowerCase();
        if (!s || s.length < 2 || s.length > 50) return false;
        if (SKILL_NOISE.has(lower)) return false;
        if (SKILL_PATTERN_NOISE.some(p => p.test(s))) return false;
        if (s.length > 30 && /\b(en|at|·)\s+\w/i.test(s)) return false;
        if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][\w.]*$/.test(s)) return false;
        return true;
      });
    r.skills = [...new Set(cleaned)].join(', ');
  }

  if (r.company) {
    r.company = r.company
      .replace(/\s*·\s*(Jornada completa|Profesional independiente|Full-time|Part-time|Contract|Contrato temporal)$/i, '')
      .trim();
    if (/^\d+\s+(años?|meses?|years?|months?)/i.test(r.company)) r.company = '';
    if (r.company.length > 60 && r.company.includes('|')) r.company = r.company.split('|')[0].trim();
    if (r.company.length > 80) r.company = r.company.substring(0, 60).trim();
  }

  if (r.title) {
    r.title = r.title.replace(/\s*·\s*(Jornada completa|Profesional independiente|Full-time)$/i, '').trim();
  }

  if (r.headline && r.headline.length > 150) {
    r.headline = r.headline.substring(0, 150).trim();
  }

  return r;
}
