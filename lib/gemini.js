// Minimal Gemini client: one prompt in, parsed + validated JSON out.
// Server-only: reads GEMINI_API_KEY, which never reaches the browser.

export async function geminiJson({ prompt, schema, validate, label }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: schema },
        }),
        signal: AbortSignal.timeout(50000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || "request failed"}`);
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
      if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason || "unknown"})`);
      return validate(JSON.parse(text));
    } catch (err) {
      lastError = err;
      // Don't retry configuration errors such as a bad key.
      if (/Gemini (400|401|403)/.test(err.message)) break;
    }
  }
  throw new Error(`${label} failed: ${lastError.message}`);
}
