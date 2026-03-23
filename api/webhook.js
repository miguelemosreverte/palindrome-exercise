const { patchPayment, readPayment, writePayment } = require('../lib/firebase');
const { ensureApprovedPaymentAccess } = require('../lib/access');

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, data } = req.body;

    // MercadoPago sends different notification types
    if (type !== 'payment') {
      return res.status(200).json({ received: true });
    }

    // Fetch payment details from MercadoPago to verify
    const paymentId = data.id;
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
    });

    if (!mpResponse.ok) {
      console.error('Failed to fetch payment:', await mpResponse.text());
      return res.status(500).json({ error: 'Failed to verify payment' });
    }

    const payment = await mpResponse.json();
    const externalReference = payment.external_reference;

    if (!externalReference) {
      console.error('No external_reference in payment');
      return res.status(400).json({ error: 'Missing external_reference' });
    }

    const existingPayment = await readPayment(externalReference);

    if (payment.status === 'approved') {
      const payload = {
        ...(existingPayment || {}),
        status: 'approved',
        paid_amount: payment.transaction_amount,
        currency: payment.currency_id,
        paid_at: Date.now(),
        payment_id: paymentId,
      };
      await writePayment(externalReference, payload);
      await ensureApprovedPaymentAccess(externalReference, payload);
    } else {
      await patchPayment(externalReference, {
        status: payment.status,
        updated_at: Date.now(),
        payment_id: paymentId,
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
