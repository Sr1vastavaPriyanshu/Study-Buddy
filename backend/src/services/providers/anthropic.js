const { createProviderError, createMissingKeyError, readProviderJson, requestProvider } = require("./errors");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function describeFailure(status, payload, apiKey) {
  const detail = payload?.error?.message || "";
  const common = { provider: "Anthropic", status, payload, apiKey };
  if (status === 429) return createProviderError({ ...common, publicStatus: 429, message: "The Anthropic service is busy or the quota is used up. Wait a minute and try again." });
  if (status === 404) return createProviderError({ ...common, message: message => `The Anthropic model wasn't found. Check ANTHROPIC_MODEL. (${message || detail})` });
  if (status === 401 || status === 403) return createProviderError({ ...common, message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." });
  if (status >= 500) return createProviderError({ ...common, message: `The Anthropic service had a problem (HTTP ${status}). Please try again.` });
  return createProviderError({ ...common, message: message => message || "The AI service could not complete the request." });
}

class AnthropicAdapter {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    this.model = model || "claude-3-5-haiku-latest";
  }

  headers() {
    if (!this.apiKey) throw createMissingKeyError("Anthropic", "ANTHROPIC_API_KEY");
    return { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" };
  }

  body(system, messages) {
    return {
      model: this.model,
      max_tokens: 4096,
      system,
      messages: messages.map(message => ({
        role: message.role === "user" ? "user" : "assistant",
        content: message.text
      }))
    };
  }

  async generate({ system, messages, signal }) {
    const response = await requestProvider("Anthropic", this.apiKey, `${this.baseUrl}/v1/messages`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(this.body(system, messages)), signal
    });
    const payload = await readProviderJson(response);
    if (!response.ok) throw describeFailure(response.status, payload, this.apiKey);
    const answer = payload.content?.filter(block => block.type === "text").map(block => block.text).join("").trim();
    if (!answer) throw new Error("The AI service returned an empty answer. Please try again.");
    return answer;
  }

  async *generateStream({ system, messages, signal }) {
    const response = await requestProvider("Anthropic", this.apiKey, `${this.baseUrl}/v1/messages`, {
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
        let event;
        try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (event.type === "error") throw createProviderError({
          provider: "Anthropic",
          status: response.status,
          payload: event,
          apiKey: this.apiKey,
          message: event.error?.message || "The Anthropic service stopped generating."
        });
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          yield event.delta.text;
        }
      }
    }
  }

  async embed() {
    throw httpError(501, "Anthropic does not provide embeddings for document retrieval. Set EMBEDDING_PROVIDER to gemini or openai.");
  }

  async embedMany(texts) {
    if (!texts.length) return [];
    throw httpError(501, "Anthropic does not provide embeddings for document retrieval. Set EMBEDDING_PROVIDER to gemini or openai.");
  }
}

module.exports = { AnthropicAdapter };
