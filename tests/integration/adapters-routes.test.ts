import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { SessionResponse } from "@wayfarer/contracts";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { createRates } from "../../apps/api/src/auth/rates.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { readConfig } from "../../apps/api/src/config.js";
import { openDatabase } from "../../apps/api/src/db/database.js";
import { HttpError, respondError } from "../../apps/api/src/http.js";
import { registerPlaceRoutes } from "../../apps/api/src/places/routes.js";
import { registerWeatherRoutes } from "../../apps/api/src/weather/routes.js";
import weatherFixture from "../fixtures/adapters/weather.json" with { type: "json" };

const origin = "http://127.0.0.1:8080";
const placePath = "/api/v1/places/search?q=Lisbon";
const weatherPath = "/api/v1/weather?placeId=lisbon&start=2026-11-21&end=2026-11-22";
let app: FastifyInstance | undefined;
let data: string | undefined;

afterEach(async () => {
  await app?.close();
  if (data) await rm(data, { recursive: true, force: true });
  app = undefined;
  data = undefined;
});

async function boot(enabled = true) {
  data = await mkdtemp(join(tmpdir(), "wayfarer-adapters-"));
  const config = readConfig({ DATA_DIR: data, LOCAL_HTTP_COOKIES: "1" });
  const db = openDatabase(data);
  let now = Date.parse("2026-11-20T12:00:00Z");
  const clock = () => now;
  const starts: number[] = [];
  const log = new PassThrough();
  let logged = "";
  log.on("data", (chunk) => { logged += String(chunk); });
  const server = Fastify({ logger: { stream: log }, disableRequestLogging: true });
  app = server;
  server.addHook("onClose", async () => db.close());
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return respondError(error, request, reply);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  const rates = createRates(db.db, clock);
  const user = registerAuthRoutes(server, db.db, config, clock, rates);
  const places = vi.fn(async (url: URL) => {
    starts.push(now);
    if (url.searchParams.get("q") === "Private fixture query") {
      throw new Error("Private fixture upstream body");
    }
    return Response.json([]);
  });
  const weather = vi.fn(async () => Response.json(weatherFixture));
  registerPlaceRoutes(server, db.db, rates, user, { enabled, clock, transport: places,
    sleep: async (ms) => { now += ms; } });
  registerWeatherRoutes(server, db.db, rates, user, { enabled, clock, transport: weather });
  return { server, places, weather, starts, logs: () => logged };
}

async function register(server: FastifyInstance, email: string) {
  const session = await server.inject("/api/v1/session");
  const getCookie = (response: typeof session) => {
    const header = response.headers["set-cookie"];
    return (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0] ?? "";
  };
  const result = await server.inject({
    method: "POST", url: "/api/v1/auth/register",
    headers: { origin, cookie: getCookie(session), "x-csrf-token": session.json<SessionResponse>().csrfToken },
    payload: { email, password: "fixture passphrase 123" },
  });
  expect(result.statusCode).toBe(201);
  return { cookie: getCookie(result) };
}

it("requires a signed-in session, returns no-store on errors, and rejects client-supplied coordinates", async () => {
  const { server, places, weather } = await boot();
  for (const url of [placePath, weatherPath]) {
    const response = await server.inject(url);
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
  }
  const headers = await register(server, "adapters@example.test");
  const invalid = await server.inject({ url: weatherPath + "&latitude=0&longitude=0", headers });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.headers["cache-control"]).toBe("no-store");
  expect((await server.inject({ url: placePath + "&limit=50", headers })).statusCode).toBe(400);
  expect(weather).not.toHaveBeenCalled();
  expect(places).not.toHaveBeenCalled();
});

it("malformed requests do not consume either per-user quota", async () => {
  const { server, places, weather } = await boot();
  const headers = await register(server, "invalid@example.test");
  for (let i = 0; i < 10; i++) {
    expect((await server.inject({ url: "/api/v1/places/search?q=x", headers })).statusCode).toBe(422);
  }
  for (let i = 0; i < 30; i++) {
    expect((await server.inject({ url: weatherPath + "&latitude=0", headers })).statusCode).toBe(400);
  }
  expect(places).not.toHaveBeenCalled();
  expect(weather).not.toHaveBeenCalled();
  expect((await server.inject({ url: placePath, headers })).statusCode).toBe(200);
  expect((await server.inject({ url: weatherPath, headers })).statusCode).toBe(200);
});

it("limits each user independently and returns attribution and no-store on success", async () => {
  const { server, places, weather } = await boot();
  const headers = await register(server, "first@example.test");
  const other = await register(server, "second@example.test");
  const result = await server.inject({ url: placePath, headers });
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.json()).toEqual({ results: [], attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright" });
  for (let i = 1; i < 10; i++) expect((await server.inject({ url: placePath, headers })).statusCode).toBe(200);
  const placeLimit = await server.inject({ url: placePath, headers });
  expect(placeLimit.statusCode).toBe(429);
  expect(Number(placeLimit.headers["retry-after"])).toBeGreaterThan(0);
  expect((await server.inject({ url: placePath, headers: other })).statusCode).toBe(200);
  expect(places).toHaveBeenCalledOnce();

  for (let i = 0; i < 30; i++) {
    const response = await server.inject({ url: weatherPath, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ status: "forecast" });
  }
  const weatherLimit = await server.inject({ url: weatherPath, headers });
  expect(weatherLimit.statusCode).toBe(429);
  expect(Number(weatherLimit.headers["retry-after"])).toBeGreaterThan(0);
  expect((await server.inject({ url: weatherPath, headers: other })).statusCode).toBe(200);
  expect(weather).toHaveBeenCalledOnce();
});

it("shares one worker across signed-in users and keeps queries and upstream errors out of logs", async () => {
  const { server, starts, logs } = await boot();
  const users: { cookie: string }[] = [];
  for (let i = 0; i < 3; i++) users.push(await register(server, `user${i}@example.test`));
  const responses = await Promise.all(["Lisbon", "Sintra", "Private fixture query"].map((name, i) =>
    server.inject({ url: "/api/v1/places/search?q=" + encodeURIComponent(name), headers: users[i]! })));
  expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200, 503]);
  expect(starts.map((start) => start - starts[0]!)).toEqual([0, 1000, 2000]);
  expect(responses[2]?.body).not.toContain("Private fixture");
  expect(logs()).not.toMatch(/Lisbon|Sintra|Private(?:%20| )fixture/);
});

it("honors both operator switches with no provider calls", async () => {
  const { server, places, weather } = await boot(false);
  const headers = await register(server, "disabled@example.test");
  const placeResult = await server.inject({ url: placePath, headers });
  expect(placeResult.statusCode).toBe(503);
  expect(placeResult.json()).toMatchObject({ error: { code: "PLACES_DISABLED" } });
  const weatherResult = await server.inject({ url: weatherPath, headers });
  expect(weatherResult.json()).toMatchObject({ status: "unavailable", reason: "DISABLED" });
  expect(places).not.toHaveBeenCalled();
  expect(weather).not.toHaveBeenCalled();
});
