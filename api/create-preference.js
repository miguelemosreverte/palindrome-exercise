const { v4: uuidv4 } = require('uuid');
const { writePayment } = require('../lib/firebase');

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const externalReference = uuidv4();
    const frontendUrl = process.env.FRONTEND_URL || 'https://miguelemosreverte.github.io/palindrome-exercise';

    // Create MercadoPago preference
    const preferenceBody = {
      items: [
        {
          title: 'ChutesAI API Access',
          quantity: 1,
          unit_price: 500,
          currency_id: 'ARS',
        },
      ],
      back_urls: {
        success: `${frontendUrl}/success.html?ref=${externalReference}`,
        failure: `${frontendUrl}/index.html?status=failure`,
        pending: `${frontendUrl}/success.html?ref=${externalReference}&status=pending`,
      },
      auto_return: 'approved',
      external_reference: externalReference,
      notification_url: `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/webhook`,
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preferenceBody),
    });

    if (!mpResponse.ok) {
      const errorData = await mpResponse.json();
      console.error('MercadoPago error:', errorData);
      return res.status(500).json({ error: 'Failed to create payment preference' });
    }

    const preference = await mpResponse.json();

    // Write pending record to Firebase
    await writePayment(externalReference, {
      status: 'pending',
      created_at: Date.now(),
    });

    return res.status(200).json({
      init_point: preference.init_point,
      sandbox_init_point: preference.sandbox_init_point,
      external_reference: externalReference,
    });
  } catch (error) {
    console.error('Error creating preference:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
