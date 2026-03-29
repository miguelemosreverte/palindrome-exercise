/**
 * Human behavior emulation for Playwright.
 * Makes automated browsing indistinguishable from real human interaction.
 *
 * Based on:
 * - Bezier curves with Fitts's Law for mouse movement
 * - Gaussian micro-jitter for hand tremor
 * - Beta distribution for timing (natural clustering with outliers)
 * - Realistic typing with typos, bursts, and pauses
 * - Session rhythm with warm-up, breaks, and daily limits
 */

// ─── Random distributions ───────────────────────────────────────────────

/** Box-Muller transform for Gaussian distribution */
function gaussian(mean = 0, stddev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * stddev + mean;
}

/** Beta distribution — clusters naturally with occasional outliers */
function beta(alpha = 2, betaParam = 5) {
  // Jöhnk's algorithm for beta distribution
  function gammaSample(shape) {
    if (shape < 1) {
      return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do {
        x = gaussian();
        v = Math.pow(1 + c * x, 3);
      } while (v <= 0);
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  const x = gammaSample(alpha);
  const y = gammaSample(betaParam);
  return x / (x + y);
}

/** Random in range using beta distribution (more human than uniform) */
function betaRange(min, max, alpha = 2, betaParam = 5) {
  return min + beta(alpha, betaParam) * (max - min);
}

/** Uniform random in range */
function uniform(min, max) {
  return min + Math.random() * (max - min);
}

// ─── Mouse movement ─────────────────────────────────────────────────────

/**
 * Generate Bezier curve control points for natural mouse movement.
 * Uses Fitts's Law: movement time proportional to log2(distance/target_size + 1)
 */
function bezierControlPoints(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Add randomized control points for curve (not straight line)
  const cp1x = x1 + dx * uniform(0.2, 0.4) + gaussian(0, dist * 0.1);
  const cp1y = y1 + dy * uniform(0.2, 0.4) + gaussian(0, dist * 0.1);
  const cp2x = x1 + dx * uniform(0.6, 0.8) + gaussian(0, dist * 0.05);
  const cp2y = y1 + dy * uniform(0.6, 0.8) + gaussian(0, dist * 0.05);

  return { cp1x, cp1y, cp2x, cp2y };
}

/** Evaluate cubic Bezier at parameter t */
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Fitts's Law velocity profile: slow start → fast middle → slow approach.
 * Returns array of {x, y} points along the path.
 */
function generateMousePath(x1, y1, x2, y2) {
  const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const { cp1x, cp1y, cp2x, cp2y } = bezierControlPoints(x1, y1, x2, y2);

  // Number of steps proportional to distance (Fitts's Law)
  const steps = Math.max(10, Math.floor(20 + dist / 15));
  const points = [];

  for (let i = 0; i <= steps; i++) {
    // Non-linear t progression: slow-fast-slow (ease in-out)
    let t = i / steps;
    t = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    let x = bezierPoint(t, x1, cp1x, cp2x, x2);
    let y = bezierPoint(t, y1, cp1y, cp2y, y2);

    // Gaussian micro-jitter for hand tremor (stronger in middle of movement)
    const tremorFactor = Math.sin(t * Math.PI); // peak at middle
    x += gaussian(0, 0.8 * tremorFactor);
    y += gaussian(0, 0.8 * tremorFactor);

    points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  // 25% chance: overshoot and correct
  if (Math.random() < 0.25) {
    const overshootDist = uniform(3, 12);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    points.push({
      x: x2 + Math.cos(angle) * overshootDist + gaussian(0, 1),
      y: y2 + Math.sin(angle) * overshootDist + gaussian(0, 1),
    });
    // Correct back with 3-5 small steps
    const corrections = Math.floor(uniform(3, 6));
    const lastPoint = points[points.length - 1];
    for (let i = 1; i <= corrections; i++) {
      const ct = i / corrections;
      points.push({
        x: lastPoint.x + (x2 - lastPoint.x) * ct + gaussian(0, 0.3),
        y: lastPoint.y + (y2 - lastPoint.y) * ct + gaussian(0, 0.3),
      });
    }
  }

  return points;
}

// ─── Core actions ───────────────────────────────────────────────────────

/**
 * Move mouse along a human-like Bezier path to target coordinates.
 */
export async function humanMove(page, x, y) {
  const current = await page.evaluate(() => ({
    x: window._mouseX || window.innerWidth / 2,
    y: window._mouseY || window.innerHeight / 2,
  }));

  const path = generateMousePath(current.x, current.y, x, y);
  const dist = Math.sqrt((x - current.x) ** 2 + (y - current.y) ** 2);

  // Time per step: Fitts's Law — faster for longer distances (per step)
  const totalTime = 200 + dist * 1.5; // ms
  const stepDelay = totalTime / path.length;

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await sleep(stepDelay + gaussian(0, stepDelay * 0.2));
  }

  // Track position for next movement
  await page.evaluate(({ x, y }) => { window._mouseX = x; window._mouseY = y; }, { x, y });
}

/**
 * Human-like click: move to element, dwell, press with variable hold, pause after.
 */
export async function humanClick(page, selector, options = {}) {
  const el = typeof selector === 'string' ? await page.waitForSelector(selector, { timeout: 10000 }) : selector;
  const box = await el.boundingBox();
  if (!box) return;

  // Click at a random point within the element (not dead center)
  const x = box.x + box.width * uniform(0.3, 0.7);
  const y = box.y + box.height * uniform(0.3, 0.7);

  // Move to target
  await humanMove(page, x, y);

  // Pre-click dwell (reading/aiming)
  await sleep(betaRange(80, 300));

  // Click with variable hold duration
  const holdMs = uniform(60, 180);
  await page.mouse.down();
  await sleep(holdMs);
  await page.mouse.up();

  // Post-click processing pause (human reaction to page change)
  await sleep(betaRange(200, 800));
}

/**
 * Human-like typing with per-character variability, bursts, typos, and pauses.
 */
export async function humanType(page, selector, text) {
  if (selector) await humanClick(page, selector);
  await sleep(betaRange(200, 500)); // pause before typing

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    // 3% typo-and-backspace rate
    if (Math.random() < 0.03 && char.match(/[a-zA-Z]/)) {
      const typoChar = String.fromCharCode(char.charCodeAt(0) + Math.floor(uniform(-2, 3)));
      await page.keyboard.press(typoChar);
      await sleep(uniform(50, 150));
      await page.keyboard.press('Backspace');
      await sleep(uniform(100, 250));
    }

    // Type the actual character
    await page.keyboard.press(char);

    // Per-character delay: burst typing (fast) with occasional pauses
    if (char === ' ' || char === '.' || char === ',') {
      // Word/sentence boundary pause
      await sleep(betaRange(80, 300, 2, 3));
    } else if (Math.random() < 0.1) {
      // Occasional thinking pause mid-word
      await sleep(betaRange(150, 400));
    } else {
      // Normal typing speed: 30-90ms per char with bursts
      await sleep(uniform(30, 90));
    }

    i++;
  }
}

// ─── Scrolling ──────────────────────────────────────────────────────────

/**
 * Human-like scroll: momentum deceleration, direction changes, variable distance.
 */
export async function humanScroll(page, options = {}) {
  const { direction = 'down', distance = null } = options;
  const totalDistance = distance || Math.floor(betaRange(200, 800));
  const sign = direction === 'up' ? -1 : 1;

  let scrolled = 0;
  let velocity = uniform(40, 100); // initial momentum

  while (scrolled < totalDistance) {
    const step = Math.min(velocity, totalDistance - scrolled);
    await page.mouse.wheel(0, sign * step);
    scrolled += step;

    // Momentum deceleration
    velocity *= uniform(0.85, 0.95);
    if (velocity < 10) velocity = 10;

    await sleep(uniform(15, 40));

    // 5% chance of small direction change (scroll up briefly while scrolling down)
    if (Math.random() < 0.05 && scrolled < totalDistance * 0.8) {
      const backtrack = uniform(20, 60);
      await page.mouse.wheel(0, -sign * backtrack);
      await sleep(uniform(100, 250));
    }
  }

  // Post-scroll reading pause
  await sleep(betaRange(500, 2000));
}

// ─── Session management ─────────────────────────────────────────────────

export class Session {
  constructor(options = {}) {
    this.maxProfiles = options.maxProfiles || Math.floor(uniform(28, 36));
    this.maxSessionMs = uniform(90, 180) * 60 * 1000; // 1.5-3 hours
    this.profileCount = 0;
    this.startTime = Date.now();
    this.isWarmingUp = true;
    this.warmupProfiles = Math.floor(uniform(2, 5));

    console.log(`[session] Daily limit: ${this.maxProfiles} profiles, max session: ${Math.round(this.maxSessionMs / 60000)}min`);
  }

  /** Check if we should continue or take a break / stop */
  get canContinue() {
    if (this.profileCount >= this.maxProfiles) {
      console.log(`[session] Daily limit reached (${this.maxProfiles})`);
      return false;
    }
    if (Date.now() - this.startTime > this.maxSessionMs) {
      console.log(`[session] Session time limit reached`);
      return false;
    }
    return true;
  }

  /** Wait appropriate time between profile visits */
  async waitBetweenProfiles() {
    this.profileCount++;

    // Warm-up: slower at start
    if (this.profileCount <= this.warmupProfiles) {
      const warmupDelay = betaRange(8000, 20000, 2, 3);
      console.log(`[session] Warm-up ${this.profileCount}/${this.warmupProfiles}, waiting ${Math.round(warmupDelay / 1000)}s`);
      await sleep(warmupDelay);
      if (this.profileCount === this.warmupProfiles) this.isWarmingUp = false;
      return;
    }

    // Periodic break: every 8-15 profiles, take a 2-5 min break
    const breakInterval = Math.floor(uniform(8, 16));
    if (this.profileCount % breakInterval === 0) {
      const breakMs = uniform(120000, 300000); // 2-5 minutes
      console.log(`[session] Taking a ${Math.round(breakMs / 60000)}min break after ${this.profileCount} profiles...`);
      await sleep(breakMs);
      return;
    }

    // Normal delay between profiles: beta distribution (clustered 3-8s with outliers up to 15s)
    const delay = betaRange(3000, 15000, 2, 5);
    await sleep(delay);
  }
}

// ─── Page interaction helpers ───────────────────────────────────────────

/**
 * Read a page like a human: scroll through content with variable speed.
 */
export async function humanReadPage(page, options = {}) {
  const { minTime = 2000, maxTime = 8000 } = options;
  const readTime = betaRange(minTime, maxTime);
  const scrolls = Math.floor(readTime / 1500);

  for (let i = 0; i < scrolls; i++) {
    await humanScroll(page, { distance: Math.floor(uniform(150, 400)) });
    // Reading pause between scrolls
    await sleep(betaRange(800, 2500));
  }

  // Sometimes scroll back up to re-read something
  if (Math.random() < 0.15) {
    await humanScroll(page, { direction: 'up', distance: Math.floor(uniform(100, 300)) });
    await sleep(betaRange(500, 1500));
  }
}

/**
 * Navigate to a URL with human-like pre/post behavior.
 */
export async function humanNavigate(page, url) {
  // Small delay before navigation (like clicking a link after deciding)
  await sleep(betaRange(200, 600));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for page to settle + human reaction time
  await sleep(betaRange(1000, 3000));
}

// ─── Utility ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

export { sleep, betaRange, gaussian, uniform };
