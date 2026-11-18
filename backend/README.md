# Backend

Express + SQLite. Entry: `src/server.js`. App wiring: `src/app.js`.

- `src/routes/` chat, memory, documents (+flashcards), conversations
- `src/services/` llm (Gemini adapter), documents (extract + chunk), retrieval (cosine search)
- `src/db/database.js` schema; uses better-sqlite3, or built-in `node:sqlite` as fallback

Run `npm test`. See ../README.md and ../docs/API.md.
