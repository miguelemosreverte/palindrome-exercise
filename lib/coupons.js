const { v4: uuidv4 } = require('uuid');
const { readPath, writePath, patchPath } = require('./firebase');
const { ensureTrialWallet } = require('./wallet');

const COUPONS_PATH = 'mercadopago-bridge/coupons';
const PAYMENTS_PATH = 'mercadopago-bridge/payments';

async function getCoupon(code) {
  const sanitized = String(code || '').trim().toLowerCase();
  if (!sanitized) return null;
  return readPath(`${COUPONS_PATH}/${sanitized}`);
}

async function redeemCoupon(code, userId, email) {
  const sanitized = String(code || '').trim().toLowerCase();
  if (!sanitized) throw new Error('Código vacío');

  const coupon = await getCoupon(sanitized);
  if (!coupon) throw new Error('Código no válido');
  if (coupon.disabled) throw new Error('Este código ya no está activo');

  const maxUses = Number(coupon.max_uses || 0);
  const currentUses = Number(coupon.uses || 0);
  if (maxUses > 0 && currentUses >= maxUses) throw new Error('Este código ya alcanzó el límite de usos');

  // Check if user already redeemed this coupon
  const redemptionKey = `${sanitized}-${userId}`;
  const existingRedemption = await readPath(`${PAYMENTS_PATH}/${redemptionKey}`);
  if (existingRedemption) throw new Error('Ya canjeaste este código');

  const creditUsd = Number(coupon.amount_usd || 1);

  // Create credit record
  const record = {
    status: 'approved',
    source: 'coupon',
    coupon_code: sanitized,
    user_id: userId,
    user_email: email,
    wallet_kind: 'coupon',
    credit_limit_usd: creditUsd,
    spent_estimated_usd: 0,
    usage_requests: 0,
    access_token: uuidv4(),
    created_at: Date.now(),
    paid_at: Date.now(),
  };

  await writePath(`${PAYMENTS_PATH}/${redemptionKey}`, record);

  // Increment coupon usage
  await patchPath(`${COUPONS_PATH}/${sanitized}`, { uses: currentUses + 1 });

  return { credit_usd: creditUsd };
}

async function createCoupon(code, amountUsd, maxUses) {
  const sanitized = String(code || '').trim().toLowerCase();
  if (!sanitized) throw new Error('Código vacío');

  const coupon = {
    amount_usd: Number(amountUsd || 1),
    max_uses: Number(maxUses || 0), // 0 = unlimited
    uses: 0,
    created_at: Date.now(),
  };

  await writePath(`${COUPONS_PATH}/${sanitized}`, coupon);
  return coupon;
}

module.exports = {
  ensureTrialWallet,
  getCoupon,
  redeemCoupon,
  createCoupon,
};
