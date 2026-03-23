async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function json(res, status, data) {
  res.status(status).json(data);
}

module.exports = { readJsonBody, json };
