const { authFromRequest } = require('../lib/auth');
const { consumeAnonymousAccess, consumePaidAccess } = require('../lib/access');
const { readJsonBody } = require('../lib/http');
const { estimateCostUsd, recordUsage } = require('../lib/usage');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const prompt = String(body.prompt || '').trim();
    const model = String(body.model || '').trim();
    const auth = authFromRequest(req);
    const accessToken = req.headers['x-access-token'] || body.access_token || null;
    const anonymousId = req.headers['x-demo-session'] || body.anonymous_id || null;

    if (!prompt) return res.status(400).json({ error: 'Prompt vacio' });
    if (!model) return res.status(400).json({ error: 'Modelo vacio' });

    const estimatedCostBeforeRequest = estimateCostUsd(prompt, 'x'.repeat(1200));
    let entitlement;

    if (auth || accessToken) {
      entitlement = await consumePaidAccess(
        { userId: auth?.sub || null, email: auth?.email || null, accessToken },
        estimatedCostBeforeRequest
      );
      if (!entitlement?.ok && anonymousId) {
        entitlement = await consumeAnonymousAccess(anonymousId, estimatedCostBeforeRequest);
      }
    } else {
      entitlement = await consumeAnonymousAccess(anonymousId, estimatedCostBeforeRequest);
    }

    if (!entitlement?.ok) {
      return res.status(402).json({
        error: 'No hay saldo suficiente para esta demo. Probá más tarde o realizá una compra.',
      });
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
          { role: 'system', content: 'Responde de forma clara, breve y util en espanol.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 400,
        stream: true,
      }),
    });

    if (!demoRes.ok) {
      const errorText = await demoRes.text();
      return res.status(502).json({ error: `Error del proveedor: ${errorText}` });
    }

    // Stream SSE to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let fullText = '';
    const reader = demoRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Record usage after stream completes
    await recordUsage({
      userId: auth?.sub || 'anonymous',
      email: auth?.email || null,
      model,
      prompt,
      response: fullText,
      source: 'demo-stream',
    });

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || 'No se pudo ejecutar la demo' });
    }
    res.end();
  }
};
