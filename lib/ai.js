// Gemini API (free tier key from Google AI Studio). Prompt (+ optional image) in, parsed JSON out.
export async function askJSON(prompt, image) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = image ? [{ inline_data: { mime_type: image.mime, data: image.data } }, { text: prompt }] : [{ text: prompt }];
  // Thinking off on 2.5 models keeps calls inside Netlify's free function time limits.
  const generationConfig = { responseMimeType: 'application/json', ...(model.startsWith('gemini-2.5') && { thinkingConfig: { thinkingBudget: 0 } }) };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || r.status));
  const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}
