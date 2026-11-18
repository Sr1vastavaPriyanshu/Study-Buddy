const express = require("express");

function createConversationsRouter(db) {
  const router = express.Router();
  router.get("/", (req, res) => {
    res.json(db.prepare(`
      SELECT conversations.id, conversations.title, conversations.mode, conversations.subject,
        conversations.updated_at, COUNT(messages.id) AS messages
      FROM conversations LEFT JOIN messages ON messages.conversation_id = conversations.id
      GROUP BY conversations.id ORDER BY conversations.updated_at DESC, conversations.id DESC
    `).all());
  });
  router.get("/:id", (req, res) => {
    const conversation = db.prepare("SELECT id, title, mode, subject FROM conversations WHERE id = ?")
      .get(Number(req.params.id));
    if (!conversation) return res.status(404).json({ error: "Conversation not found." });
    const messages = db.prepare(
      "SELECT role, text, sources FROM messages WHERE conversation_id = ? ORDER BY id"
    ).all(conversation.id).map(message => ({
      role: message.role,
      text: message.text,
      sources: JSON.parse(message.sources)
    }));
    return res.json({ ...conversation, messages });
  });
  router.post("/", (req, res) => {
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 80) : "";
    const result = db.prepare("INSERT INTO conversations (title, mode, subject) VALUES (?, ?, ?)")
      .run("New chat", "explain", subject);
    const id = Number(result.lastInsertRowid);
    return res.status(201).json({ id, title: "New chat", mode: "explain", subject, messages: [] });
  });
  router.patch("/:id", (req, res) => {
    const conversation = db.prepare("SELECT id, title, mode, subject FROM conversations WHERE id = ?")
      .get(Number(req.params.id));
    if (!conversation) return res.status(404).json({ error: "Conversation not found." });
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title || title.length > 80) {
      return res.status(400).json({ error: "Conversation title must be between 1 and 80 characters." });
    }
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 80) : conversation.subject;
    db.prepare("UPDATE conversations SET title = ?, subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(title, subject, conversation.id);
    return res.json({ ...conversation, title, subject });
  });
  router.delete("/:id", (req, res) => {
    const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: "Conversation not found." });
    return res.status(204).end();
  });
  return router;
}

module.exports = { createConversationsRouter };
