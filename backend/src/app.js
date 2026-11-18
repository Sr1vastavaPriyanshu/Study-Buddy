const express = require("express");
const path = require("node:path");
const { createHash, timingSafeEqual } = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { createChatRouter } = require("./routes/chat");
const { createMemoryRouter } = require("./routes/memory");
const { createDocumentsRouter } = require("./routes/documents");
const { createConversationsRouter } = require("./routes/conversations");
const { getProviderRegistry } = require("./services/llm");

function createApp({ db, llm, embeddingLlm, env = process.env, frontendPath = path.resolve(__dirname, "../../frontend") }) {
  const app = express();
  const embeddingAdapter = embeddingLlm || llm;
  app.disable("x-powered-by");
  if (env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));
  if (env.APP_PASSWORD) {
    const expectedUsername = createHash("sha256").update("study-buddy").digest();
    const expectedPassword = createHash("sha256").update(env.APP_PASSWORD).digest();
    app.use(rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 50,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: "Too many authentication attempts. Please wait and try again."
    }));
    app.use((req, res, next) => {
      const authorization = req.get("authorization") || "";
      const match = authorization.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
      if (match) {
        const credentials = Buffer.from(match[1], "base64").toString("utf8");
        const separator = credentials.indexOf(":");
        if (separator >= 0) {
          const username = createHash("sha256").update(credentials.slice(0, separator)).digest();
          const password = createHash("sha256").update(credentials.slice(separator + 1)).digest();
          if (timingSafeEqual(username, expectedUsername) && timingSafeEqual(password, expectedPassword)) {
            return next();
          }
        }
      }
      res.set("WWW-Authenticate", 'Basic realm="Study Buddy", charset="UTF-8"');
      return res.status(401).type("text").send("Authentication required.");
    });
  }
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment and try again." }
  }));
  app.use("/api/chat", rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "You’re sending messages too quickly. Please wait a moment and try again." }
  }));
  app.use("/api/chat", createChatRouter(db, llm, embeddingAdapter, env));
  app.use("/api/memory", createMemoryRouter(db));
  app.use("/api/documents", createDocumentsRouter(db, llm, embeddingAdapter));
  app.use("/api/conversations", createConversationsRouter(db));
  app.get("/api/providers", (req, res) => {
    const registry = getProviderRegistry();
    const configured = {
      gemini: Boolean(env.GEMINI_API_KEY),
      openai: Boolean(env.OPENAI_API_KEY),
      anthropic: Boolean(env.ANTHROPIC_API_KEY)
    };
    res.json({
      defaultProvider: env.LLM_PROVIDER || "gemini",
      embeddingProvider: env.EMBEDDING_PROVIDER || "gemini",
      providers: Object.entries(registry).map(([id, provider]) => ({
        id,
        label: provider.label,
        configured: configured[id],
        supportsEmbeddings: provider.supportsEmbeddings,
        models: id === "gemini"
          ? [env.GEMINI_MODEL || provider.defaultModel]
          : id === "openai"
            ? [env.OPENAI_MODEL || provider.defaultModel]
            : [env.ANTHROPIC_MODEL || provider.defaultModel]
      }))
    });
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));
  app.use(express.static(frontendPath));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || (error.type === "entity.too.large" ? 413 : 500);
    let message = error.message;
    if (error.name === "MulterError") {
      status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      message = error.code === "LIMIT_FILE_SIZE"
        ? "That file is larger than 10 MB. Try a smaller file or split it up."
        : "The upload wasn't accepted. Choose a single PDF, TXT, MD, or CSV file.";
    } else if (error.type === "entity.parse.failed") {
      status = 400;
      message = "The request wasn't valid JSON.";
    } else if (error.type === "entity.too.large") {
      message = "That request is too large.";
    }
    if (status === 500) {
      console.error(error);
      message = "Something went wrong on the server. Please try again.";
    }
    return res.status(status).json({ error: message });
  });
  return app;
}

module.exports = { createApp };
