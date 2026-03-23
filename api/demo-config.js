module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const models = String(
    process.env.DEMO_MODELS_JSON ||
      JSON.stringify([
        { id: 'openai/gpt-4.1-mini', label: 'Asistente rapido' },
        { id: 'deepseek/deepseek-chat', label: 'Chat general' },
        { id: 'qwen/qwen3-32b', label: 'Razonamiento' },
      ])
  );

  return res.status(200).json({
    models: JSON.parse(models),
  });
};
