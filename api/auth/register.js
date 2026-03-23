const { createToken, createUser, isAdmin, publicUser } = require('../../lib/auth');
const { readJsonBody } = require('../../lib/http');
const { grantWelcomeCredit } = require('../../lib/coupons');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const user = await createUser(body.email, body.password);
    const token = createToken({
      sub: user.id,
      email: user.email,
      role: isAdmin(user.email) ? 'admin' : 'user',
    });

    // Auto-grant $1 welcome credit
    await grantWelcomeCredit(user.id, user.email);

    return res.status(201).json({
      token,
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo crear la cuenta' });
  }
};
