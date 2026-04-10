import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import path    from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Smart model routing ────────────────────────────────────────────────────────
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
// ──────────────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'GEMINI_API_KEY not set in .env' } });

  const { contents, systemInstruction } = req.body;
  const chainType = pickChain(contents);
  const models    = CHAINS[chainType];

  for (const model of models) {
    const { status, ok, data } = await callGemini(apiKey, model, contents, systemInstruction);

    if (ok) {
      console.log(`[Shivam AI] ✓ ${model} (${chainType})`);
      return res.json({ ...data, _model: model, _chain: chainType });
    }

    if (!FALLBACK_ON.has(status)) {
      return res.status(status).json(data);
    }

    console.log(`[Shivam AI] ${model} → ${status}, trying next…`);
  }

  res.status(429).json({
    error: { message: 'All models are currently rate-limited. Please wait a moment and try again.' },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Shivam AI backend → http://localhost:${PORT}\n`);
  console.log('  Model chain:');
  console.log('    Heavy  → gemini-2.5-pro  🧠  → 2.0-flash ⚡ → 1.5-flash 🪶');
  console.log('    Default→ gemini-2.0-flash ⚡  → 1.5-flash 🪶\n');
});
