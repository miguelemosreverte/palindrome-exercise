import { chromium } from 'playwright';
import { getChromeCookes } from './chrome-cookies.js';

/**
 * Launch a Playwright browser with the user's real Chrome cookies injected.
 * The user stays logged in to their sites — no separate auth needed.
 *
 * @param {object} options
 * @param {string} options.domain - Cookie domain to inject (e.g. '.linkedin.com', '.youtube.com')
 * @param {boolean} options.headless - Run headless (default: false for debugging)
 * @param {string} options.locale - Browser locale (default: 'en-US')
 * @returns {{ browser, context, page, close: () => Promise<void> }}
 */
export async function createBrowser(options = {}) {
  const {
    domain,
    headless = process.env.HEADLESS !== 'false',
    locale = 'en-US',
  } = options;

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Inject cookies from Chrome if domain specified
  if (domain) {
    const cookies = await getChromeCookes(domain);
    if (cookies.length === 0) {
      console.log(`[browser] Warning: no cookies found for ${domain}`);
    } else {
      const clean = cookies
        .filter(c => c.name && c.value && c.domain)
        .map(c => {
          const o = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/' };
          if (c.secure) o.secure = true;
          if (c.httpOnly) o.httpOnly = true;
          if (c.expires && c.expires > 0) o.expires = c.expires;
          if (c.sameSite === 'None' && c.secure) o.sameSite = 'None';
          else if (c.sameSite === 'Strict') o.sameSite = 'Strict';
          else o.sameSite = 'Lax';
          return o;
        });
      await context.addCookies(clean);
      console.log(`[browser] Injected ${clean.length} cookies for ${domain}`);
    }
  }

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    close: () => browser.close(),
  };
}
