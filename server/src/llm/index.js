// Thin, resilient LLM layer. The agent never depends on it: if it is missing or failing, the rules decider takes over.
const { GoogleGenerativeAI } = require('@google/generative-ai');
let sdk; let override = null;
const modelName = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const isConfigured = () => Boolean(override || process.env.GEMINI_API_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Tests inject a scripted fake: fn({system, prompt}) -> string
function setOverride(fn) { override = fn; }

function extractJSON(text) {
  if (!text) throw new Error('empty model output');
  let s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(s); } catch { /* try to locate the outermost object */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('model output was not JSON');
}

async function rawGenerate({ system, prompt, parts, json = true }) {
  if (override) return override({ system, prompt });
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('GEMINI_API_KEY not configured'), { code: 'LLM_NOT_CONFIGURED' });
  sdk = sdk || new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const m = sdk.getGenerativeModel({ model: modelName(), systemInstruction: system || undefined, generationConfig: { temperature: 0.1, ...(json ? { responseMimeType: 'application/json' } : {}) } });
  const res = await m.generateContent(parts || prompt);
  return res.response.text();
}

// Retries transient failures (429/5xx/network) with exponential backoff; validates JSON with an optional zod schema and one repair attempt.
async function generateJSON({ system, prompt, parts, schema, retries = 2 }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await rawGenerate({ system, prompt, parts });
      let obj;
      try { obj = extractJSON(text); }
      catch (e) {
        const fixed = await rawGenerate({ system, prompt: `${prompt}\n\nYour previous reply was not valid JSON. Reply again with ONE valid JSON object only. Previous reply:\n${String(text).slice(0, 1500)}` });
        obj = extractJSON(fixed);
      }
      if (schema) { const p = schema.safeParse(obj); if (!p.success) throw Object.assign(new Error('schema: ' + p.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ')), { code: 'LLM_SCHEMA' }); return p.data; }
      return obj;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || '');
      const transient = /429|500|502|503|504|overloaded|quota|rate|ECONN|ETIMEDOUT|fetch failed|network/i.test(msg);
      if (e.code === 'LLM_NOT_CONFIGURED') throw e;
      if (attempt < retries && (transient || e.code === 'LLM_SCHEMA')) { await sleep(transient ? 700 * 2 ** attempt : 0); continue; }
      break;
    }
  }
  throw lastErr;
}
module.exports = { isConfigured, generateJSON, rawGenerate, extractJSON, setOverride, modelName };
