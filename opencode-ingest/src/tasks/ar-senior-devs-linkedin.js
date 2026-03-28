import { Scraper } from '../scraper.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getChromeCookes } from '../chrome-cookies.js';

/**
 * Argentine Senior Software Developers — LinkedIn
 *
 * Uses cookies from the user's real Chrome profile (no login needed, Chrome stays open).
 * Scrapes LinkedIn People search for senior/staff/lead engineers in Argentina.
 * Max 100 pages (~10 results per page = ~1000 profiles).
 */
export default class LinkedInArDevsScraper extends Scraper {
  constructor(taskName, dataDir) {
    super(taskName, dataDir);
    this.maxPages = 100;
  }

  sources() {
    // Multiple search queries to get broader coverage — cycle through them
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

    // Extract LinkedIn cookies from Chrome (while Chrome stays open)
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

    // Inject real Chrome cookies — clean up for Playwright compatibility
    const cleanCookies = cookies
      .filter(c => c.name && c.value && c.domain)
      .map(c => {
        const clean = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/' };
        if (c.secure) clean.secure = true;
        if (c.httpOnly) clean.httpOnly = true;
        if (c.expires && c.expires > 0) clean.expires = c.expires;
        // Playwright only accepts 'Strict', 'Lax', 'None'
        if (c.sameSite === 'None' && c.secure) clean.sameSite = 'None';
        else if (c.sameSite === 'Strict') clean.sameSite = 'Strict';
        else clean.sameSite = 'Lax';
        return clean;
      });
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    try {
      // Navigate to search results
      const baseUrl = this.sources()[0].url;
      const pageNum = this.meta.iteration + 1;
      const url = this.meta.cursor || (pageNum > 1 ? `${baseUrl}&page=${pageNum}` : baseUrl);

      console.log(`[${this.taskName}] Iteration ${pageNum} → ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Check if we're actually logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.querySelector('.join-form, .login-form, [data-test-id="login-form"]');
      });
      if (!isLoggedIn) {
        throw new Error('Not logged in to LinkedIn — cookies may have expired');
      }

      // Scroll to load all results
      await page.evaluate(async () => {
        for (let i = 0; i < 8; i++) {
          window.scrollBy(0, 600);
          await new Promise(r => setTimeout(r, 500));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(2000);

      // Step 1: Collect profile URLs from search results
      const profileUrls = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('a[href*="/in/"]').forEach(a => {
          const href = a.href?.split('?')[0];
          if (href?.match(/\/in\/[a-z0-9-]+\/?$/i)) urls.add(href);
        });
        return [...urls];
      });

      console.log(`[${this.taskName}] Found ${profileUrls.length} profile URLs on search page`);

      // Step 2: Visit each profile and extract structured data
      const records = [];
      for (const profileUrl of profileUrls) {
        try {
          await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(1500 + Math.random() * 2000);

          // Extract name from page title (reliable — LinkedIn SDUI doesn't use h1)
          const pageTitle = await page.title();
          const nameFromTitle = pageTitle.replace(/\s*\|?\s*LinkedIn\s*$/, '').trim();

          const record = await page.evaluate(({url, name}) => {
            // Get the full visible text of the page
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            // Find the line with the name, headline is usually right after
            const nameIdx = lines.findIndex(l => l === name);
            const headline = (nameIdx >= 0 && nameIdx < lines.length - 1) ? lines[nameIdx + 1] : '';

            // Location — look for Argentina-related text
            const location = lines.find(l =>
              /argentina|buenos aires|córdoba|rosario|mendoza/i.test(l) && l.length < 80
            ) || 'Argentina';

            // Parse headline for title + company
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

            // Experience: find "Experiencia" or "Experience" section in text
            const expIdx = lines.findIndex(l => /^experiencia$|^experience$/i.test(l));
            if (expIdx > 0) {
              // Lines after "Experience" header are role entries
              const expLines = lines.slice(expIdx + 1, expIdx + 10).filter(l => l.length > 3 && l.length < 120);
              if (expLines[0] && !title) title = expLines[0];
              if (expLines[1] && !company) company = expLines[1];
            }

            // Skills: find "Aptitudes" or "Skills" section
            const skillIdx = lines.findIndex(l => /^aptitudes$|^skills$|^competencias$/i.test(l));
            const skills = [];
            if (skillIdx > 0) {
              for (let i = skillIdx + 1; i < Math.min(skillIdx + 20, lines.length); i++) {
                const l = lines[i];
                if (/^(experiencia|experience|educación|education|idiomas|languages|intereses)/i.test(l)) break;
                if (l.length > 1 && l.length < 40 && !/^\d+/.test(l)) skills.push(l);
              }
            }

            // Seniority
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
          } else {
            const pageTitle = await page.title();
            const h1s = await page.evaluate(() => [...document.querySelectorAll('h1')].map(h => h.textContent.trim()));
            console.log(`  ? Empty name for ${profileUrl} — page title: "${pageTitle}", h1s: ${JSON.stringify(h1s)}`);
          }
        } catch (err) {
          console.log(`  ✗ ${profileUrl} — ${err.message.substring(0, 60)}`);
        }
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

      // Next page — if 0 results, move to next query; otherwise next page of same query
      const pageWithinQuery = (this.meta.iteration % 10) + 1;
      let hasNext = this.meta.iteration < this.maxPages;
      let nextUrl;

      if (records.length === 0 || pageWithinQuery >= 10) {
        // Switch to next query, page 1
        this.meta.iteration = Math.ceil(this.meta.iteration / 10) * 10; // snap to next query boundary
        nextUrl = this.sources()[0].url; // sources() uses meta.iteration to pick query
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

  // Not used — next() handles everything
  async extract(page) { return []; }
  async nextPage(page) { return false; }
}
