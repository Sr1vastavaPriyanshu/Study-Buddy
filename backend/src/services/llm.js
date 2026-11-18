const { GeminiAdapter, toContents, EMBED_DIMENSIONS } = require("./providers/gemini");
const { OpenAIAdapter } = require("./providers/openai");
const { AnthropicAdapter } = require("./providers/anthropic");
const { OllamaEmbeddingAdapter } = require("./providers/ollama-embeddings");

const PROVIDER_DEFAULT_MODELS = {
  gemini: "gemini-flash-latest",
  openai: "openai/gpt-oss-120b",
  anthropic: "claude-3-5-haiku-latest"
};

function createProviderAdapter(provider, env = process.env) {
  const name = String(provider || env.LLM_PROVIDER || "gemini").trim().toLowerCase();
  if (name === "gemini") return new GeminiAdapter({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
  if (name === "openai") return new OpenAIAdapter({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.OPENAI_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL
  });
  if (name === "anthropic") return new AnthropicAdapter({
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: env.ANTHROPIC_BASE_URL,
    model: env.ANTHROPIC_MODEL
  });
  throw new Error(`Unknown AI provider: ${name}`);
}

function createLlmAdapter(env = process.env) {
  return createProviderAdapter(env.LLM_PROVIDER || "gemini", env);
}

function createEmbeddingAdapter(env = process.env) {
  const name = String(env.EMBEDDING_PROVIDER || "gemini").trim().toLowerCase();
  if (name === "ollama") {
    return new OllamaEmbeddingAdapter({
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_EMBEDDING_MODEL
    });
  }
  return createProviderAdapter(name, env);
}

function getProviderRegistry() {
  return {
    gemini: { label: "Google Gemini", defaultModel: PROVIDER_DEFAULT_MODELS.gemini, supportsEmbeddings: true },
    openai: { label: "OpenAI-compatible", defaultModel: PROVIDER_DEFAULT_MODELS.openai, supportsEmbeddings: true },
    anthropic: { label: "Anthropic", defaultModel: PROVIDER_DEFAULT_MODELS.anthropic, supportsEmbeddings: false }
  };
}

module.exports = {
  GeminiAdapter,
  OpenAIAdapter,
  AnthropicAdapter,
  OllamaEmbeddingAdapter,
  createProviderAdapter,
  createLlmAdapter,
  createEmbeddingAdapter,
  getProviderRegistry,
  toContents,
  EMBED_DIMENSIONS
};
