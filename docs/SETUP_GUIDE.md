# Study Buddy Setup Guide

## 1. Install Node.js

Windows and macOS users can download Node.js 22 LTS from https://nodejs.org/. On Linux, use your distribution package manager or NodeSource.

Verify:

```sh
node --version
npm --version
```

Both commands must work. Node must report 22.5 or newer.

## 2. Prepare the project

Extract the ZIP and open a terminal in the extracted project root. The project root contains `backend/`, `frontend/`, `.env.example`, `run.bat`, and `run.sh`.

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```sh
cp .env.example .env
```

## 3. Free API keys

The sample uses Groq for chat and Gemini for document embeddings. In `.env`, paste each key after the equals sign on its line; do not add quotes.

### Groq chat

1. Open [Groq Console API Keys](https://console.groq.com/keys) and sign in.
2. Select **Create API Key**, give it a name if prompted, and copy the key.
3. Paste it after `OPENAI_API_KEY=`. This project uses the `openai` provider setting for Groq's OpenAI-compatible API.
4. Keep `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, and `OPENAI_MODEL=openai/gpt-oss-120b`.
5. Find the exact current model ID in the [Groq model catalog](https://console.groq.com/docs/models). Use the ID, not the model's display name.

### Gemini document embeddings

1. Open [Google AI Studio API keys](https://aistudio.google.com/apikey) and sign in.
2. Select **Create API key** and choose or create a project if prompted.
3. Paste the key after `GEMINI_API_KEY=`.
4. Keep `EMBEDDING_PROVIDER=gemini`. The default embedding model is managed by the application; `GEMINI_MODEL=gemini-flash-latest` is for Gemini chat or fallback.
5. Find current Gemini chat model IDs in the [Gemini models guide](https://ai.google.dev/gemini-api/docs/models).

Restart the server after changing `.env`. Never share `.env`.

### Free local embedding alternative

To use Ollama instead of Gemini for document embeddings, install [Ollama](https://ollama.com/download), run `ollama pull nomic-embed-text`, and set:

```env
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Ollama runs locally, requires no API key or extra npm package, and must remain running while documents are uploaded or searched. Existing documents embedded by another provider should be re-uploaded to search them with the new embedding model.

## 4. Install and run

```sh
cd backend
npm install
npm start
```

Open http://127.0.0.1:3000.

Windows: run `run.bat`. macOS/Linux: run `sh run.sh`.

## 5. Using Study Buddy

- Choose chat, explain, quiz, or summary mode.
- Use the provider and model dropdowns if they are configured.
- Add memories manually or enter `remember ...`.
- Pin important memories, edit them, or delete them.
- Rename or delete saved conversations.
- Upload PDF, DOCX, TXT, MD, or CSV documents.
- Set a subject before uploading and select a retrieval subject while chatting.
- Open a document action for flashcards or a summary.
- PDF sources appear as `filename, p. N`.
- Export a conversation as Markdown from the sidebar.

## 6. Database and privacy

SQLite stores conversations, messages, memories, document text, chunks, and embeddings in `backend/study-buddy.db`. Back up this file and `.env`. Never share either.

Stop the server before copying or deleting database files. Reset by deleting `study-buddy.db`, `study-buddy.db-wal`, and `study-buddy.db-shm`.

The server binds to `127.0.0.1` by default. Do not expose it to the internet without authentication and HTTPS.

## 7. Troubleshooting

- **Node not found:** install Node.js 22.5+, reopen the terminal, and verify `node --version`.
- **npm install or better-sqlite3 failure:** Node 22.5+ supports the built-in SQLite fallback. Delete `backend/node_modules` and rerun `npm install`; on Windows use VS Build Tools if native installation is required.
- **Missing chat key:** set the API key for `LLM_PROVIDER` in `.env` (`OPENAI_API_KEY=` for Groq).
- **Document search needs the embedding provider:** check `EMBEDDING_PROVIDER` and the corresponding key (`GEMINI_API_KEY=` for Gemini). If using Ollama, check that it is running and the embedding model is installed.
- **404 model not found:** check that the model ID exactly matches the provider catalog and that `OPENAI_BASE_URL` points to the same provider. Retired IDs stop working; use a currently listed model.
- **429 quota or rate limit:** wait before retrying, check the provider's free-tier quota, reduce request volume, or use another configured provider.
- **503 overloaded:** the app retries streaming requests before any text and falls back once to another configured chat provider. If it persists, check the provider status page or use a different model/provider.
- **Port in use:** set `PORT=3001` or another free port in `.env`.
- **Scanned PDF:** scanned text may not be extractable; OCR the PDF first.
- **File too large:** the upload limit is 10 MB per file and 600 chunks.
- **Blank page:** hard-refresh; confirm the server is at 127.0.0.1 and inspect browser console/network errors.
- **PowerShell execution restrictions:** use `run.bat`, Command Prompt, or set an appropriate process-scope execution policy only if your administrator permits it.

## 8. Project folders

- `backend/src/server.js`: process entry point
- `backend/src/app.js`: Express routes and static frontend
- `backend/src/db/database.js`: SQLite schema/migrations
- `backend/src/routes/`: HTTP endpoints
- `backend/src/services/providers/`: AI provider adapters
- `backend/src/services/documents.js`: text extraction and chunking
- `backend/src/services/retrieval.js`: document similarity search
- `frontend/`: browser UI and local vendor assets
- `docs/`: API and setup documentation

## 9. Adding a provider

Create a module in `backend/src/services/providers/` implementing `generate`, `generateStream`, `embed`, and `embedMany`. Register it in `backend/src/services/llm.js`, add its environment variables, and expose non-secret model metadata through `GET /api/providers`.
