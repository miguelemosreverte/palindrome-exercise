import { Scraper } from '../lib/scraper.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getChromeCookes } from '../lib/chrome-cookies.js';
import { humanMove, humanClick, humanScroll, humanReadPage, humanNavigate, Session, sleep, betaRange, uniform } from '../lib/human.js';

/**
 * Argentine Senior Software Developers — LinkedIn
 *
 * Uses cookies from the user's real Chrome profile (no login needed, Chrome stays open).
 * Employs full human behavior emulation: Bezier mouse paths, Fitts's Law,
 * typing with typos, scroll momentum, session rhythm with breaks.
 *
 * Max 100 pages (~10 results per page = ~1000 profiles).
 */
export default class LinkedInArDevsScraper extends Scraper {
  constructor(taskName, dataDir) {
    super(taskName, dataDir);
    this.maxPages = 100;
  }

  sources() {
    const queries = [
      'senior%20software%20engineer',
      'staff%20engineer',
      'principal%20engineer',
      'tech%20lead%20developer',
      'engineering%20manager%20software',
      'software%20architect',
      'senior%20backend%20developer',
      'senior%20fullstack%20developer',
      'CTO%20startup',
      'VP%20engineering',
    ];
    const queryIdx = Math.floor(this.meta.iteration / 10) % queries.length;
    return [
      {
        name: 'LinkedIn',
        url: `https://www.linkedin.com/search/results/people/?keywords=${queries[queryIdx]}&geoUrn=%5B%22100446943%22%5D&origin=FACETED_SEARCH`,
      },
    ];
  }

  async next() {
    const { chromium } = await import('playwright');

    const cookies = await getChromeCookes('.linkedin.com');
    if (cookies.length === 0) {
      throw new Error('No LinkedIn cookies found — are you logged in to LinkedIn in Chrome?');
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const cleanCookies = cookies
      .filter(c => c.name && c.value && c.domain)
      .map(c => {
        const clean = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/' };
        if (c.secure) clean.secure = true;
        if (c.httpOnly) clean.httpOnly = true;
        if (c.expires && c.expires > 0) clean.expires = c.expires;
        if (c.sameSite === 'None' && c.secure) clean.sameSite = 'None';
        else if (c.sameSite === 'Strict') clean.sameSite = 'Strict';
        else clean.sameSite = 'Lax';
        return clean;
      });
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    // Session manager: daily limits, breaks, warm-up
    const session = new Session({ maxProfiles: Math.floor(uniform(28, 36)) });

    try {
      // Navigate to search results — human-like
      const baseUrl = this.sources()[0].url;
      const pageNum = this.meta.iteration + 1;
      const url = this.meta.cursor || (pageNum > 1 ? `${baseUrl}&page=${pageNum}` : baseUrl);

      console.log(`[${this.taskName}] Iteration ${pageNum} → ${url}`);
      await humanNavigate(page, url);

      // Check if we're actually logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.querySelector('.join-form, .login-form, [data-test-id="login-form"]');
      });
      if (!isLoggedIn) {
        throw new Error('Not logged in to LinkedIn — cookies may have expired');
      }

      // Scroll through search results like a human reading them
      await humanReadPage(page, { minTime: 3000, maxTime: 8000 });

      // Collect profile URLs
      const profileUrls = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('a[href*="/in/"]').forEach(a => {
          const href = a.href?.split('?')[0];
          if (href?.match(/\/in\/[a-z0-9-]+\/?$/i)) urls.add(href);
        });
        return [...urls];
      });

      console.log(`[${this.taskName}] Found ${profileUrls.length} profile URLs on search page`);

      // Visit each profile with human-like behavior and session limits
      const records = [];
      for (const profileUrl of profileUrls) {
        if (!session.canContinue) {
          console.log(`[${this.taskName}] Session limit reached, stopping gracefully`);
          break;
        }

        try {
          // Human-like navigation to profile
          await humanNavigate(page, profileUrl);

          // Read the profile page like a human (scroll, pause, read)
          await humanReadPage(page, { minTime: 2000, maxTime: 6000 });

          // Extract name from page title
          const pageTitle = await page.title();
          const nameFromTitle = pageTitle.replace(/\s*\|?\s*LinkedIn\s*$/, '').trim();

          const record = await page.evaluate(({url, name}) => {
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            const nameIdx = lines.findIndex(l => l === name);
            const headline = (nameIdx >= 0 && nameIdx < lines.length - 1) ? lines[nameIdx + 1] : '';

            const location = lines.find(l =>
              /argentina|buenos aires|córdoba|rosario|mendoza/i.test(l) && l.length < 80
            ) || 'Argentina';

            let title = headline;
            let company = '';
            const patterns = [
              /^(.+?)\s+(?:at|en|@)\s+(.+)$/i,
              /^(.+?)\s*[|·]\s*(.+)$/,
            ];
            for (const p of patterns) {
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

            return {
              name,
              title,
              company,
              location,
              skills: [...new Set(skills)].join(', '),
              profileUrl: url,
              salary: '',
              seniority,
              headline,
              contact: '',
              source: 'linkedin',
            };
          }, {url: profileUrl, name: nameFromTitle});

          if (record.name && record.name.length > 2) {
            records.push(record);
            console.log(`  ✓ ${record.name} — ${record.title} @ ${record.company}`);
          }
        } catch (err) {
          console.log(`  ✗ ${profileUrl} — ${err.message.substring(0, 60)}`);
        }

        // Wait between profiles — human rhythm with session management
        await session.waitBetweenProfiles();
      }

      // Save screenshot
      const ssDir = join(this.dataDir, 'screenshots');
      const { mkdirSync } = await import('fs');
      mkdirSync(ssDir, { recursive: true });
      await page.screenshot({ path: join(ssDir, `iter-${pageNum}.png`), fullPage: true }).catch(() => {});

      // Save raw
      this.meta.iteration++;
      const rawFile = join(this.rawDir, `${String(this.meta.iteration).padStart(3, '0')}.jsonl`);
      writeFileSync(rawFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');

      // Next page
      const pageWithinQuery = (this.meta.iteration % 10) + 1;
      let hasNext = this.meta.iteration < this.maxPages;
      let nextUrl;

      if (records.length === 0 || pageWithinQuery >= 10) {
        this.meta.iteration = Math.ceil(this.meta.iteration / 10) * 10;
        nextUrl = this.sources()[0].url;
      } else {
        nextUrl = `${this.sources()[0].url}&page=${pageWithinQuery + 1}`;
      }

      this.meta.cursor = hasNext ? nextUrl : null;
      this.meta.totalRecords += records.length;
      this.meta.history.push({
        iteration: this.meta.iteration,
        date: new Date().toISOString(),
        url,
        records: records.length,
      });

      this.saveMeta();
      return { records, iteration: this.meta.iteration, hasNext };
    } finally {
      await browser.close();
    }
  }

  async extract(page) { return []; }
  async nextPage(page) { return false; }
}
