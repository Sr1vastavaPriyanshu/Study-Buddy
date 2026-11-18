const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/db/database");

test("chat uses the selected mode and stored memory, then persists the exchange", async () => {
  const db = createDatabase(":memory:");
  db.prepare("INSERT INTO memory (text) VALUES (?)").run("I am studying biology.");
  let generation;
  const llm = {
    embed: async () => [1],
    generate: async input => {
      generation = input;
      return "Mitochondria make usable energy.";
    }
  };
  const app = createApp({ db, llm });
  const response = await request(app)
    .post("/api/chat")
    .send({ mode: "explain", messages: [{ role: "user", text: "What do mitochondria do?" }] })
    .expect(200);

  assert.equal(response.body.reply, "Mitochondria make usable energy.");
  assert.equal(response.body.conversationId, 1);
  assert.match(generation.system, /patient tutor/);
  assert.match(generation.system, /I am studying biology/);
  assert.deepEqual(db.prepare("SELECT role, text FROM messages ORDER BY id").all(), [
    { role: "user", text: "What do mitochondria do?" },
    { role: "bot", text: "Mitochondria make usable energy." }
  ]);
  db.close();
});

test("chat rejects malformed input before calling the model", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({ db, llm: { generate: async () => assert.fail("LLM should not be called") } });
  const response = await request(app).post("/api/chat").send({ messages: [] }).expect(400);
  assert.match(response.body.error, /messages/);
  db.close();
});
