const express = require("express");

function createMemoryRouter(db) {
  const router = express.Router();
  router.get("/", (req, res) => {
    res.json(db.prepare("SELECT id, text, pinned FROM memory ORDER BY id").all());
  });
  router.post("/", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const pinned = req.body?.pinned === true ? 1 : 0;
    if (!text || text.length > 2000) {
      return res.status(400).json({ error: "Memory text must be between 1 and 2000 characters." });
    }
    const result = db.prepare("INSERT INTO memory (text, pinned) VALUES (?, ?)").run(text, pinned);
    return res.status(201).json({ id: Number(result.lastInsertRowid), text, pinned: pinned === 1 });
  });
  router.patch("/:id", (req, res) => {
    const memory = db.prepare("SELECT id, text, pinned FROM memory WHERE id = ?").get(Number(req.params.id));
    if (!memory) return res.status(404).json({ error: "Memory not found." });
    const text = req.body?.text === undefined ? memory.text : String(req.body.text).trim();
    if (!text || text.length > 2000) {
      return res.status(400).json({ error: "Memory text must be between 1 and 2000 characters." });
    }
    const pinned = req.body?.pinned === undefined ? memory.pinned : (req.body.pinned === true ? 1 : 0);
    db.prepare("UPDATE memory SET text = ?, pinned = ? WHERE id = ?").run(text, pinned, memory.id);
    return res.json({ id: memory.id, text, pinned: pinned === 1 });
  });
  router.delete("/:id", (req, res) => {
    const result = db.prepare("DELETE FROM memory WHERE id = ?").run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: "Memory not found." });
    return res.status(204).end();
  });
  return router;
}

module.exports = { createMemoryRouter };
