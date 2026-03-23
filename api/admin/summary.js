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
      ...usage,
    };
  });

  const payments = (await readPath('mercadopago-bridge/payments')) || {};
  for (const payment of Object.values(payments)) {
    if (payment.status !== 'approved' || !payment.user_id) continue;
    const row = rows.find((entry) => entry.user_id === payment.user_id);
    if (!row) continue;
    row.credit_limit_usd += Number(payment.credit_limit_usd || 0);
    row.credit_spent_usd += Number(payment.spent_estimated_usd || 0);
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
  });
};
