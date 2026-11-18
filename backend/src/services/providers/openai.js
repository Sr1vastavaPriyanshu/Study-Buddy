const { createProviderError, createMissingKeyError, readProviderJson, requestProvider } = require("./errors");

function describeFailure(status, payload, apiKey) {
  const detail = payload?.error?.message || payload?.message || "";
  const common = { provider: "OpenAI-compatible", status, payload, apiKey };
  if (status === 429) return createProviderError({ ...common, publicStatus: 429, message: "The AI service is busy or the quota is used up. Wait a minute and try again." });
  if (status === 404) return createProviderError({ ...common, message: message => `The OpenAI-compatible model wasn't found. Check OPENAI_MODEL or the provider base URL. (${message || detail})` });
  if (status === 401 || status === 403) return createProviderError({ ...common, message: "The OpenAI-compatible API key was rejected. Check OPENAI_API_KEY and OPENAI_BASE_URL." });
  if (status >= 500) return createProviderError({ ...common, message: `The OpenAI-compatible service had a problem (HTTP ${status}). Please try again.` });
  return createProviderError({ ...common, message: message => message || "The AI service could not complete the request." });
}

class OpenAIAdapter {
  constructor({ apiKey, baseUrl, model, embeddingModel }) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
    this.model = model || "openai/gpt-oss-120b";
    this.embeddingModel = embeddingModel || "text-embedding-3-small";
  }

  headers() {
    if (!this.apiKey) throw createMissingKeyError("OpenAI-compatible", "OPENAI_API_KEY");
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  async request(path, body, signal) {
    const response = await requestProvider("OpenAI-compatible", this.apiKey, `${this.baseUrl}${path}`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body), signal
    });
    const payload = await readProviderJson(response);
    if (!response.ok) throw describeFailure(response.status, payload, this.apiKey);
    return payload;
  }

  body(system, messages) {
    return {
      model: this.model,
      messages: [{ role: "system", content: system }, ...messages.map(message => ({
        role: message.role === "user" ? "user" : "assistant",
        content: message.text
      }))],
      temperature: 0.7
    };
  }

  async generate({ system, messages, signal }) {
    const payload = await this.request("/chat/completions", { ...this.body(system, messages), stream: false }, signal);
    const answer = payload.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("The AI service returned an empty answer. Please try again.");
    return answer;
  }

  async *generateStream({ system, messages, signal }) {
    const response = await requestProvider("OpenAI-compatible", this.apiKey, `${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers(),
      body: JSON.stringify({ ...this.body(system, messages), stream: true }), signal
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
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        if (event.error) throw createProviderError({
          provider: "OpenAI-compatible",
          status: response.status,
          payload: event,
          apiKey: this.apiKey,
          message: event.error.message || "The AI service stopped generating."
        });
        const text = event.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  }

  async embed(text) {
    const payload = await this.request("/embeddings", { model: this.embeddingModel, input: text });
    const values = payload.data?.[0]?.embedding;
    if (!Array.isArray(values) || !values.length) throw new Error("The AI service returned an invalid embedding.");
    return values;
  }

  async embedMany(texts) {
    if (!texts.length) return [];
    const vectors = [];
    for (let start = 0; start < texts.length; start += 25) {
      const batch = texts.slice(start, start + 25);
      let payload;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          payload = await this.request("/embeddings", { model: this.embeddingModel, input: batch });
          break;
        } catch (error) {
          if (error.status !== 429 && error.status < 500) throw error;
          if (attempt === 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        }
      }
      const rows = payload.data;
      if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error("The AI service returned invalid embeddings.");
      vectors.push(...rows.sort((a, b) => a.index - b.index).map(row => row.embedding));
    }
    return vectors;
  }
}

module.exports = { OpenAIAdapter };
