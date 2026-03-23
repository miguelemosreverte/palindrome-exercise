const { patchPath, pushPath, readPath } = require('./firebase');

const USAGE_EVENTS_PATH = 'mercadopago-bridge/usage/events';
const USER_USAGE_PATH = 'mercadopago-bridge/usage/users';

function estimateCostUsd(inputText = '', outputText = '') {
  const totalChars = String(inputText).length + String(outputText).length;
  return Number(((totalChars / 1000) * 0.002).toFixed(6));
}

async function recordUsage({
  userId = 'anonymous',
  email = null,
  model = 'default',
  prompt = '',
  response = '',
  source = 'demo',
}) {
  const now = Date.now();
  const estimated_cost_usd = estimateCostUsd(prompt, response);
  const prompt_chars = String(prompt).length;
  const response_chars = String(response).length;

  await pushPath(USAGE_EVENTS_PATH, {
    user_id: userId,
    email,
    model,
    source,
    prompt_chars,
    response_chars,
    estimated_cost_usd,
    created_at: now,
  });

  const current = (await readPath(`${USER_USAGE_PATH}/${userId}`)) || {
    requests: 0,
    prompt_chars: 0,
    response_chars: 0,
    estimated_cost_usd: 0,
    last_used_at: null,
    email,
  };

  const next = {
    email: email || current.email || null,
    requests: (current.requests || 0) + 1,
    prompt_chars: (current.prompt_chars || 0) + prompt_chars,
    response_chars: (current.response_chars || 0) + response_chars,
    estimated_cost_usd: Number(((current.estimated_cost_usd || 0) + estimated_cost_usd).toFixed(6)),
    last_used_at: now,
  };

  await patchPath(`${USER_USAGE_PATH}/${userId}`, next);
  return next;
}

async function readUserUsage(userId) {
  return (await readPath(`${USER_USAGE_PATH}/${userId}`)) || {
    requests: 0,
    prompt_chars: 0,
    response_chars: 0,
    estimated_cost_usd: 0,
    last_used_at: null,
  };
}

async function readAllUserUsage() {
  return (await readPath(USER_USAGE_PATH)) || {};
}

module.exports = {
  estimateCostUsd,
  readAllUserUsage,
  readUserUsage,
  recordUsage,
};
