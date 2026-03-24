const { authFromRequest } = require('../../lib/auth');
const { readPath } = require('../../lib/firebase');
const { readAllUserUsage } = require('../../lib/usage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authFromRequest(req);
  if (!auth || auth.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const users = (await readPath('mercadopago-bridge/users')) || {};
  const usageByUser = await readAllUserUsage();
  const topupUsd = Number(process.env.TOPUP_USD || 10);
  const root = (await readPath('mercadopago-bridge')) || {};

  const rows = Object.entries(users).map(([userId, user]) => {
    const usage = usageByUser[userId] || {
      requests: 0,
      prompt_chars: 0,
      response_chars: 0,
      estimated_cost_usd: 0,
      last_used_at: null,
    };

    return {
      user_id: userId,
      email: user.email,
      created_at: user.created_at,
      last_login_at: user.last_login_at,
      credit_limit_usd: 0,
      credit_spent_usd: 0,
      access_tokens: [],
      payments_count: 0,
      chats_count: 0,
      ...usage,
    };
  });

  const payments = (await readPath('mercadopago-bridge/payments')) || {};
  const walletBreakdown = {
    total_wallets: 0,
    trial_wallets: 0,
    paid_wallets: 0,
    coupon_wallets: 0,
    expired_wallets: 0,
    active_wallets: 0,
    active_trial_wallets: 0,
    active_paid_wallets: 0,
    active_coupon_wallets: 0,
  };
  for (const payment of Object.values(payments)) {
    if (payment.status === 'approved') {
      walletBreakdown.total_wallets += 1;
      if (payment.wallet_kind === 'trial' || payment.source === 'trial') {
        walletBreakdown.trial_wallets += 1;
      } else if (payment.wallet_kind === 'coupon' || payment.source === 'coupon') {
        walletBreakdown.coupon_wallets += 1;
      } else {
        walletBreakdown.paid_wallets += 1;
      }

      const expired = payment.expires_at && Number(payment.expires_at) <= Date.now();
      if (expired) {
        walletBreakdown.expired_wallets += 1;
      } else {
        walletBreakdown.active_wallets += 1;
        if (payment.wallet_kind === 'trial' || payment.source === 'trial') {
          walletBreakdown.active_trial_wallets += 1;
        } else if (payment.wallet_kind === 'coupon' || payment.source === 'coupon') {
          walletBreakdown.active_coupon_wallets += 1;
        } else {
          walletBreakdown.active_paid_wallets += 1;
        }
      }
    }

    if (payment.status !== 'approved' || !payment.user_id) continue;
    const row = rows.find((entry) => entry.user_id === payment.user_id);
    if (!row) continue;
    row.credit_limit_usd += Number(payment.credit_limit_usd || 0);
    row.credit_spent_usd += Number(payment.spent_estimated_usd || 0);
    row.payments_count += 1;
    if (payment.access_token) row.access_tokens.push(payment.access_token);
  }

  const chats = root.chats || {};
  for (const chat of Object.values(chats)) {
    if (!chat.owner_id) continue;
    const row = rows.find((entry) => entry.user_id === chat.owner_id);
    if (!row) continue;
    row.chats_count += 1;
  }

  for (const row of rows) {
    row.credit_remaining_usd = Number((row.credit_limit_usd - row.credit_spent_usd).toFixed(6));
  }

  const totals = rows.reduce(
    (acc, row) => {
      acc.users += 1;
      acc.requests += row.requests || 0;
      acc.prompt_chars += row.prompt_chars || 0;
      acc.response_chars += row.response_chars || 0;
      acc.estimated_cost_usd += row.estimated_cost_usd || 0;
      acc.credit_limit_usd += row.credit_limit_usd || 0;
      acc.credit_spent_usd += row.credit_spent_usd || 0;
      return acc;
    },
    { users: 0, requests: 0, prompt_chars: 0, response_chars: 0, estimated_cost_usd: 0, credit_limit_usd: 0, credit_spent_usd: 0 }
  );

  totals.estimated_cost_usd = Number(totals.estimated_cost_usd.toFixed(6));
  totals.credit_limit_usd = Number(totals.credit_limit_usd.toFixed(6));
  totals.credit_spent_usd = Number(totals.credit_spent_usd.toFixed(6));

  return res.status(200).json({
    budget: {
      topped_up_usd: topupUsd,
      estimated_spent_usd: totals.estimated_cost_usd,
      estimated_remaining_usd: Number((topupUsd - totals.estimated_cost_usd).toFixed(6)),
      utilization_pct: Number(((totals.estimated_cost_usd / topupUsd) * 100).toFixed(2)),
    },
    totals,
    users: rows.sort((a, b) => (b.estimated_cost_usd || 0) - (a.estimated_cost_usd || 0)),
    counts: {
      payments: Object.keys(root.payments || {}).length,
      chat_threads: Object.keys(root.chats || {}).length,
      usage_users: Object.keys(root.usage?.users || {}).length,
      usage_events: Object.keys(root.usage?.events || {}).length,
      wallet_records: walletBreakdown.total_wallets,
    },
    wallet_breakdown: walletBreakdown,
    payments: root.payments || {},
    chats: root.chats || {},
    usage_users: root.usage?.users || {},
    usage_events: root.usage?.events || {},
    raw_firebase: root,
  });
};
