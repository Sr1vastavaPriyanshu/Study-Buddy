const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkText, CHUNK_SIZE } = require("../src/services/documents");
const { GeminiAdapter, toContents } = require("../src/services/llm");
const { createDatabase } = require("../src/db/database");
const { retrieveChunks } = require("../src/services/retrieval");
const { selectRelevantMemories } = require("../src/services/memory");

test("memory selection includes pinned facts and only relevant memories", () => {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO memory (text, pinned) VALUES (?, ?)").run("I am in Class 12", 1);
  db.prepare("INSERT INTO memory (text, pinned) VALUES (?, ?)").run("I prefer simple physics examples", 0);
  db.prepare("INSERT INTO memory (text, pinned) VALUES (?, ?)").run("I eat lunch at noon", 0);
  const selected = selectRelevantMemories(db, "Explain Newton's physics laws");
  assert.ok(selected.some(memory => memory.text === "I am in Class 12"));
  assert.ok(selected.some(memory => memory.text === "I prefer simple physics examples"));
  assert.ok(!selected.some(memory => memory.text === "I eat lunch at noon"));
  db.close();
});

test("chunkText makes overlapping chunks that cover the whole text", () => {
  const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const chunks = chunkText(text);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(chunk => chunk.length <= CHUNK_SIZE));
  assert.ok(chunks[0].startsWith("word0"));
  assert.ok(chunks.at(-1).endsWith("word399"));
  // overlap: the end of one chunk reappears at the start of the next
  const tail = chunks[0].split(" ").slice(-3).join(" ");
  assert.ok(chunks[1].includes(tail));
  assert.deepEqual(chunkText("   "), []);
});

test("toContents drops a leading bot turn and merges repeated roles", () => {
  const contents = toContents([
    { role: "bot", text: "old" },
    { role: "user", text: "a" },
    { role: "user", text: "b" },
    { role: "bot", text: "c" }
  ]);
  assert.deepEqual(contents.map(item => item.role), ["user", "model"]);
  assert.equal(contents[0].parts[0].text, "a\n\nb");
});

test("embedMany sends batches and returns vectors in order", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, count: body.requests.length, dims: body.requests[0].outputDimensionality });
    return { ok: true, status: 200, json: async () => ({ embeddings: body.requests.map(r => ({ values: [r.content.parts[0].text.length] })) }) };
  });
  const adapter = new GeminiAdapter({ apiKey: "test-key" });
  const texts = Array.from({ length: 120 }, (_, i) => "x".repeat(i + 1));
  const vectors = await adapter.embedMany(texts, "RETRIEVAL_DOCUMENT");
  assert.equal(vectors.length, 120);
  assert.deepEqual(vectors[119], [120]);
  assert.deepEqual(calls.map(call => call.count), [50, 50, 20]);
  assert.equal(calls[0].dims, 768);
});

test("missing API key gives a clear 503 instead of crashing at startup", async () => {
  const adapter = new GeminiAdapter({ apiKey: "" });
  await assert.rejects(() => adapter.generate({ system: "s", messages: [{ role: "user", text: "hi" }] }),
    error => error.status === 503 && /GEMINI_API_KEY/.test(error.message));
});

test("rate-limit responses are retried once then reported as 429", async t => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    return { ok: false, status: 429, json: async () => ({ error: { message: "quota" } }) };
  });
  const adapter = new GeminiAdapter({ apiKey: "k" });
  adapter.request = GeminiAdapter.prototype.request.bind(adapter);
  await assert.rejects(() => adapter.request("models/x:generateContent", {}, undefined, 2),
    error => error.status === 429);
  assert.equal(attempts, 2);
});

test("database works and returns plain objects (works with either SQLite driver)", () => {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO memory (text) VALUES (?)").run("hello");
  assert.deepEqual(db.prepare("SELECT id, text FROM memory").all(), [{ id: 1, text: "hello" }]);
  assert.equal(db.prepare("SELECT id FROM memory WHERE id = 99").get(), undefined);
  assert.throws(() => db.transaction(() => { db.prepare("INSERT INTO memory (text) VALUES (?)").run("x"); throw new Error("boom"); })());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory").get().n, 1);
  db.close();
});

test("retrieval ignores chunks below the similarity threshold", async () => {
  const db = createDatabase(":memory:");
  const id = db.prepare("INSERT INTO documents (name) VALUES (?)").run("a.txt").lastInsertRowid;
  db.prepare("INSERT INTO chunks (document_id, text, embedding) VALUES (?, ?, ?)").run(id, "unrelated", JSON.stringify([0, 1]));
  const results = await retrieveChunks(db, { embed: async () => [1, 0] }, "hi", 4, 0.45);
  assert.deepEqual(results, []);
  db.close();
});
