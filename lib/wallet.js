const { v4: uuidv4 } = require('uuid');
const { PAYMENTS_PATH, patchPayment, readPath, writePath } = require('./firebase');

const PACKAGE_CREDIT_USD = Number(process.env.PACKAGE_CREDIT_USD || 1);
const TRIAL_CREDIT_USD = Number(process.env.TRIAL_CREDIT_USD || 1);
const TRIAL_DURATION_DAYS = Number(process.env.TRIAL_DURATION_DAYS || 7);

async function listWalletRecords() {
  return (await readPath(PAYMENTS_PATH)) || {};
}

function normalizeWalletRecord(ref, payment) {
  return { ref, ...payment };
}

function isWalletActive(payment) {
  return !payment.expires_at || Number(payment.expires_at) > Date.now();
}

async function findApprovedWallets({ userId, email, accessToken }, options = {}) {
  const { includeExpired = false } = options;
  const payments = await listWalletRecords();
  return Object.entries(payments)
    .map(([ref, payment]) => normalizeWalletRecord(ref, payment))
    .filter((payment) => payment.status === 'approved')
    .filter((payment) => includeExpired || isWalletActive(payment))
    .filter((payment) => {
      if (accessToken && payment.access_token === accessToken) return true;
      if (userId && payment.user_id === userId) return true;
      if (email && payment.user_email === email) return true;
      return false;
    });
}

async function ensureWalletAccess(ref, payment) {
  const next = {
    ...payment,
    access_token: payment.access_token || uuidv4(),
    credit_limit_usd:
      typeof payment.credit_limit_usd === 'number' ? payment.credit_limit_usd : PACKAGE_CREDIT_USD,
    spent_estimated_usd: Number(payment.spent_estimated_usd || 0),
    usage_requests: Number(payment.usage_requests || payment.demo_requests || 0),
  };
  await patchPayment(ref, next);
  return normalizeWalletRecord(ref, next);
}

function summarizeWallet(records) {
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
        acc.trial.active = isWalletActive(record);
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

async function consumeWalletBalance(identity, estimatedCostUsd) {
  const records = await findApprovedWallets(identity);
  const hydrated = [];
  for (const record of records) {
    hydrated.push(await ensureWalletAccess(record.ref, record));
  }

  const usable = hydrated.find((record) => {
    const limit = Number(record.credit_limit_usd || 0);
    const spent = Number(record.spent_estimated_usd || 0);
    return limit - spent >= estimatedCostUsd;
  });

  if (!usable) {
    return { ok: false, summary: summarizeWallet(hydrated) };
  }

  const nextSpent = Number((Number(usable.spent_estimated_usd || 0) + estimatedCostUsd).toFixed(6));
  const nextUsageRequests = Number(usable.usage_requests || usable.demo_requests || 0) + 1;
  await patchPayment(usable.ref, {
    spent_estimated_usd: nextSpent,
    usage_requests: nextUsageRequests,
    last_used_at: Date.now(),
  });

  const updated = hydrated.map((record) =>
    record.ref === usable.ref
      ? { ...record, spent_estimated_usd: nextSpent, usage_requests: nextUsageRequests }
      : record
  );

  return {
    ok: true,
    summary: summarizeWallet(updated),
    access_token: usable.access_token,
  };
}

async function ensureTrialWallet(userId, email) {
  const ref = `trial-${userId}`;
  const existing = await readPath(`${PAYMENTS_PATH}/${ref}`);
  if (existing) return existing;

  const now = Date.now();
  const expiresAt = now + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

  const record = {
    status: 'approved',
    source: 'trial',
    user_id: userId,
    user_email: email,
    wallet_kind: 'trial',
    credit_limit_usd: TRIAL_CREDIT_USD,
    spent_estimated_usd: 0,
    usage_requests: 0,
    access_token: uuidv4(),
    created_at: now,
    paid_at: now,
    expires_at: expiresAt,
  };

  await writePath(`${PAYMENTS_PATH}/${ref}`, record);
  return record;
}

module.exports = {
  consumeWalletBalance,
  ensureTrialWallet,
  ensureWalletAccess,
  findApprovedWallets,
  isWalletActive,
  listWalletRecords,
  normalizeWalletRecord,
  summarizeWallet,
};
