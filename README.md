# Study Buddy

Study Buddy is a local AI tutor for students. It supports chat modes, persistent conversations and memories, PDF/DOCX/TXT/MD/CSV document search, flashcards, summaries, subjects, provider switching, and Markdown/KaTeX answers.

## Prerequisites

- Windows, macOS, or Linux
- [Node.js 22.5 or newer](https://nodejs.org/)
- Optional: [Git](https://git-scm.com/downloads) if cloning
- A code editor, for example [Visual Studio Code](https://code.visualstudio.com/)

## Free API keys

The sample configuration uses Groq for chat and Gemini for document embeddings. Copy `.env.example` to `.env`, then fill in the key lines:

- **Groq chat:** open [Groq Console API Keys](https://console.groq.com/keys), sign in, choose **Create API Key**, and copy the key into `OPENAI_API_KEY=`. Keep `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, and `OPENAI_MODEL=openai/gpt-oss-120b`. The provider is named `openai` because Groq supports the OpenAI-compatible API.
- **Gemini document embeddings:** open [Google AI Studio API keys](https://aistudio.google.com/apikey), sign in, choose **Create API key**, and select or create a project if prompted. Copy that key into `GEMINI_API_KEY=` and keep `EMBEDDING_PROVIDER=gemini`.

The model fields contain model IDs, not display names. Find Groq IDs in the [Groq model catalog](https://console.groq.com/docs/models) and Gemini IDs in the [Gemini models guide](https://ai.google.dev/gemini-api/docs/models). Use the exact ID shown by the provider; models can be retired.

For a free local embedding alternative, install [Ollama](https://ollama.com/download), run `ollama pull nomic-embed-text`, then set `EMBEDDING_PROVIDER=ollama`. No Ollama API key or extra npm package is needed. Ollama must be running on the computer hosting Study Buddy.

## Windows quick start

1. Extract the ZIP or clone the repository.
2. Open PowerShell or Command Prompt in the project root.
3. Copy `.env.example` to `.env`.
4. Follow **Free API keys** above and fill the Groq chat and Gemini embedding key lines.
5. Run:
   ```powershell
   cd backend
   npm install
   npm start
   ```
6. Open http://127.0.0.1:3000.

Alternatively, double-click `run.bat` in the project root.

## macOS/Linux quick start

```sh
cd /path/to/study-buddy
cp .env.example .env
cd backend
npm install
npm start
```

Open http://127.0.0.1:3000. The `run.sh` alternative creates `.env`, installs dependencies when needed, starts the server, and opens the browser.

## Configuration

- `LLM_PROVIDER=openai` selects the OpenAI-compatible chat provider (Groq in the sample configuration). Other supported chat providers are `gemini` and `anthropic`.
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`
- `EMBEDDING_PROVIDER=gemini` or `ollama`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_EMBEDDING_MODEL=nomic-embed-text`
- `HOST=127.0.0.1` and `PORT=3000`
- `DB_PATH=backend/study-buddy.db`

Groq, OpenRouter, and other OpenAI-compatible chat services use `OPENAI_BASE_URL`. Groq does not provide the document embedding endpoint used by this app; use Gemini or local Ollama for embeddings.

## Deploy to Render

Create a **Web Service** from this repository and use these settings:

- **Root Directory:** leave blank (repository root; the frontend is a sibling of `backend/`)
- **Build Command:** `npm ci --prefix backend`
- **Start Command:** `npm --prefix backend start`
- **Health Check Path:** `/healthz`
- **Environment:** `NODE_VERSION=22.23.5`, `NODE_ENV=production`, `TRUST_PROXY=1`, and a random `APP_PASSWORD` of at least 16 characters. The browser will ask for HTTP Basic Auth credentials: username `study-buddy`, password the value of `APP_PASSWORD`.
- Configure the selected chat provider's key and model, and `EMBEDDING_PROVIDER` plus its key. For the sample defaults, set `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1`, `OPENAI_MODEL=openai/gpt-oss-120b`, `EMBEDDING_PROVIDER=gemini`, and `GEMINI_API_KEY`.

Render supplies `PORT`; do not set it manually. Leave `HOST` unset on Render so production binds to `0.0.0.0`. Locally, `.env` keeps `HOST=127.0.0.1`. `DB_PATH` is optional; without it the app uses `backend/study-buddy.db`.

**Render describes Free as unsuitable for production. It has an ephemeral filesystem and no persistent disks.** SQLite conversations, memories, uploaded document text, and embeddings can disappear on spin-down, restart, redeploy, or instance replacement. Free instances spin down after 15 minutes idle and can take about a minute to wake. This deployment is a single shared workspace, not a multi-user service. Keep backups off the service if its data matters. Persistent SQLite storage requires a hosting option with a persistent disk; no database or paid service is provisioned by this project.

## Troubleshooting

- **404 model not found:** use the exact model ID in the provider catalog and make sure `OPENAI_BASE_URL` points to that provider. Retired model IDs stop working.
- **429 quota or rate limit:** wait before retrying, check the provider's free-tier quota, reduce request volume, or use another configured provider.
- **503 overloaded:** streaming retries before the first token and chat falls back once to another configured provider. If it persists, check provider status or use another model/provider.
- **Document embedding error:** check `EMBEDDING_PROVIDER` and the matching key, or confirm Ollama is running with its model installed.

## Features

Use the sidebar to switch study modes and AI providers/models. Ask normally or type `remember ...` to persist a fact. Use the memory controls to edit or pin facts. Rename or delete chats from the chat list.

Upload PDF, DOCX, TXT, MD, or CSV files. Assign an optional subject and use the subject selector to restrict retrieval. PDF answers cite `filename, p. N`. Flashcards and summaries create saved conversations.

## Database

The SQLite database is `backend/study-buddy.db` by default. Copy this file and the `.env` file to back up private data.

To reset, stop the server and delete `backend/study-buddy.db`, `backend/study-buddy.db-wal`, and `backend/study-buddy.db-shm`.

## Tests

```sh
cd backend
npm test
```

See [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) for troubleshooting and detailed setup.
