// Raw fetch to the Gemini REST API. No SDK. Models come from ai.js (env-overridable).
// Errors carry status / retryDelayMs / perDay / usage; the message never includes the request body.
// timeoutMs per attempt; retries only on a network failure or a 503 (never a timeout, 400 or 429).
// Defaults 8 s + 1 retry; the Vercel function sets PENSUM_TIMEOUT_MS=6000 / PENSUM_RETRIES=0.
const envNum = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) : d);
async function callGemini({ model, contents, responseSchema, systemInstruction, generationConfig, timeoutMs = envNum('PENSUM_TIMEOUT_MS', 8000), retries = envNum('PENSUM_RETRIES', 1) }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY not set'), { code: 'NO_KEY' });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents,
    generationConfig: { responseMimeType: 'application/json', responseSchema, ...generationConfig },
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

  const t0 = Date.now();
  let res, json;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (attempt < retries && e.name !== 'TimeoutError') continue; // a timeout already spent the whole budget: retrying doubles the wait
      throw Object.assign(new Error(`Gemini request failed: ${e.name}`), { code: 'NETWORK', ms: Date.now() - t0 });
    }
    json = await res.json().catch(() => null);
    if (res.status === 503 && attempt < retries) continue;
    break;
  }
  const ms = Date.now() - t0;
  if (!res.ok) throw apiError(res.status, json, ms);

  const m = json?.usageMetadata || {};
  const usage = { promptTokens: m.promptTokenCount || 0, outputTokens: m.candidatesTokenCount || 0, thoughtsTokens: m.thoughtsTokenCount || 0 };
  const text = json?.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string')?.text;
  if (!text) throw Object.assign(new Error('Gemini response had no text part'), { code: 'EMPTY_RESPONSE', status: 200, usage, ms });
  try {
    return { data: JSON.parse(text), usage, ms };
  } catch {
    throw Object.assign(new Error('Gemini response was not valid JSON'), { code: 'BAD_JSON', status: 200, usage, ms });
  }
}

function apiError(status, json, ms) {
  const details = json?.error?.details || [];
  const retry = details.find((d) => String(d['@type']).endsWith('RetryInfo'))?.retryDelay; // "34s"
  const quota = details.find((d) => String(d['@type']).endsWith('QuotaFailure'));
  const perDay = !!quota?.violations?.some((v) => /PerDay/i.test(`${v.quotaId} ${v.quotaMetric}`));
  return Object.assign(new Error(`Gemini API error ${status}: ${String(json?.error?.status || '')}`), {
    code: 'API_ERROR', status, ms, perDay, retryDelayMs: retry ? Math.round(parseFloat(retry) * 1000) : 0,
  });
}

module.exports = { callGemini };
