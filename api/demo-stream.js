const { authFromRequest } = require('../lib/auth');
const { consumeAnonymousAccess, consumePaidAccess } = require('../lib/access');
const { readJsonBody } = require('../lib/http');
const { estimateCostUsd, recordUsage } = require('../lib/usage');

const PREFERRED_FIRST = [
  'mistralai/Mistral-Small',
  'mistralai/Mistral',
  'meta-llama/Llama-4-Scout-17B-16E-Instruct',
  'Qwen/Qwen3-32B',
];

async function handleGetModels(req, res) {
  try {
    const demoBase = process.env.DEMO_API_BASE || 'https://llm.chutes.ai/v1';
    const response = await fetch(`${demoBase}/models`, {
      headers: { Authorization: `Bearer ${process.env.CHUTESAI_API_KEY}` },
    });
    if (!response.ok) throw new Error(`${response.status}`);
    const data = await response.json();
    const models = (data.data || [])
      .filter((m) => Array.isArray(m.input_modalities) && m.input_modalities.includes('text'))
      .slice(0, 16)
      .map((m) => ({ id: m.id, label: `${m.root || m.id} · $${m.pricing?.prompt ?? '?'} in / $${m.pricing?.completion ?? '?'} out` }));
    models.sort((a, b) => {
      const aS = PREFERRED_FIRST.findIndex(p => a.id.includes(p));
      const bS = PREFERRED_FIRST.findIndex(p => b.id.includes(p));
      return (aS >= 0 ? aS : 999) - (bS >= 0 ? bS : 999);
    });
    return res.status(200).json({ models });
  } catch (error) {
    return res.status(200).json({
      models: [
        { id: 'Qwen/Qwen3-32B-TEE', label: 'Qwen/Qwen3-32B' },
        { id: 'deepseek-ai/DeepSeek-V3.2-TEE', label: 'DeepSeek V3.2' },
        { id: 'chutesai/Mistral-Small-3.1-24B-Instruct-2503-TEE', label: 'Mistral Small 3.1' },
      ],
      warning: error.message,
    });
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return handleGetModels(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const prompt = String(body.prompt || '').trim();
    const model = String(body.model || '').trim();
    const history = Array.isArray(body.messages) ? body.messages : [];
    const auth = authFromRequest(req);
    const accessToken = req.headers['x-access-token'] || body.access_token || null;
    const anonymousId = req.headers['x-demo-session'] || body.anonymous_id || null;

    if (!prompt && !history.length) return res.status(400).json({ error: 'Prompt vacio' });
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
          { role: 'system', content: `Responde de forma clara, breve y util en espanol.

Tenés acceso a herramientas. Cuando necesites usarlas, escribí el bloque correspondiente:

1. **Búsqueda web**: Para buscar información actual, escribí:
<web_search>tu consulta de búsqueda</web_search>
El sistema va a ejecutar la búsqueda y darte los resultados. Después sintetizá la respuesta.

2. **Python**: Para ejecutar código Python (cálculos, análisis, etc), escribí:
<python>
tu código python aquí
</python>
El código se ejecuta en el navegador con Pyodide. Podés usar numpy, pandas. Usá print() para mostrar resultados.

3. **Gráficos**: Para generar un gráfico, escribí un bloque JSON de Chart.js:
<chart>
{"type":"bar","data":{"labels":["A","B","C"],"datasets":[{"label":"Datos","data":[10,20,30]}]}}
</chart>

Usá las herramientas cuando sea útil. Podés combinarlas en una misma respuesta.` },
          ...history.map(m => ({ role: m.role, content: m.content })),
          ...(prompt ? [{ role: 'user', content: prompt }] : []),
        ],
        temperature: 0.7,
        max_tokens: 2048,
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
