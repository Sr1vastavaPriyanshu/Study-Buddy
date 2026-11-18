const test = require("node:test");
const request = require("supertest");
const { createDatabase } = require("../src/db/database");
const { createApp } = require("../src/app");

test("health check is public while application routes require the configured password", async () => {
  const db = createDatabase(":memory:");
  const app = createApp({
    db,
    llm: { generate: async () => "ok" },
    env: { APP_PASSWORD: "a-secure-deployment-password" }
  });
  try {
    await request(app).get("/healthz").expect(200, { status: "ok" });
    await request(app).get("/").expect("WWW-Authenticate", /Basic/).expect(401);
    await request(app).get("/api/providers").expect(401);
    await request(app)
      .get("/api/providers")
      .auth("study-buddy", "a-secure-deployment-password")
      .expect(200);
  } finally {
    db.close();
  }
});
