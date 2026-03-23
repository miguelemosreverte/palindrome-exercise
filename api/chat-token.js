const { authFromRequest } = require('../lib/auth');
const { createJwt } = require('../lib/jwt');
const { readJsonBody } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authFromRequest(req);
  const body = await readJsonBody(req);
  const accessToken = req.headers['x-access-token'] || body.access_token || null;

  if (!auth && !accessToken) {
    return res.status(401).json({ error: 'Hace falta sesion o access token para abrir el chat.' });
  }

  const token = createJwt({
    sub: auth?.sub || null,
    email: auth?.email || null,
    role: auth?.role || 'token',
    access_token: accessToken,
  });

  return res.status(200).json({
    token,
    ws_url: process.env.CHAT_WS_URL || 'ws://localhost:8787',
  });
};
