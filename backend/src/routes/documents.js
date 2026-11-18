const express = require("express");
const multer = require("multer");
const path = require("node:path");
const { SUPPORTED_EXTENSIONS, MAX_CHUNKS, chunkPages, extractText } = require("../services/documents");
const { clearRetrievalCache } = require("../services/retrieval");

function displayName(file) {
  // multer decodes multipart filenames as latin1; restore UTF-8 names (e.g. accents, Hindi).
  const name = Buffer.from(file.originalname, "latin1").toString("utf8");
  return path.basename(name.includes("\uFFFD") ? file.originalname : name).slice(0, 120);
}

function createDocumentsRouter(db, llm, embeddingLlm = llm) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(req, file, callback) {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        const error = new Error("Only PDF, DOCX, TXT, MD, and CSV files are supported.");
        error.status = 400;
        return callback(error);
      }
      return callback(null, true);
    }
  });
  router.get("/", (req, res) => {
    res.json(db.prepare(`
      SELECT documents.id, documents.name, documents.subject, documents.embedding_model, COUNT(chunks.id) AS chunks
      FROM documents LEFT JOIN chunks ON chunks.document_id = documents.id
      GROUP BY documents.id ORDER BY documents.id
    `).all());
  });
  router.patch("/:id", (req, res) => {
    const document = db.prepare("SELECT id, name, subject FROM documents WHERE id = ?").get(Number(req.params.id));
    if (!document) return res.status(404).json({ error: "Document not found." });
    if (req.body?.subject === undefined) return res.status(400).json({ error: "Provide a document subject." });
    const subject = String(req.body.subject).trim().slice(0, 80);
    db.prepare("UPDATE documents SET subject = ? WHERE id = ?").run(subject, document.id);
    return res.json({ ...document, subject });
  });
  router.post("/:id/summarize", async (req, res, next) => {
    try {
      const document = db.prepare("SELECT id, name FROM documents WHERE id = ?").get(Number(req.params.id));
      if (!document) return res.status(404).json({ error: "Document not found." });
      const excerpts = db.prepare("SELECT text FROM chunks WHERE document_id = ? ORDER BY id LIMIT 60")
        .all(document.id).map(row => row.text).join("\n\n").slice(0, 24000);
      if (!excerpts) return res.status(400).json({ error: "This document has no readable text to summarize." });
      const reply = await llm.generate({
        system: "Summarize the supplied document accurately for a student. Use concise sections, bullets, bold important terms, and end with a short takeaway. Do not invent facts.",
        messages: [{ role: "user", text: `Summarize ${document.name}:\n\n${excerpts}` }]
      });
      const conversationId = Number(db.prepare(
        "INSERT INTO conversations (title, mode) VALUES (?, ?)"
      ).run(`Summary: ${document.name}`.slice(0, 80), "summary").lastInsertRowid);
      db.prepare("INSERT INTO messages (conversation_id, role, text, sources) VALUES (?, ?, ?, ?)")
        .run(conversationId, "user", `Summarize ${document.name}`, "[]");
      db.prepare("INSERT INTO messages (conversation_id, role, text, sources) VALUES (?, ?, ?, ?)")
        .run(conversationId, "bot", reply, JSON.stringify([document.name]));
      return res.json({ reply, sources: [document.name], conversationId });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/:id/flashcards", async (req, res, next) => {
    try {
      const document = db.prepare("SELECT id, name FROM documents WHERE id = ?").get(Number(req.params.id));
      if (!document) return res.status(404).json({ error: "Document not found." });
      const excerpts = db.prepare("SELECT text FROM chunks WHERE document_id = ? ORDER BY id LIMIT 30")
        .all(document.id).map(row => row.text).join("\n\n").slice(0, 24000);
      if (!excerpts) return res.status(400).json({ error: "This document has no readable text to make flashcards from." });
      const reply = await llm.generate({
        system: "You are a careful study coach. Create 8 to 12 useful flashcards based only on the supplied document. Format each card as a Markdown numbered list with **Q:** and **A:** labels. Keep answers concise and do not invent facts.",
        messages: [{ role: "user", text: `Create flashcards from ${document.name}:\n\n${excerpts}` }]
      });
      const create = db.transaction(() => {
        const title = `Flashcards: ${document.name}`.slice(0, 80);
        const conversationId = Number(db.prepare(
          "INSERT INTO conversations (title, mode) VALUES (?, ?)"
        ).run(title, "quiz").lastInsertRowid);
        db.prepare("INSERT INTO messages (conversation_id, role, text, sources) VALUES (?, ?, ?, ?)")
          .run(conversationId, "user", `Make flashcards from ${document.name}`, "[]");
        db.prepare("INSERT INTO messages (conversation_id, role, text, sources) VALUES (?, ?, ?, ?)")
          .run(conversationId, "bot", reply, JSON.stringify([document.name]));
        return conversationId;
      });
      return res.json({ reply, sources: [document.name], conversationId: create() });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Choose a file to upload." });
      const extracted = await extractText(req.file);
      const chunks = chunkPages(extracted.pages);
      if (chunks.length > MAX_CHUNKS) {
        return res.status(413).json({ error: `That file is too long (${chunks.length} parts, limit ${MAX_CHUNKS}). Upload it in smaller sections, such as one chapter at a time.` });
      }
      let vectors;
      try {
        vectors = await embeddingLlm.embedMany(chunks.map(chunk => chunk.text), "RETRIEVAL_DOCUMENT");
      } catch (cause) {
        const error = new Error("Document search needs the embedding provider. Check EMBEDDING_PROVIDER and its key");
        error.status = 503;
        error.cause = cause;
        throw error;
      }
      const embeddingModel = embeddingLlm.embeddingModel || embeddingLlm.model || process.env.EMBEDDING_PROVIDER || "gemini";
      const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 80) : "";
      const insert = db.transaction(() => {
        const result = db.prepare("INSERT INTO documents (name, subject, embedding_model) VALUES (?, ?, ?)")
          .run(displayName(req.file), subject, embeddingModel);
        const documentId = Number(result.lastInsertRowid);
        const insertChunk = db.prepare("INSERT INTO chunks (document_id, text, page_number, embedding) VALUES (?, ?, ?, ?)");
        chunks.forEach((chunk, index) => insertChunk.run(documentId, chunk.text, chunk.pageNumber, JSON.stringify(vectors[index])));
        return documentId;
      });
      clearRetrievalCache();
      return res.status(201).json({
        id: insert(),
        name: displayName(req.file),
        chunks: chunks.length,
        subject,
        embeddingModel
      });
    } catch (error) {
      return next(error);
    }
  });
  router.delete("/:id", (req, res) => {
    const result = db.prepare("DELETE FROM documents WHERE id = ?").run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: "Document not found." });
    clearRetrievalCache();
    return res.status(204).end();
  });
  return router;
}

module.exports = { createDocumentsRouter };
