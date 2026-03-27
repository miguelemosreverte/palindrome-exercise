// Task Management API — create, list, get, cancel autonomous agent tasks
//
// POST   /api/bridge/tasks              — create a new task
// GET    /api/bridge/tasks?session=X    — list all tasks for session
// GET    /api/bridge/tasks?session=X&task=ID — get task details
// DELETE /api/bridge/tasks?session=X&task=ID — cancel a task

var { readPath, writePath, patchPath } = require('../../lib/firebase');

var TASKS_PATH = 'mercadopago-bridge/bridge-tasks';
var PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';

// Built-in skill templates (mirror of skill-registry.sh for server-side use)
var SKILL_TEMPLATES = {
  research_pipeline: function (params) {
    var query = params.query || params.q || 'topic';
    return [
      { name: 'search', prompt: 'Use Playwright browser to go to google.com and search for "' + query + '". Read the first 5 results. Format as: Source, Title, URL, Summary (one line each).', status: 'pending', result: null },
      { name: 'collect', prompt: 'From the search results in {{results.search}}, extract structured data: Name, Location, Skills, Source URL. Format as a clean list.', status: 'pending', result: null },
      { name: 'csv', prompt: 'Take this data:\n{{results.collect}}\n\nFormat as CSV with headers: ' + (params.headers || 'Name,Location,Skills,Source') + '. Output ONLY the CSV text, no markdown.', status: 'pending', result: null },
      { name: 'chart', prompt: 'Given this CSV data:\n{{results.csv}}\n\nGenerate a ```chartjs ' + (params.chartType || 'bar') + ' chart. Output ONLY the chartjs block.', status: 'pending', result: null },
      { name: 'summary', prompt: 'Summarize this data concisely:\n{{results.csv}}\n\nFormat as a ```cards block with 4 key metrics.', status: 'pending', result: null },
    ];
  },
  hr_search: function (params) {
    var role = params.role || 'developer';
    var region = params.region || 'LATAM';
    return [
      { name: 'search', prompt: 'Use Playwright browser to go to google.com and search for "' + role + ' developers in ' + region + ' LinkedIn GitHub". Read the first 5 results. Format as: Source, Title, URL, Summary (one line each).', status: 'pending', result: null },
      { name: 'collect', prompt: 'From the search results in {{results.search}}, extract candidate names, locations, skills, and profile URLs. Format as a structured list.', status: 'pending', result: null },
      { name: 'enrich', prompt: 'For each candidate in {{results.collect}}, search for more details about their experience and projects. Add years of experience and notable projects.', status: 'pending', result: null },
      { name: 'csv', prompt: 'Take this data:\n{{results.enrich}}\n\nFormat as CSV with headers: Name,Location,Skills,Experience,Projects,Source. Output ONLY the CSV text, no markdown.', status: 'pending', result: null },
      { name: 'chart', prompt: 'Given this CSV data:\n{{results.csv}}\n\nGenerate a ```chartjs bar chart. Output ONLY the chartjs block.', status: 'pending', result: null },
    ];
  },
  competitive_analysis: function (params) {
    var company = params.company || params.query || 'company';
    return [
      { name: 'search', prompt: 'Use Playwright browser to go to google.com and search for "' + company + ' competitors market analysis 2026". Read the first 5 results. Format as: Source, Title, URL, Summary (one line each).', status: 'pending', result: null },
      { name: 'details', prompt: 'From the search results in {{results.search}}, extract company details, revenue, market share, key products for each competitor.', status: 'pending', result: null },
      { name: 'compare', prompt: 'Compare these items:\n{{results.details}}\n\nCriteria: market share, growth, product range\nFormat as a ```table block with a score column.', status: 'pending', result: null },
      { name: 'summary', prompt: 'Summarize this data concisely:\n{{results.compare}}\n\nFormat as a ```cards block with 4 key metrics.', status: 'pending', result: null },
    ];
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- GET: list or get task ---
  if (req.method === 'GET') {
    var session = req.query.session;
    if (!session) return res.status(400).json({ error: 'session required' });

    var taskId = req.query.task;
    if (taskId) {
      var task = await readPath(TASKS_PATH + '/' + taskId);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      if (task.sessionId !== session) return res.status(403).json({ error: 'Not your task' });
      return res.json({ task: task });
    }

    // List all tasks — read the full tasks node, filter by session
    var allTasks = await readPath(TASKS_PATH);
    var sessionTasks = [];
    if (allTasks) {
      for (var id in allTasks) {
        if (allTasks[id] && allTasks[id].sessionId === session) {
          sessionTasks.push(Object.assign({ id: id }, allTasks[id]));
        }
      }
    }
    // Sort newest first
    sessionTasks.sort(function (a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return res.json({ tasks: sessionTasks });
  }

  // --- DELETE: cancel a task ---
  if (req.method === 'DELETE') {
    var session = req.query.session;
    var taskId = req.query.task;
    if (!session || !taskId) return res.status(400).json({ error: 'session and task required' });

    var task = await readPath(TASKS_PATH + '/' + taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.sessionId !== session) return res.status(403).json({ error: 'Not your task' });

    await patchPath(TASKS_PATH + '/' + taskId, {
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true, status: 'cancelled' });
  }

  // --- POST: create a new task ---
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var sessionId = body.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    var goal = body.goal;
    if (!goal) return res.status(400).json({ error: 'goal required' });

    var steps = body.steps || null;

    // If skill is provided, generate steps from template
    if (!steps && body.skill) {
      var skillFn = SKILL_TEMPLATES[body.skill];
      if (!skillFn) return res.status(400).json({ error: 'Unknown skill: ' + body.skill, available: Object.keys(SKILL_TEMPLATES) });
      steps = skillFn(body.params || {});
    }

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'steps[] or skill required' });
    }

    // Normalize steps
    steps = steps.map(function (s) {
      return {
        name: s.name || 'step',
        prompt: s.prompt || '',
        status: 'pending',
        result: null,
      };
    });

    var taskId = 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    var task = {
      goal: goal,
      sessionId: sessionId,
      status: 'pending',
      currentStep: 0,
      steps: steps,
      results: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writePath(TASKS_PATH + '/' + taskId, task);

    return res.json({ ok: true, taskId: taskId, steps: steps.length });
  } catch (err) {
    console.error('Tasks API error:', err);
    return res.status(500).json({ error: err.message });
  }
};
