const { authFromRequest } = require('../../lib/auth');
const { readJsonBody } = require('../../lib/http');
const { redeemCoupon } = require('../../lib/coupons');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = authFromRequest(req);
    if (!auth) {
      return res.status(401).json({ error: 'Necesitás iniciar sesión para canjear un código' });
    }

    const body = await readJsonBody(req);
    const code = String(body.code || '').trim();
    if (!code) {
      return res.status(400).json({ error: 'Ingresá un código' });
    }

    const result = await redeemCoupon(code, auth.sub, auth.email);
    return res.status(200).json({
      message: `Código canjeado. Se acreditaron USD ${result.credit_usd.toFixed(2)}.`,
      credit_usd: result.credit_usd,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'No se pudo canjear el código' });
  }
};
