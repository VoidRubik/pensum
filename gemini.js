// Raw fetch to the Gemini REST API. No SDK dependency. GEMINI_MODEL in .env
// overrides the default; pick it from the ListModels call (see PROJECT.md).
const DEFAULT_MODEL = 'gemini-2.5-flash';

async function callGemini({ contents, responseSchema, systemInstruction }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY not set');
    err.code = 'NO_KEY';
    throw err;
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    err.code = 'API_ERROR';
    throw err;
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const err = new Error('Gemini response had no text part');
    err.code = 'EMPTY_RESPONSE';
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Gemini response was not valid JSON');
    err.code = 'BAD_JSON';
    throw err;
  }
}

module.exports = { callGemini, DEFAULT_MODEL };
