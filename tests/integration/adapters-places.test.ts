import type Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPlaceSearch, publicPlace } from "../../apps/api/src/places/adapter.js";
import fixture from "../fixtures/adapters/places.json" with { type: "json" };
import { adapterDatabase } from "../fixtures/adapters/database.js";

let db: Database.Database;
let now: number;
const clock = () => now;
const sleep = async (ms: number) => { now += ms; };
beforeEach(() => {
  db = adapterDatabase();
  now = Date.parse("2026-11-20T12:00Z");
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });

it("serializes concurrent callers at one upstream start per second and coalesces normalized duplicates", async () => {
  const start = now;
  const starts: number[] = [];
  const transport = vi.fn(async (url: URL, init: RequestInit) => {
    starts.push(now);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect([...url.searchParams.keys()].sort()).toEqual(["accept-language", "addressdetails", "format", "limit", "q"]);
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("accept-language")).toBe("en");
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
    expect(new Headers(init.headers).get("user-agent")).toBe("Wayfarer-Travel-Planner/1.0");
    return Response.json(fixture);
  });
  const search = createPlaceSearch(db, { clock, sleep, transport });
  const [lisbon, duplicate] = await Promise.all([search("Lisbon"), search(" LISBON "), search("Porto"), search("Sintra")]);
  expect(starts).toEqual([start, start + 1000, start + 2000]);
  expect(lisbon).toEqual([
    { id: "osm:relation:5400890", name: "Lisbon", region: "Lisbon", country: "Portugal",
      coordinates: [-9.15, 38.7245], bounds: [-9.23, 38.69, -9.09, 38.8] },
    { id: "osm:node:3", name: "Campo Grande", coordinates: [-9.15, 38.75] },
  ]);
  expect(duplicate).toEqual(lisbon);
  expect(await search("lisbon")).toEqual(lisbon);
  expect(transport).toHaveBeenCalledTimes(3);
  const stored = db.prepare("SELECT query_digest, results FROM place_cache").all();
  expect(JSON.stringify(stored)).not.toContain("postcode");
  expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ query_digest: expect.stringMatching(/^[0-9a-f]{64}$/) })]));
  now = start + 7 * 86400_000;
  await search("Lisbon");
  expect(transport).toHaveBeenCalledTimes(4);
});

it("sheds the ninth waiting job and supplies a retry delay", async () => {
  let finish!: (response: Response) => void;
  const transport = vi.fn<() => Promise<Response>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockImplementation(async () => Response.json([]));
  const search = createPlaceSearch(db, { clock, sleep, transport });
  const accepted = Array.from({ length: 9 }, (_, i) => search(`City ${i}`));
  await expect(search("City overflow")).rejects.toMatchObject({ statusCode: 429, detail: { retryAfterSeconds: 9 } });
  finish(Response.json([]));
  await Promise.all(accepted);
  expect(transport).toHaveBeenCalledTimes(9);
});

it.each([429, 503])("applies a bounded global cooldown from upstream %d", async (status) => {
  const start = now;
  const starts: number[] = [];
  const search = createPlaceSearch(db, { clock, sleep, transport: async () => {
    starts.push(now);
    return starts.length === 1 ? new Response(null, { status, headers: { "Retry-After": "500" } }) : Response.json([]);
  } });
  const first = search("Lisbon");
  const second = search("Porto");
  await expect(first).rejects.toMatchObject({ statusCode: 503, detail: { retryAfterSeconds: 60 } });
  await expect(second).resolves.toEqual([]);
  expect(starts).toEqual([start, start + 60_000]);
});

it("uses a five-second abort signal and maps timeouts to an upstream error", async () => {
  const timer = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timer.signal);
  const search = createPlaceSearch(db, { clock, sleep, transport: async (_url, { signal }) =>
    new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })),
  });
  const result = search("Lisbon");
  timer.abort(new DOMException("Timed out", "TimeoutError"));
  await expect(result).rejects.toMatchObject({ statusCode: 503 });
  expect(timeout).toHaveBeenCalledWith(5000);
});

it("aborts a decoded body over 64 KiB before reading another chunk", async () => {
  const cancel = vi.fn();
  let signal: AbortSignal | null | undefined;
  const search = createPlaceSearch(db, { clock, sleep, transport: async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(65_537)); },
      cancel,
    }), { headers: { "Content-Type": "application/json" } });
  } });
  await expect(search("Lisbon")).rejects.toMatchObject({ statusCode: 503 });
  expect(signal?.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
});

it("refuses a redirect and can be switched off before transport", async () => {
  const transport = vi.fn(async () => Response.redirect("https://unexpected.example"));
  await expect(createPlaceSearch(db, { clock, sleep, transport })("Lisbon")).rejects.toMatchObject({ statusCode: 503 });
  await expect(createPlaceSearch(db, { enabled: false, transport })("Lisbon")).rejects.toMatchObject({
    statusCode: 503, detail: { code: "PLACES_DISABLED" },
  });
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(["https://example.test", "mailto:secret", "A/B", "person@example.test", "\tLisbon", "Li\u0000sbon", "x"])(
  "rejects a non-public query %j",
  (name) => expect(publicPlace.safeParse(name).success).toBe(false),
);
