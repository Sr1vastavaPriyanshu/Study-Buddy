const express = require("express");
const { retrieveChunks, getEmbeddingModelMismatch } = require("../services/retrieval");
const { createProviderAdapter, getProviderRegistry } = require("../services/llm");
const { selectRelevantMemories } = require("../services/memory");
const { isTransientProviderError, isRetryableStreamError } = require("../services/providers/errors");

const STREAM_RETRY_LIMIT = 3;
const STREAM_RETRY_DELAY_MS = 250;

async function* generateStreamWithRetry(llm, input) {
  for (let attempt = 1; ; attempt += 1) {
    let receivedText = false;
    try {
      for await (const delta of llm.generateStream(input)) {
        if (delta) receivedText = true;
        yield delta;
      }
      return;
    } catch (error) {
      if (receivedText || attempt >= STREAM_RETRY_LIMIT || !isRetryableStreamError(error, input.signal)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, STREAM_RETRY_DELAY_MS * (2 ** (attempt - 1))));
    }
  }
}

function findFallbackProvider(env, excludedProvider) {
  const configured = [
    ["gemini", "GEMINI_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
    ["anthropic", "ANTHROPIC_API_KEY"]
  ];
  return configured.find(([id, key]) => id !== excludedProvider && Boolean(env[key]))?.[0];
}

function providerLabel(provider, env) {
  if (provider === "openai" && /api\.groq\.com/i.test(env.OPENAI_BASE_URL || "")) {
    return "Groq (OpenAI-compatible)";
  }
  return getProviderRegistry()[provider]?.label || provider;
}

function fallbackNotice(provider, previousProvider, env) {
  return `Answered by ${providerLabel(provider, env)} after ${providerLabel(previousProvider, env)} was unavailable.\n\n`;
}

async function* generateStreamWithFallback(llm, selectedProvider, input, env, activeProvider) {
  let receivedText = false;
  try {
    for await (const delta of generateStreamWithRetry(llm, input)) {
      if (delta) receivedText = true;
      yield delta;
    }
    return;
  } catch (error) {
    const fallbackProvider = receivedText ? null : findFallbackProvider(env, selectedProvider);
    if (!fallbackProvider || !isTransientProviderError(error, input.signal)) throw error;

    const fallbackLlm = createProviderAdapter(fallbackProvider, env);
    const iterator = generateStreamWithRetry(fallbackLlm, input)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error("The AI service returned an empty answer. Please try again.");
    activeProvider.id = fallbackProvider;
    yield fallbackNotice(fallbackProvider, selectedProvider, env);
    yield first.value;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
}

async function generateWithFallback(llm, selectedProvider, input, env) {
  try {
    return { reply: await llm.generate(input), provider: selectedProvider };
  } catch (error) {
    const fallbackProvider = findFallbackProvider(env, selectedProvider);
    if (!fallbackProvider || !isTransientProviderError(error)) throw error;

    const fallbackLlm = createProviderAdapter(fallbackProvider, env);
    const reply = await fallbackLlm.generate(input);
    return {
      reply: `${fallbackNotice(fallbackProvider, selectedProvider, env)}${reply}`,
      provider: fallbackProvider,
      fallbackFrom: selectedProvider
    };
  }
}

const MODES = {
  chat: "Answer clearly and helpfully.",
  explain: "Explain like a patient tutor: start with the core idea in plain words, then an everyday example, then a short recap. Avoid jargon or define it.",
  quiz: "Act as a quiz coach: ask ONE question at a time, wait for the answer, then give feedback and the next question. Adjust difficulty to how I do.",
  summary: "Give concise study notes: key points as short bullets, important terms in bold, and a one-line takeaway."
};

function createChatRouter(db, llm, embeddingLlm = llm, env = process.env) {
  const router = express.Router();
  router.post("/", async (req, res, next) => {
    try {
      const { messages, mode = "explain", conversationId, provider, model, subject = "" } = req.body || {};
      if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40
        || messages.some(message => !message || !["user", "bot"].includes(message.role)
          || typeof message.text !== "string" || !message.text.trim() || message.text.length > 12000)) {
        return res.status(400).json({ error: "Send 1–40 messages with a valid user/bot role and text under 12,000 characters." });
      }
      if (!Object.prototype.hasOwnProperty.call(MODES, mode)) {
        return res.status(400).json({ error: "Choose a valid study mode." });
      }
      const latest = messages[messages.length - 1];
      if (latest.role !== "user") {
        return res.status(400).json({ error: "The last message must be from the user." });
      }

      let retrieved = [];
      try {
        retrieved = await retrieveChunks(db, embeddingLlm, latest.text, 4, undefined, subject);
      } catch (error) {
        // Document search is a bonus; if embedding fails, still answer the question.
        console.error("Document search failed:", error.message);
      }
      const memory = selectRelevantMemories(db, latest.text).map(row => row.text);
      let system = `You are Study Buddy, a friendly, accurate tutor for students. ${MODES[mode]} If you aren’t sure, say so instead of guessing.`;
      if (memory.length) system += `\n\nThings to remember about this student:\n- ${memory.join("\n- ")}`;
      if (retrieved.length) {
        system += `\n\nExcerpts from the student’s documents (use them when relevant and say which file they came from):\n${retrieved.map(item => `[${item.name}] ${item.text}`).join("\n\n")}`;
      }
      const sources = [...new Set(retrieved.map(item => {
        if (/\.pdf$/i.test(item.name) && item.pageNumber) return `${item.name}, p. ${item.pageNumber}`;
        return item.name;
      }))];
      const warnings = getEmbeddingModelMismatch(db, embeddingLlm).map(item =>
        `${item.name} was embedded with ${item.storedModel}; retrieval is currently using ${item.currentModel}. Re-upload or re-index it.`
      );
      const selectedProvider = String(provider || env.LLM_PROVIDER || "gemini").toLowerCase();
      let responseLlm = llm;
      if (provider) {
        const requestEnv = { ...env };
        if (provider === "gemini" && model) requestEnv.GEMINI_MODEL = model;
        if (provider === "openai" && model) requestEnv.OPENAI_MODEL = model;
        if (provider === "anthropic" && model) requestEnv.ANTHROPIC_MODEL = model;
        responseLlm = createProviderAdapter(provider, requestEnv);
      }
      let activeConversationId = Number(conversationId);
      const ensureConversation = () => {
        if (!activeConversationId || !db.prepare("SELECT id FROM conversations WHERE id = ?").get(activeConversationId)) {
          const title = latest.text.trim().slice(0, 80) || "New chat";
          activeConversationId = Number(db.prepare(
            "INSERT INTO conversations (title, mode, subject) VALUES (?, ?, ?)"
          ).run(title, mode, subject).lastInsertRowid);
        } else {
          db.prepare("UPDATE conversations SET mode = ?, subject = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(mode, subject, activeConversationId);
        }
      };
      const insertMessage = db.prepare(
        "INSERT INTO messages (conversation_id, role, text, sources) VALUES (?, ?, ?, ?)"
      );
      if (req.body.stream === true) {
        ensureConversation();
        insertMessage.run(activeConversationId, latest.role, latest.text, "[]");
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        res.set({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        // Tell the browser the conversation id right away, so Stop doesn't lose it.
        res.write(`data: ${JSON.stringify({ conversationId: activeConversationId })}\n\n`);
        let reply = "";
        const activeProvider = { id: selectedProvider };
        try {
          for await (const delta of generateStreamWithFallback(responseLlm, selectedProvider, {
            system,
            messages: messages.slice(-20).map(message => ({ role: message.role, text: message.text })),
            signal: controller.signal
          }, env, activeProvider)) {
            if (controller.signal.aborted) break;
            reply += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
          if (controller.signal.aborted) {
            // The student pressed Stop: keep what was written so reloads match the screen.
            if (reply.trim()) {
              insertMessage.run(activeConversationId, "bot", reply, JSON.stringify(sources));
              db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(activeConversationId);
            }
            return;
          }
          if (!reply.trim()) throw new Error("The AI service returned an empty answer. Please try again.");
          insertMessage.run(activeConversationId, "bot", reply, JSON.stringify(sources));
          db.prepare("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(activeConversationId);
          res.write(`data: ${JSON.stringify({
            done: true,
            sources,
            warnings,
            conversationId: activeConversationId,
            provider: activeProvider.id,
            fallbackFrom: activeProvider.id === selectedProvider ? undefined : selectedProvider
          })}\n\n`);
          return res.end();
        } catch (error) {
          if (controller.signal.aborted) {
            if (reply.trim()) insertMessage.run(activeConversationId, "bot", reply, JSON.stringify(sources));
            return;
          }
          console.error(error);
          res.write(`data: ${JSON.stringify({ error: error.status ? error.message : "The AI service couldn’t finish the response. Please try again." })}\n\n`);
          return res.end();
        }
      }

      const generated = await generateWithFallback(responseLlm, selectedProvider, {
        system,
        messages: messages.slice(-20).map(message => ({ role: message.role, text: message.text }))
      }, env);
      const { reply } = generated;
      const save = db.transaction(() => {
        ensureConversation();
        const insertMessage = db.prepare(
          "INSERT INTO messages (conversation_id, role, text, sources) VALUES (?, ?, ?, ?)"
        );
        insertMessage.run(activeConversationId, latest.role, latest.text, "[]");
        insertMessage.run(activeConversationId, "bot", reply, JSON.stringify(sources));
      });
      save();
      return res.json({
        reply,
        sources,
        warnings,
        conversationId: activeConversationId,
        provider: generated.provider,
        fallbackFrom: generated.fallbackFrom
      });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = { MODES, createChatRouter };
