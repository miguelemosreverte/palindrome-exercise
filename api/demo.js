const { authFromRequest } = require('../lib/auth');
const { readJsonBody } = require('../lib/http');
const { recordUsage } = require('../lib/usage');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const prompt = String(body.prompt || '').trim();
    const model = String(body.model || '').trim();
    const auth = authFromRequest(req);

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt vacio' });
    }

    if (!model) {
      return res.status(400).json({ error: 'Modelo vacio' });
    }

    const demoBase = process.env.DEMO_API_BASE || 'https://llm.chutes.ai/v1';
    const demoRes = await fetch(`${demoBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CHUTESAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Responde de forma clara, breve y util en espanol.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!demoRes.ok) {
      const errorText = await demoRes.text();
      return res.status(502).json({ error: `Error del proveedor demo: ${errorText}` });
    }

    const data = await demoRes.json();
    const text =
      data.choices?.[0]?.message?.content ||
      data.output_text ||
      data.response ||
      '';

    const usage = await recordUsage({
      userId: auth?.sub || 'anonymous',
      email: auth?.email || null,
      model,
      prompt,
      response: text,
      source: 'demo',
    });

    return res.status(200).json({
      model,
      text,
      usage,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'No se pudo ejecutar la demo' });
  }
};
