// HTTP route tests. Need `npm install` (supertest).
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/db/database");
const { createProviderAdapter } = require("../src/services/llm");

const stubLlm = overrides => ({
  embed: async () => [1, 0],
  embedMany: async texts => texts.map(() => [1, 0]),
  generate: async () => "stub reply",
  ...overrides
});

test("memory: create, list, delete, validation", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: stubLlm() });
  const created = await request(app).post("/api/memory").send({ text: "I study physics" }).expect(201);
  assert.equal(created.body.text, "I study physics");
  assert.equal((await request(app).get("/api/memory").expect(200)).body.length, 1);
  await request(app).post("/api/memory").send({ text: "  " }).expect(400);
  await request(app).delete(`/api/memory/${created.body.id}`).expect(204);
  await request(app).delete(`/api/memory/${created.body.id}`).expect(404);
  db.close();
});

test("memory: edit and pin an individual memory", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: stubLlm() });
  const created = await request(app).post("/api/memory").send({ text: "I study physics", pinned: true }).expect(201);
  assert.equal(created.body.pinned, true);
  const updated = await request(app).patch(`/api/memory/${created.body.id}`)
    .send({ text: "I study astrophysics", pinned: false }).expect(200);
  assert.equal(updated.body.text, "I study astrophysics");
  assert.equal(updated.body.pinned, false);
  await request(app).patch("/api/memory/999").send({ text: "missing" }).expect(404);
  db.close();
});

test("documents: upload text file, then chat cites it as a source", async () => {
  const db = createDatabase(":memory:");
  let system = "";
  const app = createApp({ db, llm: stubLlm({ generate: async input => { system = input.system; return "Answer from notes."; } }) });
  const upload = await request(app).post("/api/documents")
    .attach("file", Buffer.from("Mitochondria are the powerhouse of the cell. ".repeat(40)), "biology.txt").expect(201);
  assert.equal(upload.body.name, "biology.txt");
  assert.ok(upload.body.chunks >= 1);
  const chat = await request(app).post("/api/chat")
    .send({ mode: "chat", messages: [{ role: "user", text: "What are mitochondria?" }] }).expect(200);
  assert.deepEqual(chat.body.sources, ["biology.txt"]);
  assert.match(system, /powerhouse/);
  db.close();
});

test("documents: rejects unsupported types and oversized files with clear messages", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: stubLlm() });
  const bad = await request(app).post("/api/documents").attach("file", Buffer.from("x"), "virus.exe").expect(400);
  assert.match(bad.body.error, /PDF, DOCX, TXT, MD, and CSV/);
  const big = await request(app).post("/api/documents").attach("file", Buffer.alloc(11 * 1024 * 1024, "a"), "big.txt").expect(413);
  assert.match(big.body.error, /10 MB/);
  db.close();
});

test("documents: embedding failure returns clear guidance without saving partial data", async () => {
  const db = createDatabase(":memory:");
  const llm = stubLlm({ embedMany: async () => { throw new Error("embedding provider unavailable"); } });
  const app = createApp({ db, llm });
  const response = await request(app).post("/api/documents")
    .attach("file", Buffer.from("Document text to embed."), "notes.txt")
    .expect(503);
  assert.equal(response.body.error, "Document search needs the embedding provider. Check EMBEDDING_PROVIDER and its key");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM documents").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chunks").get().count, 0);
  db.close();
});

test("chat streaming sends the conversation id first, then deltas, then done", async () => {
  const db = createDatabase(":memory:");
  const llm = stubLlm({ generateStream: async function* () { yield "Hel"; yield "lo"; } });
  const app = createApp({ db, llm });
  const response = await request(app).post("/api/chat")
    .send({ stream: true, mode: "explain", messages: [{ role: "user", text: "hi" }] }).expect(200);
  const events = response.text.split("\n\n").filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, "")));
  assert.equal(events[0].conversationId, 1);
  assert.equal(events.filter(event => event.delta).map(event => event.delta).join(""), "Hello");
  assert.equal(events.at(-1).done, true);
  assert.equal(db.prepare("SELECT text FROM messages WHERE role = 'bot'").get().text, "Hello");
  db.close();
});

test("chat streaming retries a transient failure before receiving text", async () => {
  const db = createDatabase(":memory:");
  let attempts = 0;
  const llm = stubLlm({
    generateStream: async function* () {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("upstream unavailable (HTTP 503)");
        error.providerStatus = 503;
        throw error;
      }
      yield "recovered";
    }
  });
  const app = createApp({ db, llm });
  const response = await request(app).post("/api/chat")
    .send({ stream: true, messages: [{ role: "user", text: "Hello" }] }).expect(200);
  const events = response.text.split("\n\n").filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, "")));
  assert.equal(events.filter(event => event.delta).map(event => event.delta).join(""), "recovered");
  assert.equal(attempts, 2);
  db.close();
});

test("chat error message includes the upstream status for 5xx responses", async () => {
  const db = createDatabase(":memory:");
  const llm = stubLlm({
    generate: async () => {
      const error = new Error("The OpenAI-compatible service had a problem (HTTP 503). Please try again.");
      error.status = 502;
      error.providerStatus = 503;
      throw error;
    }
  });
  const app = createApp({ db, llm });
  const response = await request(app).post("/api/chat")
    .send({ messages: [{ role: "user", text: "Hello" }] }).expect(502);
  assert.match(response.body.error, /HTTP 503/);
  db.close();
});

