const test = require("node:test");
const assert = require("node:assert/strict");
const { GeminiAdapter } = require("../src/services/providers/gemini");
const { OpenAIAdapter } = require("../src/services/providers/openai");
const { AnthropicAdapter } = require("../src/services/providers/anthropic");
const { createProviderAdapter, createEmbeddingAdapter, getProviderRegistry } = require("../src/services/llm");

test("Gemini adapter sends a generation request to the configured model", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(url, /gemini-test:generateContent/);
    assert.equal(JSON.parse(init.body).contents[0].role, "user");
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ content: { parts: [{ text: "Gemini answer" }] } }]
    }) };
  });
  const adapter = new GeminiAdapter({ apiKey: "gemini-key", model: "gemini-test" });
  assert.equal(await adapter.generate({ system: "Tutor", messages: [{ role: "user", text: "Hello" }] }), "Gemini answer");
});

test("OpenAI-compatible adapter sends chat and embedding requests", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/chat/completions")) {
      return { ok: true, status: 200, json: async () => ({
        choices: [{ message: { content: "OpenAI answer" } }]
      }) };
    }
    return { ok: true, status: 200, json: async () => ({
      data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }]
    }) };
  });
  const adapter = new OpenAIAdapter({
    apiKey: "openai-key",
    baseUrl: "https://compatible.example/v1/",
    model: "compatible-model",
    embeddingModel: "embedding-model"
  });
  assert.equal(await adapter.generate({ system: "Tutor", messages: [{ role: "user", text: "Hello" }] }), "OpenAI answer");
  assert.deepEqual(await adapter.embedMany(["A", "B"]), [[1, 0], [0, 1]]);
  assert.equal(calls[0].url, "https://compatible.example/v1/chat/completions");
  assert.equal(calls[0].body.model, "compatible-model");
  assert.equal(calls[1].body.model, "embedding-model");
});

test("OpenAI-compatible errors log the upstream status and redact the API key", async t => {
  const apiKey = "test-api-key-never-log";
  const logs = [];
  t.mock.method(console, "error", message => logs.push(message));
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: `overloaded; credential ${apiKey}` } })
  }));
  const adapter = new OpenAIAdapter({ apiKey, baseUrl: "https://compatible.example/v1", model: "test-model" });
  await assert.rejects(
    adapter.generate({ system: "Tutor", messages: [{ role: "user", text: "Hello" }] }),
    error => error.status === 502 && error.providerStatus === 503 && /HTTP 503/.test(error.message)
  );
  assert.match(logs[0], /HTTP 503: overloaded; credential \[REDACTED\]/);
  assert.ok(!logs.join("\n").includes(apiKey));
});

test("OpenAI-compatible streaming request can be retried after an upstream 503", async t => {
  let calls = 0;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "temporarily overloaded" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response('data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  });
  const db = require("../src/db/database").createDatabase(":memory:");
  const { createApp } = require("../src/app");
  const adapter = new OpenAIAdapter({ apiKey: "test-key", baseUrl: "https://compatible.example/v1", model: "test-model" });
  const app = createApp({ db, llm: adapter });
  const response = await require("supertest")(app).post("/api/chat")
    .send({ stream: true, messages: [{ role: "user", text: "Hello" }] }).expect(200);
  const events = response.text.split("\n\n").filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, "")));
  assert.equal(events.filter(event => event.delta).map(event => event.delta).join(""), "recovered");
  assert.equal(calls, 2);
  db.close();
});

test("Anthropic adapter sends an Anthropic Messages request", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(url, /\/v1\/messages$/);
    assert.equal(init.headers["x-api-key"], "anthropic-key");
    assert.equal(JSON.parse(init.body).model, "claude-test");
    return { ok: true, status: 200, json: async () => ({
      content: [{ type: "text", text: "Anthropic answer" }]
    }) };
  });
  const adapter = new AnthropicAdapter({ apiKey: "anthropic-key", model: "claude-test" });
  assert.equal(await adapter.generate({ system: "Tutor", messages: [{ role: "user", text: "Hello" }] }), "Anthropic answer");
  await assert.rejects(() => adapter.embed("text"), error => error.status === 501);
});

test("provider registry creates the configured adapter and exposes metadata", () => {
  const env = { GEMINI_API_KEY: "gemini", GEMINI_MODEL: "gemini-test" };
  assert.equal(createProviderAdapter("gemini", env).model, "gemini-test");
  assert.equal(new GeminiAdapter({ apiKey: "gemini-key" }).model, "gemini-flash-latest");
  const defaultOpenAI = new OpenAIAdapter({ apiKey: "openai-key" });
  assert.equal(defaultOpenAI.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(defaultOpenAI.model, "openai/gpt-oss-120b");
  assert.equal(getProviderRegistry().gemini.defaultModel, "gemini-flash-latest");
  assert.equal(getProviderRegistry().openai.defaultModel, "openai/gpt-oss-120b");
  assert.equal(getProviderRegistry().anthropic.supportsEmbeddings, false);
  assert.throws(() => createProviderAdapter("unknown", env), /Unknown AI provider/);
});

test("Ollama embedding adapter sends batches to its local embedding endpoint", async t => {
  let request;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ embeddings: [[1, 0], [0, 1]] }), { status: 200 });
  });
  const adapter = createEmbeddingAdapter({
    EMBEDDING_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://localhost:11434/",
    OLLAMA_EMBEDDING_MODEL: "nomic-embed-text"
  });
  assert.equal(adapter.embeddingModel, "ollama:nomic-embed-text");
  assert.deepEqual(await adapter.embedMany(["A", "B"]), [[1, 0], [0, 1]]);
  assert.equal(request.url, "http://localhost:11434/api/embed");
  assert.deepEqual(request.body, { model: "nomic-embed-text", input: ["A", "B"] });
});
