/**
 * Reusable chart components — generate HTML for embedding in reports.
 *
 * All charts are responsive, update dynamically, and work without JS frameworks.
 * Pure HTML/CSS + Chart.js where needed.
 *
 * Components:
 *   - horizontalBar(data) — horizontal bar chart (good for text labels)
 *   - tagCloud(data) — sized tags (good for skills/keywords)
 *   - chartRow(charts) — responsive grid row of charts
 */

/**
 * Horizontal bar chart — pure CSS, no Chart.js needed.
 * Best for: domain distribution, seniority breakdown, top companies.
 * Labels on the left, bars on the right, counts at the end.
 *
 * @param {string} title
 * @param {{label: string, value: number, color?: string}[]} data
 * @param {object} options - { maxBars, barColor, id }
 */
export function horizontalBar(title, data, options = {}) {
  const { maxBars = 8, barColor = '#2c3e50', id = 'hbar-' + Math.random().toString(36).slice(2, 6) } = options;
  const items = data.slice(0, maxBars);
  const max = Math.max(...items.map(d => d.value), 1);

  const bars = items.map(d => {
    const pct = Math.round(d.value / max * 100);
    const color = d.color || barColor;
    return `<div class="hbar-row">
      <span class="hbar-label">${d.label}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="hbar-count">${d.value}</span>
    </div>`;
  }).join('');

  return `<div class="chart-card" id="${id}">
    <h4 class="chart-title">${title}</h4>
    ${bars}
  </div>`;
}

/**
 * Tag cloud — sized tags, no Chart.js needed.
 * Best for: skills, keywords, technologies.
 * Font size proportional to frequency.
 *
 * @param {string} title
 * @param {{label: string, value: number}[]} data
 * @param {object} options - { maxTags, id }
 */
export function tagCloud(title, data, options = {}) {
  const { maxTags = 20, id = 'cloud-' + Math.random().toString(36).slice(2, 6) } = options;
  const items = data.slice(0, maxTags);
  const max = Math.max(...items.map(d => d.value), 1);
  const min = Math.min(...items.map(d => d.value), 0);

  const tags = items.map(d => {
    const ratio = max > min ? (d.value - min) / (max - min) : 0.5;
    const size = 0.7 + ratio * 0.8; // 0.7rem to 1.5rem
    const opacity = 0.5 + ratio * 0.5;
    return `<span class="cloud-tag" style="font-size:${size}rem;opacity:${opacity}" title="${d.label}: ${d.value}">${d.label}</span>`;
  }).join(' ');

  return `<div class="chart-card" id="${id}">
    <h4 class="chart-title">${title}</h4>
    <div class="cloud-tags">${tags}</div>
  </div>`;
}

/**
 * Responsive row of charts — CSS grid, stacks on mobile.
 * @param {string[]} chartHtmls — array of chart HTML strings
 */
export function chartRow(chartHtmls) {
  return `<div class="chart-row">${chartHtmls.join('')}</div>`;
}

/** CSS for all chart components */
export const CHARTS_CSS = `
  .chart-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.8rem; margin: 1rem 0; }
  .chart-card { background: #fff; border: 1px solid #e0d8cf; border-radius: 8px; padding: 0.8rem; }
  .chart-title { font-family: 'Playfair Display', Georgia, serif; font-size: 0.9rem; font-weight: 700; color: #2c3e50; margin-bottom: 0.6rem; padding-bottom: 0.3rem; border-bottom: 1px solid #f0ebe4; }

  /* Horizontal bar */
  .hbar-row { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
  .hbar-label { font-size: 0.75rem; color: #555; width: 90px; text-align: right; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hbar-track { flex: 1; height: 16px; background: #f0ebe4; border-radius: 3px; overflow: hidden; }
  .hbar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; min-width: 2px; }
  .hbar-count { font-size: 0.7rem; color: #999; width: 24px; text-align: right; flex-shrink: 0; }

  /* Tag cloud */
  .cloud-tags { line-height: 2; text-align: center; }
  .cloud-tag { display: inline-block; padding: 0.1rem 0.4rem; margin: 0.1rem; background: #f0ebe4; border-radius: 3px; color: #2c3e50; cursor: default; transition: opacity 0.3s; }
  .cloud-tag:hover { opacity: 1 !important; background: #e0d8cf; }

  @media (max-width: 640px) {
    .chart-row { grid-template-columns: 1fr; }
    .hbar-label { width: 70px; font-size: 0.7rem; }
  }
`;
