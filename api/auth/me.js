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
