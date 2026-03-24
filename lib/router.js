/**
 * Client-side intent router.
 * Classifies user prompts to determine:
 * 1. Which components to emphasize in the system prompt
 * 2. Which model to use (fast for interactive, quality for complex)
 *
 * Zero latency — pure keyword matching, no LLM call.
 */

const ROUTES = [
  {
    intent: 'timeline',
    keywords: ['línea de tiempo', 'linea de tiempo', 'timeline', 'cronología', 'cronologia', 'historia de', 'eventos históricos', 'eventos historicos'],
    components: ['timeline', 'table'],
    model: 'quality',
  },
  {
    intent: 'tree',
    keywords: ['ayudame a elegir', 'ayudame a decidir', 'qué me recomendás', 'que me recomendas', 'decision tree', 'explorar opciones', 'guiame', 'qué debería', 'que deberia'],
    components: ['tree', 'options'],
    model: 'quality',
  },
  {
    intent: 'options',
    keywords: ['opciones', 'alternativas', 'recomendame', 'recomendá', 'sugeri', 'destinos', 'propone'],
    components: ['options', 'cards'],
    model: 'quality',
  },
  {
    intent: 'chart',
    keywords: ['gráfico', 'grafico', 'chart', 'barras', 'torta', 'pie', 'línea', 'visualiz'],
    components: ['chartjs'],
    model: 'quality',
  },
  {
    intent: 'table',
    keywords: ['tabla', 'table', 'comparar', 'comparación', 'comparacion', 'ranking', 'listado de datos'],
    components: ['table', 'cards'],
    model: 'quality',
  },
  {
    intent: 'steps',
    keywords: ['paso a paso', 'pasos', 'cómo hago', 'como hago', 'tutorial', 'instrucciones', 'proceso', 'guía', 'guia'],
    components: ['steps'],
    model: 'quality',
  },
  {
    intent: 'code',
    keywords: ['código', 'codigo', 'python', 'script', 'programar', 'ejecutar', 'correr', 'bash', 'terminal'],
    components: [],
    model: 'quality',
  },
  {
    intent: 'conversation',
    keywords: [],
    components: [],
    model: 'fast',
  },
];

const MODEL_MAP = {
  fast: { providerID: 'opencode', modelID: 'nemotron-3-super-free' },
  quality: { providerID: 'opencode', modelID: 'gpt-5-nano' },
};

function classifyIntent(text) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const route of ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
      return route;
    }
  }

  // Default: conversation
  return ROUTES[ROUTES.length - 1];
}

function getComponentHints(route) {
  if (!route.components.length) return '';
  return `\nPara esta respuesta, considerá usar especialmente: ${route.components.map(c => '```' + c).join(', ')}.`;
}

function getModel(route, userOverride) {
  if (userOverride) return userOverride;
  return MODEL_MAP[route.model] || MODEL_MAP.quality;
}

// For Node.js tests
if (typeof module !== 'undefined') {
  module.exports = { classifyIntent, getComponentHints, getModel, MODEL_MAP, ROUTES };
}
