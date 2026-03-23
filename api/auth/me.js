const { authFromRequest, publicUser, readUserByEmail } = require('../../lib/auth');
const { findApprovedPayments, summarizePaidAccess } = require('../../lib/access');
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
      },
      role: 'admin',
    });
  }

  const user = await readUserByEmail(auth.email);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  const usage = await readUserUsage(auth.sub);
  const access = summarizePaidAccess(
    await findApprovedPayments({
      userId: auth.sub,
      email: auth.email,
    })
  );
  return res.status(200).json({
    user: publicUser(user),
    usage,
    access,
    role: auth.role || 'user',
  });
};
