const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMENSIONS = 768;
const EMBED_BATCH = 50;
const { createProviderError, createMissingKeyError, logProviderResponse, readProviderJson, requestProvider } = require("./errors");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function describeFailure(status, payload, apiKey) {
  const detail = payload?.error?.message || "";
  const common = { provider: "Gemini", status, payload, apiKey };
  if (status === 429) return createProviderError({ ...common, publicStatus: 429, message: "The AI service is busy or the free quota is used up. Wait a minute and try again." });
  if (status === 404) return createProviderError({ ...common, message: message => `The AI model wasn't found. Check GEMINI_MODEL in .env. (${message})` });
  if (status === 400 && /api key/i.test(detail)) return createProviderError({ ...common, message: "The Gemini API key was rejected. Check GEMINI_API_KEY in .env." });
  if (status === 401 || status === 403) return createProviderError({ ...common, message: "The Gemini API key isn't allowed to do that. Check GEMINI_API_KEY in .env." });
  if (status >= 500) return createProviderError({ ...common, message: `The Gemini service had a problem (HTTP ${status}). Please try again.` });
  return createProviderError({ ...common, message: message => message || "The AI service could not complete the request." });
}

function toContents(messages) {
  const contents = [];
  for (const message of messages) {
    const role = message.role === "user" ? "user" : "model";
    if (!contents.length && role === "model") continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${message.text}`;
    else contents.push({ role, parts: [{ text: message.text }] });
  }
  return contents;
}

class GeminiAdapter {
  constructor({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model || "gemini-flash-latest";
  }

  headers() {
    if (!this.apiKey) throw createMissingKeyError("Gemini", "GEMINI_API_KEY");
    return { "Content-Type": "application/json", "x-goog-api-key": this.apiKey };
  }

  async request(path, body, signal, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      const response = await requestProvider("Gemini", this.apiKey, `${API_BASE}/${path}`, {
        method: "POST", headers: this.headers(), body: JSON.stringify(body), signal
      });
      const payload = await readProviderJson(response);
      if (response.ok) return payload;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < attempts) {
        logProviderResponse("Gemini", response.status, payload, this.apiKey);
        await sleep(1500 * attempt);
        continue;
      }
      throw describeFailure(response.status, payload, this.apiKey);
    }
  }

  body(system, messages) {
    return { systemInstruction: { parts: [{ text: system }] }, contents: toContents(messages) };
  }

  async generate({ system, messages, signal }) {
    const payload = await this.request(`models/${encodeURIComponent(this.model)}:generateContent`, this.body(system, messages), signal);
    const answer = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
    if (!answer) throw new Error("The AI service returned an empty answer. Please try again.");
    return answer;
  }

  async *generateStream({ system, messages, signal }) {
    const response = await requestProvider("Gemini", this.apiKey, `${API_BASE}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(this.body(system, messages)), signal
    });
    if (!response.ok) {
      const payload = await readProviderJson(response);
      throw describeFailure(response.status, payload, this.apiKey);
    }
    if (!response.body) throw new Error("The AI service did not provide a response stream.");
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let event;
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (event.error) throw createProviderError({
          provider: "Gemini",
          status: response.status,
          payload: event,
          apiKey: this.apiKey,
          message: event.error.message || "The AI service stopped generating a response."
        });
        const text = event.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
        if (text) yield text;
      }
    }
  }

  embedRequest(text, taskType) {
    return { model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBED_DIMENSIONS };
  }

  async embed(text, taskType) {
    const payload = await this.request(`models/${EMBED_MODEL}:embedContent`, this.embedRequest(text, taskType));
    const values = payload.embedding?.values;
    if (!Array.isArray(values) || !values.length) throw new Error("The AI service returned an invalid embedding.");
    return values;
  }

  async embedMany(texts, taskType) {
    const vectors = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const batch = texts.slice(start, start + EMBED_BATCH);
      const payload = await this.request(`models/${EMBED_MODEL}:batchEmbedContents`, {
        requests: batch.map(text => this.embedRequest(text, taskType))
      });
      const embeddings = payload.embeddings || [];
      if (embeddings.length !== batch.length || embeddings.some(item => !item.values?.length)) {
        throw new Error("The AI service returned an invalid embedding.");
      }
      embeddings.forEach(item => vectors.push(item.values));
    }
    return vectors;
  }
}

module.exports = { GeminiAdapter, toContents, EMBED_DIMENSIONS, EMBED_MODEL };
