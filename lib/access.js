const { v4: uuidv4 } = require('uuid');
const { PAYMENTS_PATH, patchPath, patchPayment, readPath } = require('./firebase');

const ANON_PATH = 'mercadopago-bridge/demo-anonymous';
const PACKAGE_CREDIT_USD = Number(process.env.PACKAGE_CREDIT_USD || 1);
const FREE_DEMO_CREDIT_USD = Number(process.env.FREE_DEMO_CREDIT_USD || 0.05);
const FREE_DEMO_REQUESTS = Number(process.env.FREE_DEMO_REQUESTS || 3);

async function listPayments() {
  return (await readPath(PAYMENTS_PATH)) || {};
}

function normalizePayment(ref, payment) {
  return { ref, ...payment };
}

function isPaymentActive(payment) {
  return !payment.expires_at || Number(payment.expires_at) > Date.now();
}

async function findApprovedPayments({ userId, email, accessToken }) {
  const payments = await listPayments();
  return Object.entries(payments)
    .map(([ref, payment]) => normalizePayment(ref, payment))
    .filter((payment) => payment.status === 'approved')
    .filter(isPaymentActive)
    .filter((payment) => {
      if (accessToken && payment.access_token === accessToken) return true;
      if (userId && payment.user_id === userId) return true;
      if (email && payment.user_email === email) return true;
      return false;
    });
}

async function ensureApprovedPaymentAccess(ref, payment) {
  const next = {
    ...payment,
    access_token: payment.access_token || uuidv4(),
    credit_limit_usd:
      typeof payment.credit_limit_usd === 'number' ? payment.credit_limit_usd : PACKAGE_CREDIT_USD,
    spent_estimated_usd: Number(payment.spent_estimated_usd || 0),
    usage_requests: Number(payment.usage_requests || payment.demo_requests || 0),
  };
  await patchPayment(ref, next);
  return normalizePayment(ref, next);
}

function summarizePaidAccess(records) {
  return records.reduce(
    (acc, record) => {
      const limit = Number(record.credit_limit_usd || 0);
      const spent = Number(record.spent_estimated_usd || 0);
      acc.credit_limit_usd += limit;
      acc.spent_estimated_usd += spent;
      acc.remaining_usd += Math.max(limit - spent, 0);
      acc.requests += Number(record.usage_requests || record.demo_requests || 0);
      acc.tokens.push(record.access_token);
      if (record.wallet_kind === 'trial' || record.source === 'trial') {
        acc.trial.active = isPaymentActive(record);
        acc.trial.expires_at = record.expires_at || null;
      }
      return acc;
    },
    {
      credit_limit_usd: 0,
      spent_estimated_usd: 0,
      remaining_usd: 0,
      requests: 0,
      tokens: [],
      trial: {
        active: false,
        expires_at: null,
      },
    }
  );
}

async function consumePaidAccess(identity, estimatedCostUsd) {
  const records = await findApprovedPayments(identity);
  const hydrated = [];
  for (const record of records) {
    hydrated.push(await ensureApprovedPaymentAccess(record.ref, record));
  }

  const usable = hydrated.find((record) => {
    const limit = Number(record.credit_limit_usd || 0);
    const spent = Number(record.spent_estimated_usd || 0);
    return limit - spent >= estimatedCostUsd;
  });

  if (!usable) {
    return { ok: false, summary: summarizePaidAccess(hydrated) };
  }

  const nextSpent = Number((Number(usable.spent_estimated_usd || 0) + estimatedCostUsd).toFixed(6));
  await patchPayment(usable.ref, {
    spent_estimated_usd: nextSpent,
    usage_requests: Number(usable.usage_requests || usable.demo_requests || 0) + 1,
    last_used_at: Date.now(),
  });

  const updated = hydrated.map((record) =>
    record.ref === usable.ref
      ? { ...record, spent_estimated_usd: nextSpent, usage_requests: Number(record.usage_requests || record.demo_requests || 0) + 1 }
      : record
  );

  return {
    ok: true,
    summary: summarizePaidAccess(updated),
    access_token: usable.access_token,
  };
}

async function consumeAnonymousAccess(anonId, estimatedCostUsd) {
  if (!anonId) {
    return { ok: false, error: 'Falta identificador anonimo' };
  }

  const current =
    (await readPath(`${ANON_PATH}/${anonId}`)) || {
      requests: 0,
      spent_estimated_usd: 0,
      credit_limit_usd: FREE_DEMO_CREDIT_USD,
      requests_limit: FREE_DEMO_REQUESTS,
      created_at: Date.now(),
    };

  let nextSpent = Number((Number(current.spent_estimated_usd || 0) + estimatedCostUsd).toFixed(6));
  let nextRequests = Number(current.requests || 0) + 1;

  // Auto-reset if limits exceeded — demo should never stop working
  if (nextSpent > Number(current.credit_limit_usd || FREE_DEMO_CREDIT_USD) || nextRequests > Number(current.requests_limit || FREE_DEMO_REQUESTS)) {
    nextSpent = estimatedCostUsd;
    nextRequests = 1;
    current.spent_estimated_usd = 0;
    current.requests = 0;
  }

  const next = {
    ...current,
    spent_estimated_usd: nextSpent,
    requests: nextRequests,
    last_used_at: Date.now(),
  };

  await patchPath(`${ANON_PATH}/${anonId}`, next);
  return { ok: true, summary: next };
}

module.exports = {
  consumeAnonymousAccess,
  consumePaidAccess,
  ensureApprovedPaymentAccess,
  findApprovedPayments,
  summarizePaidAccess,
};
