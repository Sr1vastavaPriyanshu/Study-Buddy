function tokenize(text) {
  return new Set(String(text).toLowerCase().match(/[a-z0-9]+/g)?.filter(word => word.length > 2) || []);
}

function selectRelevantMemories(db, question, limit = 5) {
  const memories = db.prepare("SELECT id, text, pinned FROM memory ORDER BY id").all();
  const pinned = memories.filter(memory => memory.pinned === 1);
  const queryWords = tokenize(question);
  const unpinned = memories.filter(memory => memory.pinned !== 1);
  const ranked = unpinned.length <= 1
    ? unpinned.map(memory => ({ id: memory.id, text: memory.text, pinned: memory.pinned }))
    : unpinned
      .map(memory => {
        const memoryWords = tokenize(memory.text);
        let score = 0;
        for (const word of queryWords) if (memoryWords.has(word)) score += 1;
        return { ...memory, score };
      })
      .filter(memory => memory.score > 0)
      .sort((a, b) => b.score - a.score || a.id - b.id)
      .slice(0, limit)
      .map(({ id, text, pinned }) => ({ id, text, pinned }));
  const selected = new Map();
  for (const memory of [...pinned, ...ranked]) selected.set(memory.id, memory);
  return [...selected.values()].slice(0, limit + pinned.length);
}

module.exports = { selectRelevantMemories, tokenize };
