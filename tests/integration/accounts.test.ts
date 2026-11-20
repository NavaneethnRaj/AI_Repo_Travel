import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { SessionResponse, TripListResponse, TripView } from "@wayfarer/contracts";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as passwords from "../../apps/api/src/auth/passwords.js";
import { readConfig } from "../../apps/api/src/config.js";
import { HttpError } from "../../apps/api/src/http.js";
import { buildServer } from "../../apps/api/src/server.js";

const origin = "http://127.0.0.1:8080";
const password = "fixture passphrase 123";
const hour = 60 * 60 * 1000;
const renameBody = (title: string, baseRevision = 0) => ({
  clientId: randomUUID(), baseRevision, ops: [{ kind: "renameTrip", title }],
});

describe("WP2 HTTP accounts and trips", () => {
  let dataDir: string;
  let app: ReturnType<typeof buildServer>;
  let now: number;

  function boot(local = true, logStream?: PassThrough) {
    app = buildServer(
      readConfig({ DATA_DIR: dataDir, LOCAL_HTTP_COOKIES: local ? "1" : "0" }),
      join(dataDir, "public"),
      { clock: () => now, logStream },
    );
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "wayfarer-accounts-"));
    await mkdir(join(dataDir, "public"));
    now = Date.parse("2026-11-20T12:00:00Z");
    boot();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  class Jar {
    cookie = "";
    csrf = "";

    constructor(readonly ip = "127.0.0.1") {}

    async send(
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      body?: unknown,
      overrides: Record<string, string | undefined> = {},
    ) {
      const suppliedHeaders = {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { origin, "x-csrf-token": this.csrf }),
        ...overrides,
      };
      const response = await app.inject({
        method,
        url: `/api/v1${path}`,
        remoteAddress: this.ip,
        headers: Object.fromEntries(Object.entries(suppliedHeaders).filter(([, value]) => value !== undefined)),
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
      expect(response.headers["cache-control"]).toBe("no-store");
      const header = response.headers["set-cookie"];
      const cookie = Array.isArray(header) ? header[0] : header;
      if (cookie) this.cookie = cookie.split(";", 1)[0] ?? "";
      if (path === "/session" || (path.startsWith("/auth/") && response.statusCode < 204)) {
        if (response.statusCode === 200 || response.statusCode === 201) {
          this.csrf = response.json<SessionResponse>().csrfToken;
        }
      }
      return response;
    }

    async register(email: string, value = password) {
      await this.send("GET", "/session");
      return this.send("POST", "/auth/register", { email, password: value });
    }

    async login(email: string, value = password) {
      await this.send("GET", "/session");
      return this.send("POST", "/auth/login", { email, password: value });
    }
  }

  async function account(email: string, jar = new Jar()) {
    expect((await jar.register(email)).statusCode).toBe(201);
    return jar;
  }

  async function trip(jar: Jar, title = "First trip", clientId = randomUUID()) {
    const response = await jar.send("POST", "/trips", { title, currency: "EUR", clientId });
    expect(response.statusCode).toBe(201);
    return response.json<{ trip: TripView }>().trip;
  }

  async function list(jar: Jar, query = "") {
    const response = await jar.send("GET", `/trips${query}`);
    expect(response.statusCode).toBe(200);
    return response.json<TripListResponse>();
  }

  it("isolates lists, reads and writes by owner", async () => {
    const a = await account("A@example.test");
    const b = await account("b@example.test");
    const aTrip = await trip(a);
    const bTrip = await trip(b, "Second trip");
    expect((await list(a)).items.map(({ id }) => id)).toEqual([aTrip.id]);
    expect((await list(b)).items.map(({ id }) => id)).toEqual([bTrip.id]);
    expect((await b.send("GET", `/trips/${aTrip.id}`)).statusCode).toBe(404);
    expect((await b.send("PATCH", `/trips/${aTrip.id}/board`, renameBody("Forbidden rename"))).statusCode).toBe(404);
    const own = await a.send("GET", `/trips/${aTrip.id}`);
    expect(own.json()).toEqual({ trip: aTrip });
  });

  it("rotates both anonymous credentials on register and login and revokes them on logout", async () => {
    const jar = new Jar();
    const initial = await jar.send("GET", "/session");
    expect(initial.json().user).toBeNull();
    expect(initial.headers["set-cookie"]).toMatch(/^wayfarer_local_session=.*; Path=\/; HttpOnly; SameSite=Lax/);
    const preRegister = { cookie: jar.cookie, csrf: jar.csrf };
    const registered = await jar.send("POST", "/auth/register", { email: "  Mixed@Example.test  ", password });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().user.email).toBe("Mixed@Example.test");
    expect(jar.cookie).not.toBe(preRegister.cookie);
    expect(jar.csrf).not.toBe(preRegister.csrf);
    const old = Object.assign(new Jar(), preRegister);
    expect((await old.send("POST", "/auth/login", { email: "mixed@example.test", password })).statusCode).toBe(403);
    const registeredCookie = jar.cookie;
    const logout = await jar.send("POST", "/auth/logout", {});
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const revoked = Object.assign(new Jar(), { cookie: registeredCookie });
    expect((await revoked.send("GET", "/trips")).statusCode).toBe(401);

    await jar.send("GET", "/session");
    const preLogin = { cookie: jar.cookie, csrf: jar.csrf };
    expect((await jar.send("POST", "/auth/login", { email: "mixed@example.test", password })).statusCode).toBe(200);
    expect(jar.cookie).not.toBe(preLogin.cookie);
    expect(jar.csrf).not.toBe(preLogin.csrf);
    expect((await Object.assign(new Jar(), preLogin).send("GET", "/trips")).statusCode).toBe(401);

    const token = jar.cookie.split("=")[1] ?? "";
    const db = new Database(join(dataDir, "wayfarer.db"), { readonly: true });
    try {
      const row = db.prepare<[], { token_digest: Buffer }>(
        "SELECT token_digest FROM sessions WHERE user_id IS NOT NULL",
      ).get();
      expect(row?.token_digest).toEqual(createHash("sha256").update(token).digest());
    } finally {
      db.close();
    }
  });

  it("requires exact Origin and a valid synchronizer token on every unsafe API route", async () => {
    const jar = await account("csrf@example.test");
    const saved = await trip(jar);
    const credentials = { email: "csrf@example.test", password };
    const requests = [
      ["POST", "/auth/register", credentials], ["POST", "/auth/login", credentials],
      ["POST", "/auth/logout", {}], ["POST", "/trips", {}],
      ["PATCH", `/trips/${saved.id}/board`, renameBody("Forbidden")],
      ["DELETE", `/trips/${saved.id}`, undefined],
    ] as const;
    for (const [method, route, body] of requests) {
      for (const headers of [
        { origin: undefined }, { origin: `${origin}/` }, { origin: "https://evil.example" },
        { "x-csrf-token": undefined }, { "x-csrf-token": "a".repeat(43) },
      ]) {
        const response = await jar.send(method, route, body, headers);
        expect(response.statusCode, `${method} ${route}`).toBe(403);
        expect(response.json().error.code).toBe("CSRF_REJECTED");
        expect(response.headers["set-cookie"]).toBeUndefined();
        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      }
    }
  });

  it("limits the sixth account failure and persists it across restart", async () => {
    await account("known@example.test");
    const jar = new Jar();
    await jar.send("GET", "/session");
    const attempts = { email: "KNOWN@example.test", password: "wrong passphrase" };
    for (let count = 0; count < 5; count++) {
      expect((await jar.send("POST", "/auth/login", attempts)).statusCode).toBe(401);
    }
    await app.close();
    boot();
    const limited = await jar.send("POST", "/auth/login", attempts);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("900");
    expect(limited.json().error.retryAfterSeconds).toBe(900);
    now += 900_000;
    expect((await jar.send("POST", "/auth/login", attempts)).statusCode).toBe(401);
  });

  it("limits the twenty-first failure from one socket IP and ignores forwarding headers", async () => {
    const jar = new Jar("192.0.2.1");
    await jar.send("GET", "/session");
    for (let index = 0; index < 21; index++) {
      const response = await jar.send("POST", "/auth/login", {
        email: `missing${index}@example.test`, password,
      }, { "x-forwarded-for": `198.51.100.${index + 1}` });
      expect(response.statusCode).toBe(index === 20 ? 429 : 401);
      if (index === 20) expect(response.headers["retry-after"]).toBe("900");
    }
  });

  it("limits the sixth registration from an IP", async () => {
    for (let index = 0; index < 6; index++) {
      const response = await new Jar().register(`signup${index}@example.test`);
      expect(response.statusCode).toBe(index === 5 ? 429 : 201);
      if (index === 5) expect(response.json().error.retryAfterSeconds).toBe(3600);
    }
  });

  it("lets a valid sign-up through after five invalid registration bodies", async () => {
    const jar = new Jar();
    const email = "validation-quota@example.test";
    await jar.send("GET", "/session");
    for (let count = 0; count < 5; count++) {
      const response = await jar.send("POST", "/auth/register", { email, password: "short" });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.field).toBe("password");
    }
    expect((await jar.send("POST", "/auth/register", { email, password })).statusCode).toBe(201);
  });

  it("refunds the registration quota when hashing is unavailable", async () => {
    const busy = new HttpError(503, { code: "AUTH_BUSY", message: "Authentication is temporarily busy" });
    vi.spyOn(passwords, "hashPassword").mockRejectedValueOnce(busy);
    expect((await new Jar().register("busy@example.test")).statusCode).toBe(503);
    for (let index = 0; index < 5; index++) {
      expect((await new Jar().register(`retry${index}@example.test`)).statusCode).toBe(201);
    }
    expect((await new Jar().register("limited@example.test")).statusCode).toBe(429);
  });

  it("limits the sixty-first board write per owner and persists the window", async () => {
    const jar = await account("board-limit@example.test");
    const saved = await trip(jar);
    const path = `/trips/${saved.id}/board`;
    const body = renameBody("Updated");
    for (let count = 0; count < 60; count++) {
      expect((await jar.send("PATCH", path, body)).statusCode).toBe(200);
    }
    await app.close();
    boot();
    const limited = await jar.send("PATCH", path, body);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
  });

  it("resumes the same trip and revisions from independent cookie jars", async () => {
    const a = await account("resume@example.test");
    const b = new Jar();
    expect((await b.login("resume@example.test")).statusCode).toBe(200);
    expect(b.cookie).not.toBe(a.cookie);
    const saved = await trip(a);
    const path = `/trips/${saved.id}`;
    expect((await list(a)).items).toEqual((await list(b)).items);
    expect((await a.send("GET", path)).json()).toEqual((await b.send("GET", path)).json());
    expect((await a.send("PATCH", `${path}/board`, renameBody("Revised title"))).json()).toEqual({ revision: 1 });
    expect((await b.send("GET", path)).json().trip).toMatchObject({ title: "Revised title", revision: 1 });
  });

  it("expires idle and absolute sessions even when the browser retains the cookie", async () => {
    const idle = await account("idle@example.test");
    now += 12 * hour;
    const denied = await idle.send("GET", "/trips");
    expect(denied.statusCode).toBe(401);
    expect(denied.headers["set-cookie"]).toBeUndefined();

    const ongoing = await account("absolute@example.test");
    for (let count = 0; count < 15; count++) {
      now += 11 * hour;
      expect((await ongoing.send("GET", "/trips")).statusCode).toBe(200);
    }
    now += 3 * hour;
    expect((await ongoing.send("GET", "/trips")).statusCode).toBe(401);
  });

  it("prunes an idle anonymous session when a new session is created", async () => {
    const idle = new Jar();
    await idle.send("GET", "/session");
    const token = idle.cookie.slice(idle.cookie.indexOf("=") + 1);
    const digest = createHash("sha256").update(token).digest();
    const db = new Database(join(dataDir, "wayfarer.db"), { readonly: true });
    try {
      const find = db.prepare("SELECT user_id FROM sessions WHERE token_digest = ?");
      expect(find.get(digest)).toEqual({ user_id: null });
      now += 12 * hour;
      expect((await new Jar().send("GET", "/session")).statusCode).toBe(200);
      expect(find.get(digest)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("defaults to the secure host-only cookie and ignores the separate local cookie name", async () => {
    await app.close();
    boot(false);
    const jar = new Jar();
    const response = await jar.send("GET", "/session");
    expect(response.headers["set-cookie"]).toMatch(/^__Host-wayfarer_session=.*; Path=\/; HttpOnly; SameSite=Lax; Secure/);
    expect(response.headers["set-cookie"]).not.toContain("Domain=");
    expect((await jar.send("POST", "/auth/register", { email: "secure@example.test", password }, {
      cookie: jar.cookie.replace("__Host-wayfarer_session", "wayfarer_local_session"),
    })).statusCode).toBe(403);
  });

  it("performs one Argon2id hash for both new and duplicate registrations", async () => {
    const hash = vi.spyOn(passwords, "hashPassword");
    const jar = await account("Taken@Example.test");
    expect(hash).toHaveBeenCalledTimes(1);
    hash.mockClear();
    const duplicate = await jar.send("POST", "/auth/register", { email: "taken@example.test", password });
    expect(hash).toHaveBeenCalledTimes(1);
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json().error).toEqual({ code: "REGISTRATION_FAILED", message: "Could not create the account" });
    expect(duplicate.headers["set-cookie"]).toBeUndefined();
    const db = new Database(join(dataDir, "wayfarer.db"), { readonly: true });
    try {
      const row = db.prepare<[], { password_hash: string }>("SELECT password_hash FROM users").get();
      expect(row?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    } finally {
      db.close();
    }
  });

  it.each([
    ["14 code points", "x".repeat(14), 422],
    ["15 code points", "x".repeat(15), 201],
    ["128 code points", "x".repeat(128), 201],
    ["129 code points", "x".repeat(129), 422],
    ["multi-code-point emoji", "👩‍💻".repeat(5), 201],
    ["NFKC shrinks decomposed characters", "e\u0301".repeat(14), 422],
  ])("checks password length after normalization (%s)", async (_name, value, status) => {
    const response = await new Jar().register("length@example.test", value);
    expect(response.statusCode).toBe(status);
    if (status === 422) {
      expect(response.json().error.field).toBe("password");
      expect(response.body).not.toContain(value);
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("returns the same generic 401 for unknown accounts and wrong passwords", async () => {
    await account("existing@example.test");
    const jar = new Jar();
    const wrong = await jar.login("existing@example.test", "wrong");
    const unknown = await jar.login("unknown@example.test", "wrong");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toEqual(unknown.json().error);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    expect(unknown.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects extra keys and non-JSON bodies without returning new cookies", async () => {
    const jar = new Jar();
    await jar.send("GET", "/session");
    const body = { email: "extra@example.test", password };
    const extra = await jar.send("POST", "/auth/register", { ...body, ownerId: "extra" });
    expect(extra.statusCode).toBe(400);
    expect(extra.headers["set-cookie"]).toBeUndefined();
    const text = await jar.send("POST", "/auth/register", body, { "content-type": "text/plain" });
    expect(text.statusCode).toBe(415);
    expect(text.headers["set-cookie"]).toBeUndefined();
  });

  it("replays create idempotently and rejects stale or mismatched board requests", async () => {
    const jar = await account("idempotency@example.test");
    const clientId = randomUUID();
    const saved = await trip(jar, "Original", clientId);
    expect(await trip(jar, "Different requested title", clientId)).toEqual(saved);
    expect((await list(jar)).items).toHaveLength(1);

    const path = `/trips/${saved.id}/board`;
    const rename = renameBody("Revised");
    expect((await jar.send("PATCH", path, rename)).json()).toEqual({ revision: 1 });
    expect((await jar.send("PATCH", path, rename)).json()).toEqual({ revision: 1 });
    const mismatch = await jar.send("PATCH", path, { ...rename, ops: [{ kind: "renameTrip", title: "Other" }] });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe("CLIENT_ID_CONFLICT");
    const stale = await jar.send("PATCH", path, renameBody("Stale"));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "STALE_REVISION", currentRevision: 1 });
    expect((await jar.send("GET", `/trips/${saved.id}`)).json().trip.title).toBe("Revised");
  });

  it("paginates deterministically even when updated timestamps tie", async () => {
    const jar = await account("pagination@example.test");
    const trips = [await trip(jar, "A"), await trip(jar, "B"), await trip(jar, "C")];
    const first = await list(jar, "?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const last = await list(jar, `?limit=2&cursor=${first.nextCursor}`);
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeUndefined();
    expect([...first.items, ...last.items].map(({ id }) => id)).toEqual(trips.map(({ id }) => id).sort().reverse());
    expect((await jar.send("GET", "/trips?cursor=bad!")).statusCode).toBe(400);
  });

  it("does not log email, password, IP, token or title", async () => {
    await app.close();
    const stream = new PassThrough();
    const logs: string[] = [];
    stream.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));
    boot(true, stream);
    app.log.info("capture active");
    const email = "private-address@example.test";
    const ip = "192.0.2.254";
    const title = "private fixture title";
    const jar = await account(email, new Jar(ip));
    await trip(jar, title);
    expect((await new Jar(ip).login(email, "wrong")).statusCode).toBe(401);
    const output = logs.join("");
    expect(output).toContain("capture active");
    for (const secret of [email, password, ip, jar.cookie, jar.cookie.split("=")[1], jar.csrf, title]) {
      expect(output).not.toContain(secret);
    }
  });
});
