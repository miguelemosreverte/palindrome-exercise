module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const demoBase = process.env.DEMO_API_BASE || 'https://llm.chutes.ai/v1';
    const response = await fetch(`${demoBase}/models`, {
      headers: {
        Authorization: `Bearer ${process.env.CHUTESAI_API_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`No se pudo obtener el catalogo de modelos: ${response.status}`);
    }

    const data = await response.json();
    const models = (data.data || [])
      .filter((model) => Array.isArray(model.input_modalities) && model.input_modalities.includes('text'))
      .slice(0, 12)
      .map((model) => ({
        id: model.id,
        label: `${model.root || model.id} · $${model.pricing?.prompt ?? '?'} in / $${model.pricing?.completion ?? '?'} out`,
      }));

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
};