test("chat falls back once to another configured provider after a 5xx", async t => {
  const db = createDatabase(":memory:");
  const env = {
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-test-key",
    OPENAI_BASE_URL: "https://api.groq.com/openai/v1",
    OPENAI_MODEL: "openai/gpt-oss-120b",
    GEMINI_API_KEY: "gemini-test-key",
    GEMINI_MODEL: "gemini-flash-latest"
  };
  const calls = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(url);
    if (url.includes("/chat/completions")) {
      return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Fallback answer" }] } }]
    }), { status: 200 });
  });
  const app = createApp({ db, llm: createProviderAdapter("openai", env), env });
  const response = await request(app).post("/api/chat")
    .send({ messages: [{ role: "user", text: "Hello" }] }).expect(200);
  assert.match(response.body.reply, /^Answered by Google Gemini after Groq \(OpenAI-compatible\) was unavailable\./);
  assert.equal(response.body.provider, "gemini");
  assert.equal(response.body.fallbackFrom, "openai");
  assert.equal(calls.length, 2);
  db.close();
});

test("chat falls back once when the selected provider times out", async t => {
  const db = createDatabase(":memory:");
  const env = {
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-test-key",
    OPENAI_BASE_URL: "https://api.groq.com/openai/v1",
    GEMINI_API_KEY: "gemini-test-key",
    GEMINI_MODEL: "gemini-flash-latest"
  };
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async url => {
    if (url.includes("/chat/completions")) {
      const error = new Error("request timed out");
      error.name = "TimeoutError";
      throw error;
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Timeout fallback answer" }] } }]
    }), { status: 200 });
  });
  const app = createApp({ db, llm: createProviderAdapter("openai", env), env });
  const response = await request(app).post("/api/chat")
    .send({ messages: [{ role: "user", text: "Hello" }] }).expect(200);
  assert.equal(response.body.provider, "gemini");
  assert.match(response.body.reply, /Timeout fallback answer/);
  db.close();
});

test("streaming chat falls back after selected provider retries before the first token", async t => {
  const db = createDatabase(":memory:");
  const env = {
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-test-key",
    OPENAI_BASE_URL: "https://api.groq.com/openai/v1",
    OPENAI_MODEL: "openai/gpt-oss-120b",
    GEMINI_API_KEY: "gemini-test-key",
    GEMINI_MODEL: "gemini-flash-latest"
  };
  let openAiCalls = 0;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async url => {
    if (url.includes("/chat/completions")) {
      openAiCalls += 1;
      return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Fallback stream"}]}}]}\n\n', { status: 200 });
  });
  const app = createApp({ db, llm: createProviderAdapter("openai", env), env });
  const response = await request(app).post("/api/chat")
    .send({ stream: true, messages: [{ role: "user", text: "Hello" }] }).expect(200);
  const events = response.text.split("\n\n").filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, "")));
  const deltas = events.filter(event => event.delta).map(event => event.delta).join("");
  assert.match(deltas, /^Answered by Google Gemini after Groq \(OpenAI-compatible\) was unavailable\./);
  assert.match(deltas, /Fallback stream/);
  assert.equal(events.at(-1).provider, "gemini");
  assert.equal(events.at(-1).fallbackFrom, "openai");
  assert.equal(openAiCalls, 3);
  db.close();
});

test("chat still answers when document search fails", async () => {
  const db = createDatabase(":memory:");
  const id = db.prepare("INSERT INTO documents (name) VALUES (?)").run("a.txt").lastInsertRowid;
  db.prepare("INSERT INTO chunks (document_id, text, embedding) VALUES (?, ?, ?)").run(id, "t", "[1,0]");
  const app = createApp({ db, llm: stubLlm({ embed: async () => { throw new Error("quota"); } }) });
  const response = await request(app).post("/api/chat")
    .send({ messages: [{ role: "user", text: "hello" }] }).expect(200);
  assert.equal(response.body.reply, "stub reply");
  db.close();
});

test("conversations: list, open, delete", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: stubLlm() });
  const chat = await request(app).post("/api/chat").send({ messages: [{ role: "user", text: "first question" }] }).expect(200);
  const list = await request(app).get("/api/conversations").expect(200);
  assert.equal(list.body[0].title, "first question");
  const opened = await request(app).get(`/api/conversations/${chat.body.conversationId}`).expect(200);
  assert.equal(opened.body.messages.length, 2);
  await request(app).delete(`/api/conversations/${chat.body.conversationId}`).expect(204);
  await request(app).get(`/api/conversations/${chat.body.conversationId}`).expect(404);
  db.close();
});

test("conversations: rename a chat", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: stubLlm() });
  const chat = await request(app).post("/api/chat").send({ messages: [{ role: "user", text: "first question" }] }).expect(200);
  const renamed = await request(app).patch(`/api/conversations/${chat.body.conversationId}`)
    .send({ title: "Physics revision" }).expect(200);
  assert.equal(renamed.body.title, "Physics revision");
  await request(app).patch("/api/conversations/999").send({ title: "Missing" }).expect(404);
  db.close();
});

test("providers: reports provider metadata without API keys", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: stubLlm() });
  const response = await request(app).get("/api/providers").expect(200);
  assert.equal(response.body.providers.length, 3);
  assert.ok(response.body.providers.every(provider => provider.id && provider.models.length));
  assert.ok(!JSON.stringify(response.body).includes("OPENAI_API_KEY"));
  db.close();
});
