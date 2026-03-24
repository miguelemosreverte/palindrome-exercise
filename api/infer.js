const { authFromRequest } = require('../lib/auth');
const { consumePaidAccess } = require('../lib/access');
const { readJsonBody } = require('../lib/http');
const { estimateCostUsd, recordUsage } = require('../lib/usage');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const auth = authFromRequest(req);
    const accessToken = req.headers['x-access-token'] || body.access_token || null;
    const model = String(body.model || '').trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
    const maxTokens = Math.min(Number(body.max_tokens || 500), 1200);

    if (!auth && !accessToken) {
      return res.status(401).json({
        error: 'Hace falta una cuenta autenticada o un access token de compra aprobada.',
      });
    }

    if (!model) {
      return res.status(400).json({ error: 'Modelo vacio' });
    }

    if (!messages.length) {
      return res.status(400).json({ error: 'Messages vacio' });
    }

    const prompt = messages
      .map((message) => `${message.role || 'user'}: ${message.content || ''}`)
      .join('\n');

    const estimatedReserveUsd = estimateCostUsd(prompt, 'x'.repeat(Math.min(maxTokens * 4, 2400)));
    const entitlement = await consumePaidAccess(
      {
        userId: auth?.sub || null,
        email: auth?.email || null,
        accessToken,
      },
      estimatedReserveUsd
    );

    if (!entitlement.ok) {
      return res.status(402).json({
        error: 'Saldo insuficiente para continuar con la inferencia.',
        entitlement: entitlement.summary,
      });
    }

    const providerBase = process.env.LLM_API_BASE;
    const providerKey = process.env.LLM_API_KEY;
    if (!providerBase || !providerKey) {
      return res.status(500).json({ error: 'LLM provider is not configured' });
    }
    const providerRes = await fetch(`${providerBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${providerKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!providerRes.ok) {
      const errorText = await providerRes.text();
      return res.status(502).json({ error: `Error del proveedor: ${errorText}` });
    }

    const data = await providerRes.json();
    const text =
      data.choices?.[0]?.message?.content ||
      data.output_text ||
      data.response ||
      '';

    const usage = await recordUsage({
      userId: auth?.sub || 'token',
      email: auth?.email || null,
      model,
      prompt,
      response: text,
      source: 'infer',
    });

    return res.status(200).json({
      id: data.id || null,
      model,
      text,
      raw: data,
      usage,
      entitlement: entitlement.summary,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'No se pudo ejecutar la inferencia' });
  }
};
