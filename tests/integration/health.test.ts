import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../../apps/api/src/config.js";
import { buildServer } from "../../apps/api/src/server.js";
import live from "../fixtures/health/live.json" with { type: "json" };
import ready from "../fixtures/health/ready.json" with { type: "json" };

describe("Fastify and SQLite", () => {
  let dataDir: string;
  let staticRoot: string;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "wayfarer-"));
    staticRoot = join(dataDir, "public");
    await mkdir(staticRoot);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await rm(dataDir, { recursive: true, force: true });
  });

  function boot() {
    app = buildServer(readConfig({ DATA_DIR: dataDir }), staticRoot);
    return app;
  }

  function inspect() {
    return new Database(join(dataDir, "wayfarer.db"));
  }

  function snapshot() {
    const db = inspect();
    try {
      return {
        migrations: db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all(),
        metadata: db.prepare("SELECT key, value FROM app_meta WHERE key IN (?, ?) ORDER BY key").all("created_at", "instance_id"),
      };
    } finally {
      db.close();
    }
  }

  it("returns both health responses with security headers", async () => {
    const server = boot();
    for (const [path, body] of [["live", live], ["ready", ready]] as const) {
      const response = await server.inject(`/health/${path}`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(body);
      expect(response.headers).toMatchObject({
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
    }
  });

  it("caches hashed assets while revalidating the page", async () => {
    await mkdir(join(staticRoot, "assets"));
    await writeFile(join(staticRoot, "index.html"), "<title>Wayfarer</title>");
    await writeFile(join(staticRoot, "assets", "index-ABCD1234.js"), "export {};");
    const server = boot();

    const page = await server.inject("/");
    expect(page.statusCode).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-cache");
    const asset = await server.inject("/assets/index-ABCD1234.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("returns a generic envelope for an unexpected exception", async () => {
    const server = boot();
    server.get("/test/failure", () => {
      throw new Error("internal fixture details");
    });

    const response = await server.inject("/test/failure");
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed" },
      requestId: expect.any(String),
    });
  });

  it("preserves the migration and metadata across two boots of the same directory", async () => {
    boot();
    const before = snapshot();
    expect(before.migrations).toEqual([
      { version: 1, name: "0001_init.sql", applied_at: expect.any(String) },
      { version: 2, name: "0002_accounts.sql", applied_at: expect.any(String) },
    ]);
    expect(before.metadata).toEqual([
      { key: "created_at", value: expect.any(String) },
      { key: "instance_id", value: expect.stringMatching(/^[a-f0-9]{32}$/) },
    ]);

    await app?.close();
    app = undefined;
    boot();
    expect(snapshot()).toEqual(before);
  });

  it("refuses to start against an unknown newer version", async () => {
    boot();
    await app?.close();
    app = undefined;
    const db = inspect();
    try {
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(9000, "9000_future.sql", new Date().toISOString());
    } finally {
      db.close();
    }
    expect(() => boot()).toThrow("newer than this build");
  });

  it("keeps liveness up when readiness sees the wrong version or a failed read", async () => {
    const server = boot();
    const db = inspect();
    try {
      db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(2);
      const wrongVersion = await server.inject("/health/ready");
      expect(wrongVersion.statusCode).toBe(503);
      expect(wrongVersion.json()).toEqual({ status: "not_ready" });
      db.exec("DROP TABLE schema_migrations");
    } finally {
      db.close();
    }
    const failedRead = await server.inject("/health/ready");
    expect(failedRead.statusCode).toBe(503);
    expect(failedRead.json()).toEqual({ status: "not_ready" });
    expect((await server.inject("/health/live")).json()).toEqual(live);
  });
});

describe("startup config", () => {
  it("ignores an ambient key in mock mode", () => {
    expect(readConfig({ GEMINI_API_KEY: "fixture" })).toEqual({
      HOST: "127.0.0.1", PORT: 8080, DATA_DIR: "/data", PROVIDER: "mock",
      ALLOWED_ORIGINS: ["http://127.0.0.1:8080", "http://localhost:8080"], LOCAL_HTTP_COOKIES: false,
    });
  });

  it("requires a key in Gemini mode and excludes secret values from results and errors", () => {
    expect(() => readConfig({ PROVIDER: "gemini" })).toThrow("GEMINI_API_KEY is required");
    expect(readConfig({ PROVIDER: "gemini", GEMINI_API_KEY: "fixture" })).not.toHaveProperty("GEMINI_API_KEY");
    expect(() => readConfig({ PORT: "fixture" })).toThrow(/^Invalid configuration for PORT$/);
  });
});
