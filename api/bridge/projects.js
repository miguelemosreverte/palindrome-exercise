// Projects API — manage multi-project registry
//
// POST   /api/bridge/projects        — register a project
// GET    /api/bridge/projects?session=ID  — list projects
// DELETE /api/bridge/projects?session=ID&project=PID — unregister
// PATCH  /api/bridge/projects        — update project activity

const { readPath, writePath, patchPath } = require('../../lib/firebase');

var BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
var PAIRS_PATH = 'mercadopago-bridge/bridge-pairs';
var PROJECTS_PATH = 'mercadopago-bridge/bridge-projects';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — list projects for a session
    if (req.method === 'GET') {
      var session = req.query.session;
      if (!session) return res.status(400).json({ error: 'session required' });

      var data = await readPath(PROJECTS_PATH + '/' + session);
      var projects = [];
      if (data) {
        var keys = Object.keys(data);
        for (var i = 0; i < keys.length; i++) {
          projects.push(Object.assign({ projectId: keys[i] }, data[keys[i]]));
        }
      }
      return res.json({ projects: projects });
    }

    // DELETE — unregister a project
    if (req.method === 'DELETE') {
      var session = req.query.session;
      var projectId = req.query.project;
      if (!session || !projectId) return res.status(400).json({ error: 'session and project required' });

      await writePath(PROJECTS_PATH + '/' + session + '/' + projectId, null);
      return res.json({ ok: true, deleted: projectId });
    }

    // PATCH — update project activity
    if (req.method === 'PATCH') {
      var body = req.body || {};
      var sessionId = body.sessionId;
      var projectId = body.projectId;
      if (!sessionId || !projectId) return res.status(400).json({ error: 'sessionId and projectId required' });

      await patchPath(PROJECTS_PATH + '/' + sessionId + '/' + projectId, {
        lastActiveAt: body.lastActiveAt || new Date().toISOString(),
      });
      return res.json({ ok: true });
    }

    // POST — register a project
    if (req.method === 'POST') {
      var body = req.body || {};
      var sessionId = body.sessionId;
      var projectId = body.projectId;
      var name = body.name;
      var path = body.path;

      if (!sessionId || !projectId || !name) {
        return res.status(400).json({ error: 'sessionId, projectId, and name required' });
      }

      var now = new Date().toISOString();
      await writePath(PROJECTS_PATH + '/' + sessionId + '/' + projectId, {
        name: name,
        path: path || null,
        pid: body.pid || null,
        registeredAt: now,
        lastActiveAt: now,
      });

      // Send Telegram notification
      var pair = await readPath(PAIRS_PATH + '/' + sessionId);
      if (pair && pair.chatId) {
        await sendTelegram(pair.chatId, '📂 Project registered: ' + name + ' (' + (path || 'no path') + ')');
      }

      return res.json({ ok: true, projectId: projectId });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Projects API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) return;
  var resp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
  return resp.json();
}
