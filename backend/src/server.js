require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env") });
const path = require("node:path");
const { createDatabase } = require("./db/database");
const { createLlmAdapter, createEmbeddingAdapter } = require("./services/llm");
const { createApp } = require("./app");

const projectRoot = path.resolve(__dirname, "../..");
const databasePath = process.env.DB_PATH
  ? path.resolve(projectRoot, process.env.DB_PATH)
  : path.resolve(projectRoot, "backend/study-buddy.db");
const db = createDatabase(databasePath);
const llm = createLlmAdapter();
const embeddingLlm = createEmbeddingAdapter();
const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
const providerKey = {
  gemini: process.env.GEMINI_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY
}[provider];
if (!providerKey) {
  const names = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
  console.warn(`\n!! ${names[provider] || "An AI provider API key"} is not set. Configure .env and restart.\n`);
}
const app = createApp({ db, llm, embeddingLlm });
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";

const server = app.listen(port, host, () => {
  console.log(`Study Buddy is running at http://${host}:${port}`);
});
server.on("error", error => {
  if (error.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Set PORT in .env or stop the other program.`);
  else console.error(error);
  process.exit(1);
});
