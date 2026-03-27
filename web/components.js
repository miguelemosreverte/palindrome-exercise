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
      return '<div class="rc-timeline">' + items.map(function(item) {
        var date = item.date || item.year || item.fecha || '';
        var title = item.title || item.nombre || item.event || '';
        var desc = item.desc || item.descripcion || item.description || '';
        return '<div class="rc-timeline-item"><div class="rc-timeline-track"><div class="rc-timeline-dot"></div><div class="rc-timeline-line"></div></div>' +
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
      // Simple flat rendering for trees (full interactive tree needs more state)
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
        var icons = { done: '✅', working: '🔧', pending: '⏳', error: '🚨', blocked: '🚫' };
        var icon = icons[state] || '⏳';
        return '<div class="rc-status-item"><span class="rc-status-icon">' + icon + '</span><span>' + esc(label) + '</span></div>';
      }).join('') + '</div>';
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
    var parts = text.split(/(```\w+[\s\S]*?```)/);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var match = part.match(/^```(\w+)\n([\s\S]*?)```$/);
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
      '.rc-timeline { padding: 8px 0; }',
      '.rc-timeline-item { display: flex; gap: 12px; position: relative; padding-bottom: 20px; align-items: stretch; }',
      '.rc-timeline-item:last-child { padding-bottom: 0; }',
      '.rc-timeline-track { display: flex; flex-direction: column; align-items: center; width: 18px; flex-shrink: 0; }',
      '.rc-timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ocean, #316dff); border: 2px solid rgba(49,109,255,0.2); z-index: 1; flex-shrink: 0; }',
      '.rc-timeline-line { width: 2px; flex: 1; background: var(--line, rgba(0,0,0,0.08)); margin-top: 4px; }',
      '.rc-timeline-item:last-child .rc-timeline-line { display: none; }',
      '.rc-timeline-content { flex: 1; }',
      '.rc-timeline-date { font-size: 11px; font-weight: 700; color: var(--ocean, #316dff); margin-bottom: 2px; }',
      '.rc-timeline-title { font-size: 14px; font-weight: 700; line-height: 1.3; }',
      '.rc-timeline-desc { font-size: 12px; color: var(--slate, #56708a); line-height: 1.5; margin-top: 2px; }',
      '.rc-options { display: flex; flex-direction: column; gap: 8px; }',
      '.rc-option { display: flex; align-items: center; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line, rgba(0,0,0,0.08)); cursor: pointer; transition: all 0.15s; }',
      '.rc-option:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }',
      '.rc-option.selected { border-color: var(--ocean, #316dff); background: rgba(49,109,255,0.06); }',
      '.rc-option-body { flex: 1; }',
      '.rc-option-title { font-size: 14px; font-weight: 700; }',
      '.rc-option-desc { font-size: 12px; color: var(--slate, #56708a); margin-top: 2px; }',
      '.rc-option-arrow { font-size: 18px; color: var(--slate, #56708a); margin-left: 8px; }',
      '.rc-option.selected .rc-option-arrow { color: var(--ocean, #316dff); }',
      '.rc-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }',
      '.rc-card { padding: 14px; border-radius: 14px; border: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-card-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--slate, #56708a); font-weight: 700; }',
      '.rc-card-value { font-size: 22px; font-weight: 800; margin-top: 2px; }',
      '.rc-card-desc { font-size: 11px; color: var(--slate, #56708a); margin-top: 4px; }',
      '.rc-table { width: 100%; border-collapse: collapse; border-radius: 12px; overflow: hidden; border: 1px solid var(--line, rgba(0,0,0,0.08)); font-size: 13px; }',
      '.rc-table th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--slate, #56708a); font-weight: 700; text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-table td { padding: 8px 12px; border-bottom: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-table tr:last-child td { border-bottom: none; }',
      '.rc-steps { display: flex; flex-direction: column; }',
      '.rc-step { display: flex; gap: 14px; padding: 12px 0; border-top: 1px solid var(--line, rgba(0,0,0,0.08)); }',
      '.rc-step:first-child { border-top: none; }',
      '.rc-step-num { width: 32px; height: 32px; border-radius: 10px; background: var(--ocean, #316dff); color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; }',
      '.rc-step-body { flex: 1; }',
      '.rc-step-title { font-size: 14px; font-weight: 700; }',
      '.rc-step-desc { font-size: 12px; color: var(--slate, #56708a); margin-top: 2px; }',
      '.rc-tree-question { font-size: 15px; font-weight: 700; margin-bottom: 10px; }',
      '.rc-progress { margin: 8px 0; }',
      '.rc-progress-label { font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; margin-bottom: 6px; }',
      '.rc-progress-value { color: var(--ocean, #316dff); }',
      '.rc-progress-bar { height: 8px; border-radius: 4px; background: var(--line, rgba(0,0,0,0.08)); overflow: hidden; }',
      '.rc-progress-fill { height: 100%; border-radius: 4px; background: var(--ocean, #316dff); transition: width 0.3s; }',
      '.rc-progress-desc { font-size: 11px; color: var(--slate, #56708a); margin-top: 4px; }',
      '.rc-status-list { display: flex; flex-direction: column; gap: 6px; }',
      '.rc-status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 0; }',
      '.rc-status-icon { font-size: 16px; }',
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
      var siblings = el.parentElement.querySelectorAll('.rc-option');
      for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('selected');
      el.classList.add('selected');
      if (onSelectCallback) onSelectCallback(title, el);
    },
    setOnSelect: function(fn) { onSelectCallback = fn; },
    // Register a new component at runtime
    register: function(name, rendererFn) {
      RENDERERS[name] = rendererFn;
    },
  };

})(typeof window !== 'undefined' ? window : this);
