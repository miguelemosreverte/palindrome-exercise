const { authFromRequest, publicUser, readUserByEmail } = require('../../lib/auth');
const { findApprovedWallets, summarizeWallet } = require('../../lib/wallet');
const { readUserUsage } = require('../../lib/usage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authFromRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  if (auth.role === 'admin' && auth.email === 'admin') {
    return res.status(200).json({
      user: {
        id: 'admin-root',
        email: 'admin',
        created_at: null,
        last_login_at: Date.now(),
      },
      usage: {
        requests: 0,
        prompt_chars: 0,
        response_chars: 0,
        estimated_cost_usd: 0,
        last_used_at: null,
      },
      access: {
        credit_limit_usd: 0,
        spent_estimated_usd: 0,
        remaining_usd: 0,
        requests: 0,
        tokens: [],
        trial: {
          active: false,
          expires_at: null,
        },
      },
      wallet: {
        credit_limit_usd: 0,
        spent_estimated_usd: 0,
        remaining_usd: 0,
        requests: 0,
        tokens: [],
        trial: {
          active: false,
          expires_at: null,
        },
      },
      role: 'admin',
    });
  }

  const user = await readUserByEmail(auth.email);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  const usage = await readUserUsage(auth.sub);
  const activePayments = await findApprovedWallets({
    userId: auth.sub,
    email: auth.email,
  });
  const allApprovedPayments = await findApprovedWallets(
    {
      userId: auth.sub,
      email: auth.email,
    },
    { includeExpired: true }
  );
  const access = summarizeWallet(activePayments);
  const trialRecord = allApprovedPayments
    .filter((payment) => payment.wallet_kind === 'trial' || payment.source === 'trial')
    .sort((a, b) => Number(b.expires_at || 0) - Number(a.expires_at || 0))[0];

  if (trialRecord) {
    const trialActive = !trialRecord.expires_at || Number(trialRecord.expires_at) > Date.now();
    access.trial = {
      active: trialActive,
      expired: !trialActive,
      expires_at: trialRecord.expires_at || null,
    };
  } else {
    access.trial = {
      active: false,
      expired: false,
      expires_at: null,
    };
  }

  return res.status(200).json({
    user: publicUser(user),
    usage,
    access,
    wallet: access,
    role: auth.role || 'user',
  });
};
