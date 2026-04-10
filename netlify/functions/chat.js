// Smart model routing: Heavy → 2.5 Pro → 2.0 Flash → 1.5 Flash (fallback on 429/503)
//                      Default → 2.0 Flash → 1.5 Flash

const HEAVY_KEYWORDS = [
  'explain in detail', 'deep dive', 'step by step', 'from scratch',
  'write a complete', 'full implementation', 'comprehensive', 'in depth',
  'elaborate', 'architecture', 'design pattern', 'algorithm', 'thorough',
  'write me a full', 'build a', 'create a complete',
];

const CHAINS = {
  heavy:   ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
  default: ['gemini-2.0-flash', 'gemini-2.0-flash-lite'],
};

// 429 = rate limit, 503 = overloaded — both warrant fallback
const FALLBACK_ON = new Set([429, 503]);

function pickChain(contents) {
  const last = (contents.at(-1)?.parts?.[0]?.text || '').toLowerCase();
  const isHeavy = last.length > 300 || HEAVY_KEYWORDS.some(k => last.includes(k));
  return isHeavy ? 'heavy' : 'default';
}

async function callGemini(apiKey, model, contents, systemInstruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, systemInstruction }),
  });
  return { status: res.status, ok: res.ok, data: await res.json() };
}

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const json = (code, body) => ({
    statusCode: code,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: { message: 'GEMINI_API_KEY is not set.' } });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return json(400, { error: { message: 'Invalid JSON body' } }); }

  const { contents, systemInstruction } = body;
  const chainType = pickChain(contents);
  const models    = CHAINS[chainType];

  for (const model of models) {
    const { status, ok, data } = await callGemini(apiKey, model, contents, systemInstruction);

    if (ok) {
      // Attach which model actually answered so the frontend can display it
      return json(200, { ...data, _model: model, _chain: chainType });
    }

    if (!FALLBACK_ON.has(status)) {
      // Hard error (400, 401, 404…) — don't retry
      return json(status, data);
    }

    // Rate-limited / overloaded → try next model in chain
    console.log(`[Shivam AI] ${model} → ${status}, trying next…`);
  }

  // All models exhausted
  return json(429, {
    error: { message: 'All models are currently rate-limited. Please wait a moment and try again.' },
  });
};
