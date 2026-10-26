// Gemini API (free tier key from Google AI Studio).
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const BUSY = [429, 500, 503];
const wait = ms => new Promise(r => setTimeout(r, ms));

// Gemini is sometimes "experiencing high demand" (503). Retry twice, then try GEMINI_FALLBACK_MODEL if set.
async function call(body) {
  const models = [MODEL(), process.env.GEMINI_FALLBACK_MODEL].filter(Boolean);
  let last;
  for (const model of models) for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wait(attempt * 1500);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j.candidates?.[0] || {};
    last = new Error('Gemini: ' + (j.error?.message || r.status));
    if (!BUSY.includes(r.status)) throw last; // a real error (bad key, bad request): no point retrying
  }
  throw new Error(`Gemini is busy right now. ${last.message.replace(/^Gemini: /, 'Google said: ')} Try again in a minute, or set GEMINI_FALLBACK_MODEL in Netlify.`);
}
const textOf = c => (c.content?.parts || []).map(p => p.text || '').join('').trim();

// Prompt (+ optional image or PDF) in, parsed JSON out.
export async function askJSON(prompt, file) {
  const parts = file ? [{ inline_data: { mime_type: file.mime, data: file.data } }, { text: prompt }] : [{ text: prompt }];
  const t = textOf(await call({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json' } }));
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

// Chat: system text + history in, answer + real web sources (from Google Search grounding) out.
export async function askText(system, history, search) {
  const body = tools => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    ...(tools && { tools: [{ google_search: {} }] }),
  });
  let c;
  try { c = await call(body(search)); }
  catch (e) { if (!search) throw e; c = await call(body(false)); } // ponytail: search grounding is not on every model/tier; answer without it
  const text = textOf(c);
  if (!text) throw new Error('Gemini sent an empty answer. Please ask again.');
  const sources = (c.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(w => w?.uri)
    .slice(0, 6).map(w => ({ url: w.uri, title: w.title || 'source' }));
  return { text, sources };
}
