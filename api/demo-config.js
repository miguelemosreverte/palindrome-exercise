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
    const PREFERRED_FIRST = [
      'meta-llama/Llama-4-Scout-17B-16E-Instruct',
      'meta-llama/Llama-3.3-70B-Instruct',
      'Qwen/Qwen3-32B',
      'mistralai/Mistral-Small',
    ];

    const models = (data.data || [])
      .filter((model) => Array.isArray(model.input_modalities) && model.input_modalities.includes('text'))
      .slice(0, 16)
      .map((model) => ({
        id: model.id,
        label: `${model.root || model.id} · $${model.pricing?.prompt ?? '?'} in / $${model.pricing?.completion ?? '?'} out`,
      }));

    // Sort: put fast/conversational models first
    models.sort((a, b) => {
      const aIdx = PREFERRED_FIRST.findIndex(p => a.id.includes(p));
      const bIdx = PREFERRED_FIRST.findIndex(p => b.id.includes(p));
      const aScore = aIdx >= 0 ? aIdx : 999;
      const bScore = bIdx >= 0 ? bIdx : 999;
      return aScore - bScore;
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
};
