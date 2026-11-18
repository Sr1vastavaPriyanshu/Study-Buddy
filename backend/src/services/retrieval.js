const vectorCache = new Map();

function clearRetrievalCache() {
  vectorCache.clear();
}

function getEmbeddingModelMismatch(db, llm) {
  const current = llm.embeddingModel || llm.model || process.env.EMBEDDING_PROVIDER || "gemini";
  const mismatches = db.prepare(`
    SELECT DISTINCT name, embedding_model
    FROM documents
    WHERE embedding_model != '' AND embedding_model != ?
  `).all(String(current));
  return mismatches.map(row => ({ name: row.name, storedModel: row.embedding_model, currentModel: String(current) }));
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

const DEFAULT_MIN_SCORE = Number(process.env.MIN_SIMILARITY) || 0.45;

// Returns the best-matching chunks, dropping ones too weakly related to be useful
// (so a greeting like "hi" doesn't cite a random document).
async function retrieveChunks(db, llm, question, limit = 4, minScore = DEFAULT_MIN_SCORE, subject = "") {
  const normalizedSubject = String(subject).trim();
  const rows = normalizedSubject
    ? db.prepare(`
        SELECT chunks.id, chunks.text, chunks.embedding, chunks.page_number, documents.name, documents.subject, documents.embedding_model
        FROM chunks JOIN documents ON documents.id = chunks.document_id
        WHERE LOWER(documents.subject) = LOWER(?)
      `).all(normalizedSubject)
    : db.prepare(`
        SELECT chunks.id, chunks.text, chunks.embedding, chunks.page_number, documents.name, documents.subject, documents.embedding_model
        FROM chunks JOIN documents ON documents.id = chunks.document_id
      `).all();
  if (!rows.length) return [];
  const currentModel = llm.embeddingModel || llm.model || process.env.EMBEDDING_PROVIDER || "gemini";
  const compatibleRows = rows.filter(row => !row.embedding_model || !currentModel || row.embedding_model === String(currentModel));
  if (!compatibleRows.length) return [];
  const queryEmbedding = await llm.embed(question, "RETRIEVAL_QUERY");
  return compatibleRows
    .map(row => {
      let vector = vectorCache.get(row.id);
      if (!vector) {
        vector = JSON.parse(row.embedding);
        vectorCache.set(row.id, vector);
      }
      return {
        text: row.text,
        name: row.name,
        pageNumber: row.page_number,
        score: cosineSimilarity(queryEmbedding, vector)
      };
    })
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
module.exports = { cosineSimilarity, retrieveChunks, clearRetrievalCache, getEmbeddingModelMismatch };
