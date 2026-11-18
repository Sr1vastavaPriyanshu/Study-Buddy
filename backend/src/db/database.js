// SQLite access. Prefers better-sqlite3 (fast, native). If it isn't installed
// (e.g. its binary download was blocked), falls back to Node's built-in
// node:sqlite (Node 22.5+), wrapped to expose the same small API.

function openBetterSqlite(filename) {
  let Database;
  try {
    Database = require("better-sqlite3");
    return new Database(filename);
  } catch (error) {
    return null;
  }
}

function openNodeSqlite(filename) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (error) {
    throw new Error(
      "No SQLite driver available. Run `npm install` in backend/ (installs better-sqlite3), " +
      "or use Node 22.5 or newer, which has a built-in driver."
    );
  }
  const raw = new DatabaseSync(filename);
  const plain = row => (row ? { ...row } : row);
  const wrapper = {
    exec: sql => raw.exec(sql),
    pragma: text => raw.exec(`PRAGMA ${text}`),
    prepare(sql) {
      const statement = raw.prepare(sql);
      return {
        run: (...args) => statement.run(...args),
        get: (...args) => plain(statement.get(...args)),
        all: (...args) => statement.all(...args).map(plain)
      };
    },
    transaction(fn) {
      return (...args) => {
        raw.exec("BEGIN");
        try {
          const result = fn(...args);
          raw.exec("COMMIT");
          return result;
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      };
    },
    close: () => raw.close()
  };
  return wrapper;
}

function createDatabase(filename = process.env.DB_PATH || "study-buddy.db") {
  const db = openBetterSqlite(filename) || openNodeSqlite(filename);
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      embedding_model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      page_number INTEGER NOT NULL DEFAULT 1,
      embedding TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New chat',
      mode TEXT NOT NULL DEFAULT 'explain',
      subject TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'bot')),
      text TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  `);
  const memoryColumns = db.prepare("PRAGMA table_info(memory)").all();
  if (!memoryColumns.some(column => column.name === "pinned")) {
    db.exec("ALTER TABLE memory ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }
  const documentColumns = db.prepare("PRAGMA table_info(documents)").all();
  if (!documentColumns.some(column => column.name === "subject")) {
    db.exec("ALTER TABLE documents ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
  }
  if (!documentColumns.some(column => column.name === "embedding_model")) {
    db.exec("ALTER TABLE documents ADD COLUMN embedding_model TEXT NOT NULL DEFAULT ''");
  }
  const chunkColumns = db.prepare("PRAGMA table_info(chunks)").all();
  if (!chunkColumns.some(column => column.name === "page_number")) {
    db.exec("ALTER TABLE chunks ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1");
  }
  const conversationColumns = db.prepare("PRAGMA table_info(conversations)").all();
  if (!conversationColumns.some(column => column.name === "subject")) {
    db.exec("ALTER TABLE conversations ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
  }
  return db;
}

module.exports = { createDatabase };
