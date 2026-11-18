const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../src/db/database");
const { cosineSimilarity, retrieveChunks } = require("../src/services/retrieval");

test("cosine similarity ranks the matching document chunk first", async () => {
  const db = createDatabase(":memory:");
  const first = db.prepare("INSERT INTO documents (name) VALUES (?)").run("biology.pdf").lastInsertRowid;
  const second = db.prepare("INSERT INTO documents (name) VALUES (?)").run("history.txt").lastInsertRowid;
  const insert = db.prepare("INSERT INTO chunks (document_id, text, embedding) VALUES (?, ?, ?)");
  insert.run(first, "Cell structure and mitochondria", JSON.stringify([1, 0]));
  insert.run(second, "Ancient history", JSON.stringify([0, 1]));
  const llm = { embed: async () => [0.98, 0.02] };

  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  const results = await retrieveChunks(db, llm, "What do mitochondria do?", 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "biology.pdf");
  db.close();
});
