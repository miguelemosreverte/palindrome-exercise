import { Scraper } from '../scraper.js';

/**
 * Argentine Senior Software Developers — Ingestion Task
 *
 * Source: GetOnBoard (getonbrd.com) — LATAM's largest tech talent platform
 * Targets senior/expert level programming jobs in Argentina
 * Max 100 pages of results
 */
export default class ArSeniorDevsScraper extends Scraper {
  constructor(taskName, dataDir) {
    super(taskName, dataDir);
    this.maxPages = 100;
  }

  sources() {
    return [
      { name: 'GetOnBoard Jobs', url: 'https://www.getonbrd.com/jobs/programming?country=argentina&seniority=senior&seniority=expert' },
    ];
  }

  async extract(page) {
    // Accept cookies if prompted
    await page.click('text=Aceptar cookies').catch(() => {});
    await page.waitForTimeout(1000);

    // Wait for job links to load
    await page.waitForSelector('a[href*="/jobs/"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Scroll to load all lazy content
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 300));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1000);

    // Extract each job link individually — visit detail pages for quality data
    const jobLinks = await page.evaluate(() => {
      const links = new Set();
      document.querySelectorAll('a[href*="/jobs/"]').forEach(a => {
        const href = a.href;
        // Only actual job pages, not category pages
        if (href.match(/\/jobs\/[^/]+\/[^/]+/) && !href.includes('/jobs/programming') && !href.includes('/jobs/devops')) {
          links.add(href);
        }
      });
      return [...links];
    });

    console.log(`[ar-senior-devs] Found ${jobLinks.length} job detail links`);

    // Visit each job page and extract structured data (batch of up to 30 per iteration)
    const batchSize = 30;
    const batch = jobLinks.slice(0, batchSize);
    const records = [];

    for (const url of batch) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(800);

        const record = await page.evaluate((jobUrl) => {
          const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
          const getAll = (sel) => [...document.querySelectorAll(sel)].map(el => el.textContent.trim()).filter(Boolean);

          // Job title — usually the main h1
          let rawTitle = (getText('h1') || getText('[class*="title"]')).replace(/\n/g, ' ').trim();

          // Title often contains "en CompanyName" — split it
          let title = rawTitle;
          let companyFromTitle = '';
          const enMatch = rawTitle.match(/^(.+?)\s+en\s+(.+)$/);
          if (enMatch) {
            title = enMatch[1].trim();
            companyFromTitle = enMatch[2].trim();
          }

          // Company name
          let company = getText('[class*="company"] a, [data-testid*="company"], h2 a, [class*="org"]')
            || getText('[class*="company"]');
          company = company.replace(/Más trabajos de .*/i, '').replace(/\n/g, ' ').trim();
          if (!company) company = companyFromTitle;

          // Location
          const locationEl = document.querySelector('[class*="location"], [class*="country"]');
          const location = locationEl?.textContent?.trim() || 'Argentina';

          // Salary
          const salaryEl = [...document.querySelectorAll('span, div, p')].find(el =>
            /USD|ARS|\$/.test(el.textContent) && /\d/.test(el.textContent) && el.textContent.length < 100
          );
          const salary = (salaryEl?.textContent?.trim() || '')
            .replace(/Sueldo bruto/i, '').replace(/\n+/g, ' ').trim();

          // Skills/tags — look for tag-like elements
          const skills = getAll('[class*="tag"]:not([class*="Nuevo"]), [class*="skill"], [class*="tech"] span, [class*="badge"]:not(:empty)')
            .filter(s => !s.includes('Nuevo') && !s.includes('Responds') && !s.includes('Responde') && s.length < 30);

          // Seniority
          const bodyText = document.body.innerText.toLowerCase();
          let seniority = 'senior';
          if (bodyText.includes('staff')) seniority = 'staff';
          if (bodyText.includes('principal')) seniority = 'principal';
          if (bodyText.includes('lead') || bodyText.includes('líder')) seniority = 'lead';
          if (bodyText.includes('architect')) seniority = 'architect';
          if (bodyText.includes('manager') || bodyText.includes('director')) seniority = 'manager';

          // Description snippet
          const desc = document.querySelector('[class*="description"], [class*="body"], article')?.textContent?.trim()?.substring(0, 300) || '';

          return {
            title,
            company,
            location,
            salary,
            skills: skills.join(', '),
            seniority,
            profileUrl: jobUrl,
            description: desc,
            contact: '',
            source: 'getonbrd',
          };
        }, url);

        if (record.title) {
          records.push(record);
          console.log(`  ✓ ${record.title} @ ${record.company} — ${record.salary || 'no salary'}`);
        }
      } catch (err) {
        console.log(`  ✗ Failed: ${url} — ${err.message}`);
      }
    }

    return records;
  }

  async nextPage(page) {
    if (this.meta.iteration >= this.maxPages) {
      console.log(`[${this.taskName}] Reached max ${this.maxPages} pages`);
      return false;
    }

    // Go back to listing and try next page
    const listingUrl = this.sources()[0].url;
    const nextPageNum = this.meta.iteration + 1;
    const nextUrl = `${listingUrl}&page=${nextPageNum + 1}`;

    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Check if there are job links on this page
    const hasJobs = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/jobs/"]');
      return [...links].some(a => a.href.match(/\/jobs\/[^/]+\/[^/]+/));
    });

    if (!hasJobs) {
      console.log(`[${this.taskName}] No more jobs on page ${nextPageNum + 1}`);
      return false;
    }

    // Store the URL so next iteration picks it up
    this.meta.cursor = nextUrl;
    this.saveMeta();
    return true;
  }
}
