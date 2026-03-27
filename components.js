// Bridge Rich Components — shared renderer loaded by both Mini App and web chat.
// Add new components here. Both consumers auto-pick them up on next page load.
// To add a component WITHOUT redeploying: write its definition to Firebase at
//   mercadopago-bridge/bridge-components/{name}
// and it will be loaded dynamically at runtime.

(function(global) {
  'use strict';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
  }

  // Built-in component renderers
  var RENDERERS = {
    timeline: function(data) {
      var items = normalizeItems(data);
      return '<div class="rc-timeline">' + items.map(function(item, i) {
        var date = item.date || item.year || item.fecha || '';
        var title = item.title || item.nombre || item.event || '';
        var desc = item.desc || item.descripcion || item.description || '';
        var isLast = i === items.length - 1;
        return '<div class="rc-timeline-item' + (isLast ? ' rc-timeline-current' : '') + '"><div class="rc-timeline-track"><div class="rc-timeline-dot"></div><div class="rc-timeline-line"></div></div>' +
          '<div class="rc-timeline-content"><div class="rc-timeline-date">' + esc(date) + '</div><div class="rc-timeline-title">' + esc(title) + '</div>' +
          (desc ? '<div class="rc-timeline-desc">' + esc(desc) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    },

    options: function(data) {
      var items = normalizeItems(data);
      return '<div class="rc-options">' + items.map(function(item) {
        var title = item.title || item.nombre || item.opcion || '';
        var desc = item.desc || item.descripcion || item.description || '';
        return '<div class="rc-option" onclick="BridgeComponents.onSelect(this,\'' + esc(title).replace(/'/g, "\\'") + '\')"><div class="rc-option-body"><div class="rc-option-title">' + esc(title) + '</div>' +
          (desc ? '<div class="rc-option-desc">' + esc(desc) + '</div>' : '') + '</div><div class="rc-option-arrow">&rarr;</div></div>';
      }).join('') + '</div>';
    },

    cards: function(data) {
      var items = normalizeItems(data);
      return '<div class="rc-cards">' + items.map(function(item) {
        var label = item.label || item.etiqueta || item.title || '';
        var value = item.value || item.valor || '';
        var desc = item.desc || item.descripcion || item.description || '';
        return '<div class="rc-card"><div class="rc-card-label">' + esc(label) + '</div><div class="rc-card-value">' + esc(value) + '</div>' +
          (desc ? '<div class="rc-card-desc">' + esc(desc) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    },

    table: function(data) {
      var headers = data.headers || data.columnas || [];
      var rows = data.rows || data.filas || [];
      var html = '<table class="rc-table"><thead><tr>';
      for (var i = 0; i < headers.length; i++) html += '<th>' + esc(headers[i]) + '</th>';
      html += '</tr></thead><tbody>';
      for (var r = 0; r < rows.length; r++) {
        html += '<tr>';
        var row = rows[r];
        for (var c = 0; c < row.length; c++) html += '<td>' + esc(row[c]) + '</td>';
        html += '</tr>';
      }
      return html + '</tbody></table>';
    },

    steps: function(data) {
      var items = normalizeItems(data);
      return '<div class="rc-steps">' + items.map(function(item, i) {
        var title = item.title || item.nombre || item.paso || '';
        var desc = item.desc || item.descripcion || item.description || '';
        return '<div class="rc-step"><div class="rc-step-num">' + (i + 1) + '</div><div class="rc-step-body"><div class="rc-step-title">' + esc(title) + '</div>' +
          (desc ? '<div class="rc-step-desc">' + esc(desc) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    },

    tree: function(data) {
      var q = data.question || data.pregunta || '';
      var choices = data.choices || data.opciones || [];
      var html = '<div class="rc-tree">';
      if (q) html += '<div class="rc-tree-question">' + esc(q) + '</div>';
      html += '<div class="rc-options">';
      for (var i = 0; i < choices.length; i++) {
        var c = choices[i];
        var title = c.title || c.nombre || '';
        var desc = c.desc || c.descripcion || '';
        html += '<div class="rc-option" onclick="BridgeComponents.onSelect(this,\'' + esc(title).replace(/'/g, "\\'") + '\')"><div class="rc-option-body"><div class="rc-option-title">' + esc(title) + '</div>' +
          (desc ? '<div class="rc-option-desc">' + esc(desc) + '</div>' : '') + '</div><div class="rc-option-arrow">&rarr;</div></div>';
      }
      return html + '</div></div>';
    },

    progress: function(data) {
      var label = data.label || data.title || '';
      var value = Math.min(100, Math.max(0, Number(data.value || data.percent || 0)));
      var desc = data.desc || data.description || '';
      return '<div class="rc-progress">' +
        '<div class="rc-progress-label">' + esc(label) + ' <span class="rc-progress-value">' + value + '%</span></div>' +
        '<div class="rc-progress-bar"><div class="rc-progress-fill" style="width:' + value + '%"></div></div>' +
        (desc ? '<div class="rc-progress-desc">' + esc(desc) + '</div>' : '') +
        '</div>';
    },

    status: function(data) {
      var items = normalizeItems(data);
      return '<div class="rc-status-list">' + items.map(function(item) {
        var label = item.label || item.title || item.task || '';
        var state = item.state || item.status || 'pending';
        var icons = { done: '\u2705', working: '\uD83D\uDD27', pending: '\u23F3', error: '\uD83D\uDEA8', blocked: '\uD83D\uDEAB' };
        var icon = icons[state] || '\u23F3';
        return '<div class="rc-status-item"><span class="rc-status-icon">' + icon + '</span><span>' + esc(label) + '</span></div>';
      }).join('') + '</div>';
    },

    // --- NEW COMPONENTS ---

    quote: function(data) {
      var text = data.text || data.content || '';
      var author = data.author || data.source || '';
      var style = data.style || 'info';
      var colors = { info: '#316dff', warning: '#f59e0b', success: '#10b981', error: '#ef4444' };
      var bgColors = { info: 'rgba(49,109,255,0.06)', warning: 'rgba(245,158,11,0.06)', success: 'rgba(16,185,129,0.06)', error: 'rgba(239,68,68,0.06)' };
      var color = colors[style] || colors.info;
      var bg = bgColors[style] || bgColors.info;
      return '<div class="rc-quote" style="border-left:4px solid ' + color + ';background:' + bg + '">' +
        '<div class="rc-quote-text">' + esc(text) + '</div>' +
        (author ? '<div class="rc-quote-author">' + esc(author) + '</div>' : '') +
        '</div>';
    },

    diff: function(data) {
      var files = data.files || [];
      return '<div class="rc-diff">' + files.map(function(file) {
        var name = file.file || file.name || '';
        var adds = file.additions || 0;
        var dels = file.deletions || 0;
        var preview = file.preview || '';
        var lines = preview.split('\n');
        var linesHtml = lines.map(function(line) {
          var cls = 'rc-diff-ctx';
          if (line.charAt(0) === '+') cls = 'rc-diff-add';
          else if (line.charAt(0) === '-') cls = 'rc-diff-del';
          return '<div class="' + cls + '">' + esc(line) + '</div>';
        }).join('');
        return '<div class="rc-diff-file">' +
          '<div class="rc-diff-header"><span class="rc-diff-name">' + esc(name) + '</span>' +
          '<span class="rc-diff-stats"><span class="rc-diff-adds">+' + adds + '</span> <span class="rc-diff-dels">-' + dels + '</span></span></div>' +
          '<div class="rc-diff-body">' + linesHtml + '</div></div>';
      }).join('') + '</div>';
    },

    metrics: function(data) {
      var items = data.items || [];
      return '<div class="rc-metrics">' + items.map(function(item) {
        var label = item.label || '';
        var value = item.value || '';
        var trend = item.trend || 'flat';
        var change = item.change || '';
        var arrows = { up: '\u2191', down: '\u2193', flat: '\u2192' };
        var trendClass = trend === 'up' ? 'rc-trend-up' : (trend === 'down' ? 'rc-trend-down' : 'rc-trend-flat');
        return '<div class="rc-metric">' +
          '<div class="rc-metric-value">' + esc(value) + '</div>' +
          '<div class="rc-metric-label">' + esc(label) + '</div>' +
          (change ? '<div class="rc-metric-change ' + trendClass + '">' + arrows[trend] + ' ' + esc(change) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    },

    'avatar-list': function(data) {
      var items = data.items || [];
      return '<div class="rc-avatar-list">' + items.map(function(item) {
        var name = item.name || '';
        var role = item.role || '';
        var status = item.status || 'offline';
        var task = item.task || '';
        return '<div class="rc-avatar-item">' +
          '<div class="rc-avatar-dot rc-avatar-' + esc(status) + '"></div>' +
          '<div class="rc-avatar-info">' +
          '<div class="rc-avatar-name">' + esc(name) + ' <span class="rc-avatar-role">' + esc(role) + '</span></div>' +
          (task ? '<div class="rc-avatar-task">' + esc(task) + '</div>' : '') +
          '</div></div>';
      }).join('') + '</div>';
    },

    code: function(data) {
      var language = data.language || '';
      var code = data.code || '';
      var title = data.title || '';
      return '<div class="rc-code">' +
        '<div class="rc-code-header">' +
        (title ? '<span class="rc-code-title">' + esc(title) + '</span>' : '') +
        (language ? '<span class="rc-code-lang">' + esc(language) + '</span>' : '') +
        '</div>' +
        '<pre class="rc-code-body"><code>' + esc(code) + '</code></pre></div>';
    },

    alert: function(data) {
      var type = data.type || 'info';
      var title = data.title || '';
      var message = data.message || '';
      var icons = { info: '\u2139\uFE0F', warning: '\u26A0\uFE0F', error: '\uD83D\uDEA8', success: '\u2705' };
      var icon = icons[type] || icons.info;
      return '<div class="rc-alert rc-alert-' + esc(type) + '">' +
        '<div class="rc-alert-icon">' + icon + '</div>' +
        '<div class="rc-alert-content">' +
        '<div class="rc-alert-title">' + esc(title) + '</div>' +
        (message ? '<div class="rc-alert-message">' + esc(message) + '</div>' : '') +
        '</div></div>';
    },

    checklist: function(data) {
      var title = data.title || '';
      var items = data.items || [];
      return '<div class="rc-checklist">' +
        (title ? '<div class="rc-checklist-title">' + esc(title) + '</div>' : '') +
        items.map(function(item) {
          var text = item.text || item.label || '';
          var done = item.done || false;
          return '<label class="rc-checklist-item" onclick="BridgeComponents.onSelect(this,\'' + esc(text).replace(/'/g, "\\'") + '\')">' +
            '<input type="checkbox"' + (done ? ' checked' : '') + '> ' +
            '<span class="' + (done ? 'rc-checklist-done' : '') + '">' + esc(text) + '</span></label>';
        }).join('') +
        '</div>';
    },

    comparison: function(data) {
      var left = data.left || {};
      var right = data.right || {};
      var leftTitle = left.title || 'Option A';
      var rightTitle = right.title || 'Option B';
      var leftItems = left.items || [];
      var rightItems = right.items || [];
      return '<div class="rc-comparison">' +
        '<div class="rc-comparison-col">' +
        '<div class="rc-comparison-header">' + esc(leftTitle) + '</div>' +
        '<ul class="rc-comparison-list">' + leftItems.map(function(i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' +
        '</div>' +
        '<div class="rc-comparison-divider"></div>' +
        '<div class="rc-comparison-col">' +
        '<div class="rc-comparison-header">' + esc(rightTitle) + '</div>' +
        '<ul class="rc-comparison-list">' + rightItems.map(function(i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' +
        '</div></div>';
    },
  };

  // Chart.js renderer — lazy-loads Chart.js from CDN
  var chartCounter = 0;
  RENDERERS.chartjs = function(data) {
    var id = 'bridge-chart-' + (++chartCounter);
    // Load Chart.js if not already loaded
    if (!window.Chart && !document.getElementById('chartjs-cdn')) {
      var s = document.createElement('script');
      s.id = 'chartjs-cdn';
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      s.onload = function() { renderPendingCharts(); };
      document.head.appendChild(s);
    }
    // Queue chart for rendering after DOM insert
    setTimeout(function() { renderPendingCharts(); }, 100);
    return '<div style="margin:8px 0;border-radius:14px;background:white;padding:12px;border:1px solid var(--line,rgba(0,0,0,0.08));">' +
      '<canvas id="' + id + '" data-chart=\'' + JSON.stringify(data).replace(/'/g, '&#39;') + '\' style="max-height:300px;width:100%;"></canvas></div>';
  };

  function renderPendingCharts() {
    if (!window.Chart) return;
    var canvases = document.querySelectorAll('canvas[data-chart]');
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      if (c._chartRendered) continue;
      c._chartRendered = true;
      try {
        var config = JSON.parse(c.getAttribute('data-chart'));
        new Chart(c, config);
      } catch (e) {
        c.parentElement.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:6px;">Chart error: ' + esc(e.message) + '</div>';
      }
    }
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    return data.items || data.eventos || data.opciones || data.pasos || [];
  }

  // Dynamic component registry — loaded from Firebase at runtime
  var dynamicRenderers = {};

  function loadDynamicComponents(firebaseUrl, callback) {
    var url = firebaseUrl + '/mercadopago-bridge/bridge-components.json';
    fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      if (data) {
        Object.keys(data).forEach(function(name) {
          var def = data[name];
          if (def.template) {
            // Template-based component: {template: "<div>{{title}}</div>", itemKey: "items"}
            dynamicRenderers[name] = function(d) {
              var items = d[def.itemKey || 'items'] || (Array.isArray(d) ? d : []);
              return '<div class="rc-' + name + '">' + items.map(function(item) {
                var html = def.template;
                Object.keys(item).forEach(function(k) {
                  html = html.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), esc(item[k] || ''));
                });
                return html;
              }).join('') + '</div>';
            };
          }
        });
      }
      if (callback) callback();
    }).catch(function() {
      if (callback) callback();
    });
  }

  // Main render function
  function render(lang, jsonString) {
    try {
      var data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      var renderer = RENDERERS[lang] || dynamicRenderers[lang];
      if (renderer) return renderer(data);
      return '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';
    } catch (e) {
      return '<pre>' + esc(jsonString) + '</pre>';
    }
  }

  // Markdown parser that detects rich blocks
  function md(text) {
    if (!text) return '';
    var html = '';
    var parts = text.split(/(```\w[\w-]*[\s\S]*?```)/);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var match = part.match(/^```([\w-]+)\n([\s\S]*?)```$/);
      if (match && (RENDERERS[match[1]] || dynamicRenderers[match[1]])) {
        html += render(match[1], match[2].trim());
      } else {
        html += esc(part).replace(/\n/g, '<br>');
      }
    }
    return html;
  }

  // Get list of all registered component types
  function listComponents() {
    return Object.keys(RENDERERS).concat(Object.keys(dynamicRenderers));
  }

  // Selection callback — override this from the consuming page
  var onSelectCallback = function() {};

  // CSS for built-in components (injected once)
  function injectCSS() {
    if (document.getElementById('bridge-components-css')) return;
    var style = document.createElement('style');
    style.id = 'bridge-components-css';
    style.textContent = [
      /* --- Animations --- */
      '@keyframes rc-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }',
      '@keyframes rc-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(49,109,255,0.4); } 50% { box-shadow: 0 0 0 6px rgba(49,109,255,0); } }',
      '.rc-timeline, .rc-options, .rc-cards, .rc-table, .rc-steps, .rc-progress, .rc-status-list, .rc-quote, .rc-diff, .rc-metrics, .rc-avatar-list, .rc-code, .rc-alert, .rc-checklist, .rc-comparison { animation: rc-fade-in 0.3s ease-out; }',

      /* --- Timeline --- */
      '.rc-timeline { padding: 8px 0; }',
      '.rc-timeline-item { display: flex; gap: 12px; position: relative; padding-bottom: 20px; align-items: stretch; }',
      '.rc-timeline-item:last-child { padding-bottom: 0; }',
      '.rc-timeline-track { display: flex; flex-direction: column; align-items: center; width: 18px; flex-shrink: 0; }',
      '.rc-timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ocean, #316dff); border: 2px solid rgba(49,109,255,0.2); z-index: 1; flex-shrink: 0; transition: transform 0.2s; }',
      '.rc-timeline-current .rc-timeline-dot { animation: rc-pulse 2s infinite; }',
      '.rc-timeline-line { width: 2px; flex: 1; background: var(--line, rgba(0,0,0,0.08)); margin-top: 4px; }',
      '.rc-timeline-item:last-child .rc-timeline-line { display: none; }',
      '.rc-timeline-content { flex: 1; }',
      '.rc-timeline-date { font-size: 11px; font-weight: 700; color: var(--ocean, #316dff); margin-bottom: 2px; }',
      '.rc-timeline-title { font-size: 14px; font-weight: 700; line-height: 1.3; }',
      '.rc-timeline-desc { font-size: 12px; color: var(--slate, #56708a); line-height: 1.5; margin-top: 2px; }',

      /* --- Options --- */
      '.rc-options { display: flex; flex-direction: column; gap: 8px; }',
      '.rc-option { display: flex; align-items: center; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line, rgba(0,0,0,0.08)); cursor: pointer; transition: all 0.2s ease; }',
      '.rc-option:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.1); border-color: var(--ocean, #316dff); }',
      '.rc-option:active { transform: translateY(0); }',
      '.rc-option.selected { border-color: var(--ocean, #316dff); background: rgba(49,109,255,0.06); }',
      '.rc-option-body { flex: 1; }',
      '.rc-option-title { font-size: 14px; font-weight: 700; }',
      '.rc-option-desc { font-size: 12px; color: var(--slate, #56708a); margin-top: 2px; }',
      '.rc-option-arrow { font-size: 18px; color: var(--slate, #56708a); margin-left: 8px; transition: transform 0.2s; }',
      '.rc-option:hover .rc-option-arrow { transform: translateX(3px); }',
      '.rc-option.selected .rc-option-arrow { color: var(--ocean, #316dff); }',

      /* --- Cards --- */
      '.rc-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }',
      '.rc-card { padding: 14px; border-radius: 14px; border: 1px solid var(--line, rgba(0,0,0,0.08)); transition: all 0.2s ease; }',
      '.rc-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.08); }',
      '.rc-card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--slate, #56708a); font-weight: 700; }',
      '.rc-card-value { font-size: 22px; font-weight: 800; margin-top: 2px; }',
      '.rc-card-desc { font-size: 11px; color: var(--slate, #56708a); margin-top: 4px; }',

      /* --- Table --- */
      '.rc-table { width: 100%; border-collapse: collapse; border-radius: 12px; overflow: hidden; border: 1px solid var(--line, rgba(0,0,0,0.08)); font-size: 13px; }',
      '.rc-table th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--slate, #56708a); font-weight: 700; text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-table td { padding: 8px 12px; border-bottom: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-table tr:last-child td { border-bottom: none; }',
      '.rc-table tbody tr:nth-child(even) { background: rgba(0,0,0,0.02); }',
      '.rc-table tbody tr:hover { background: rgba(49,109,255,0.04); }',

      /* --- Steps --- */
      '.rc-steps { display: flex; flex-direction: column; }',
      '.rc-step { display: flex; gap: 14px; padding: 12px 0; border-top: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-step:first-child { border-top: none; }',
      '.rc-step-num { width: 32px; height: 32px; border-radius: 10px; background: linear-gradient(135deg, var(--ocean, #316dff), #5b8aff); color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; }',
      '.rc-step-body { flex: 1; }',
      '.rc-step-title { font-size: 14px; font-weight: 700; }',
      '.rc-step-desc { font-size: 12px; color: var(--slate, #56708a); margin-top: 2px; }',

      /* --- Tree --- */
      '.rc-tree-question { font-size: 15px; font-weight: 700; margin-bottom: 10px; }',

      /* --- Progress --- */
      '.rc-progress { margin: 8px 0; }',
      '.rc-progress-label { font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; margin-bottom: 6px; }',
      '.rc-progress-value { color: var(--ocean, #316dff); }',
      '.rc-progress-bar { height: 8px; border-radius: 4px; background: var(--line, rgba(0,0,0,0.08)); overflow: hidden; }',
      '.rc-progress-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--ocean, #316dff), #5b8aff); transition: width 0.3s; }',
      '.rc-progress-desc { font-size: 11px; color: var(--slate, #56708a); margin-top: 4px; }',

      /* --- Status --- */
      '.rc-status-list { display: flex; flex-direction: column; gap: 6px; }',
      '.rc-status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 0; }',
      '.rc-status-icon { font-size: 16px; }',

      /* --- Quote --- */
      '.rc-quote { padding: 14px 18px; border-radius: 8px; margin: 8px 0; }',
      '.rc-quote-text { font-size: 14px; line-height: 1.6; font-style: italic; }',
      '.rc-quote-author { font-size: 12px; color: var(--slate, #56708a); margin-top: 8px; font-style: italic; }',
      '.rc-quote-author::before { content: "\\2014 "; }',

      /* --- Diff --- */
      '.rc-diff { margin: 8px 0; border-radius: 12px; overflow: hidden; border: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-diff-file { border-bottom: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-diff-file:last-child { border-bottom: none; }',
      '.rc-diff-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0,0,0,0.03); font-size: 13px; font-weight: 600; }',
      '.rc-diff-name { font-family: "JetBrains Mono", monospace; font-size: 12px; }',
      '.rc-diff-stats { display: flex; gap: 8px; font-size: 12px; font-weight: 700; }',
      '.rc-diff-adds { color: #10b981; }',
      '.rc-diff-dels { color: #ef4444; }',
      '.rc-diff-body { font-family: "JetBrains Mono", monospace; font-size: 12px; line-height: 1.6; padding: 0; overflow-x: auto; }',
      '.rc-diff-add { background: rgba(16,185,129,0.1); color: #065f46; padding: 1px 14px; white-space: pre; }',
      '.rc-diff-del { background: rgba(239,68,68,0.1); color: #991b1b; padding: 1px 14px; white-space: pre; }',
      '.rc-diff-ctx { color: var(--slate, #56708a); padding: 1px 14px; white-space: pre; }',

      /* --- Metrics --- */
      '.rc-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }',
      '.rc-metric { padding: 16px; border-radius: 14px; border: 1px solid var(--line, rgba(0,0,0,0.08)); text-align: center; transition: all 0.2s; }',
      '.rc-metric:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.08); }',
      '.rc-metric-value { font-size: 28px; font-weight: 800; }',
      '.rc-metric-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--slate, #56708a); font-weight: 700; margin-top: 4px; }',
      '.rc-metric-change { font-size: 12px; font-weight: 700; margin-top: 6px; }',
      '.rc-trend-up { color: #10b981; }',
      '.rc-trend-down { color: #ef4444; }',
      '.rc-trend-flat { color: var(--slate, #56708a); }',

      /* --- Avatar List --- */
      '.rc-avatar-list { display: flex; flex-direction: column; gap: 8px; }',
      '.rc-avatar-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--line, rgba(0,0,0,0.08)); transition: all 0.2s; }',
      '.rc-avatar-item:hover { background: rgba(0,0,0,0.02); }',
      '.rc-avatar-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }',
      '.rc-avatar-online { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.2); }',
      '.rc-avatar-away { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.2); }',
      '.rc-avatar-offline { background: #94a3b8; box-shadow: 0 0 0 3px rgba(148,163,184,0.2); }',
      '.rc-avatar-info { flex: 1; }',
      '.rc-avatar-name { font-size: 14px; font-weight: 700; }',
      '.rc-avatar-role { font-size: 12px; color: var(--slate, #56708a); font-weight: 400; }',
      '.rc-avatar-task { font-size: 12px; color: var(--slate, #56708a); margin-top: 2px; }',

      /* --- Code --- */
      '.rc-code { margin: 8px 0; border-radius: 12px; overflow: hidden; border: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-code-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; background: #1e293b; }',
      '.rc-code-title { font-size: 12px; font-weight: 600; color: #e2e8f0; }',
      '.rc-code-lang { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; font-weight: 700; }',
      '.rc-code-body { margin: 0; padding: 14px; background: #0f172a; color: #e2e8f0; font-family: "JetBrains Mono", monospace; font-size: 13px; line-height: 1.6; overflow-x: auto; white-space: pre; }',
      '.rc-code-body code { font-family: inherit; }',

      /* --- Alert --- */
      '.rc-alert { display: flex; gap: 12px; padding: 14px 16px; border-radius: 12px; margin: 8px 0; }',
      '.rc-alert-info { background: rgba(49,109,255,0.08); border: 1px solid rgba(49,109,255,0.2); }',
      '.rc-alert-warning { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); }',
      '.rc-alert-error { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); }',
      '.rc-alert-success { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); }',
      '.rc-alert-icon { font-size: 18px; flex-shrink: 0; }',
      '.rc-alert-content { flex: 1; }',
      '.rc-alert-title { font-size: 14px; font-weight: 700; }',
      '.rc-alert-message { font-size: 13px; color: var(--slate, #56708a); margin-top: 4px; line-height: 1.5; }',

      /* --- Checklist --- */
      '.rc-checklist { margin: 8px 0; }',
      '.rc-checklist-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; }',
      '.rc-checklist-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background 0.15s; }',
      '.rc-checklist-item:hover { background: rgba(0,0,0,0.03); }',
      '.rc-checklist-item input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--ocean, #316dff); cursor: pointer; }',
      '.rc-checklist-done { text-decoration: line-through; color: var(--slate, #56708a); }',

      /* --- Comparison --- */
      '.rc-comparison { display: flex; gap: 0; margin: 8px 0; border-radius: 14px; border: 1px solid var(--line, rgba(0,0,0,0.08)); overflow: hidden; }',
      '.rc-comparison-col { flex: 1; padding: 16px; }',
      '.rc-comparison-divider { width: 1px; background: var(--line, rgba(0,0,0,0.08)); }',
      '.rc-comparison-header { font-size: 14px; font-weight: 800; margin-bottom: 12px; text-align: center; }',
      '.rc-comparison-list { list-style: none; margin: 0; padding: 0; }',
      '.rc-comparison-list li { font-size: 13px; padding: 6px 0; border-top: 1px solid var(--line, rgba(0,0,0,0.06)); }',
      '.rc-comparison-list li:first-child { border-top: none; }',
      '.rc-comparison-list li::before { content: "\\2022 "; color: var(--ocean, #316dff); font-weight: 700; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // Public API
  global.BridgeComponents = {
    render: render,
    md: md,
    list: listComponents,
    loadDynamic: loadDynamicComponents,
    injectCSS: injectCSS,
    onSelect: function(el, title) {
      var siblings = el.parentElement.querySelectorAll('.rc-option, .rc-checklist-item');
      if (el.classList.contains('rc-option')) {
        for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('selected');
        el.classList.add('selected');
      }
      if (onSelectCallback) onSelectCallback(title, el);
    },
    setOnSelect: function(fn) { onSelectCallback = fn; },
    // Register a new component at runtime
    register: function(name, rendererFn) {
      RENDERERS[name] = rendererFn;
    },
  };

})(typeof window !== 'undefined' ? window : this);
