const {
  createToken,
  isDefaultAdminLogin,
  isAdmin,
  publicUser,
  readUserByEmail,
  updateLastLogin,
  verifyPassword,
} = require('../../lib/auth');
const { readJsonBody } = require('../../lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);

    if (isDefaultAdminLogin(body.email, body.password)) {
      const token = createToken({
        sub: 'admin-root',
        email: 'admin',
        role: 'admin',
      });

      return res.status(200).json({
        token,
        user: {
          id: 'admin-root',
          email: 'admin',
          created_at: Date.now(),
          last_login_at: Date.now(),
        },
      });
    }

    const user = await readUserByEmail(body.email);

    if (!user || !verifyPassword(body.password, user)) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    await updateLastLogin(user.id);
    const token = createToken({
      sub: user.id,
      email: user.email,
      role: isAdmin(user.email) ? 'admin' : 'user',
    });

    return res.status(200).json({
      token,
      user: publicUser(user),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'No se pudo iniciar sesion' });
  }
};
