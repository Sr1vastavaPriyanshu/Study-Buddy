const { createProviderError, readProviderJson, requestProvider } = require("./errors");

class OllamaEmbeddingAdapter {
  constructor({ baseUrl, model }) {
    this.baseUrl = (baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.model = model || "nomic-embed-text";
    this.embeddingModel = `ollama:${this.model}`;
  }

  async embed(text) {
    const vectors = await this.embedMany([text]);
    return vectors[0];
  }

  async embedMany(texts) {
    if (!texts.length) return [];
    const response = await requestProvider("Ollama", "", `${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts })
    });
    const payload = await readProviderJson(response);
    if (!response.ok) {
      throw createProviderError({
        provider: "Ollama",
        status: response.status,
        payload,
        message: "Ollama could not create document embeddings. Check that the service is running and the model is installed."
      });
    }
    const vectors = payload.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some(vector => !Array.isArray(vector) || !vector.length)) {
      throw new Error("Ollama returned invalid document embeddings.");
    }
    return vectors;
  }
}

module.exports = { OllamaEmbeddingAdapter };
