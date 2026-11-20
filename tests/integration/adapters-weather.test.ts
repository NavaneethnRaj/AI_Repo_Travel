import type Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWeather } from "../../apps/api/src/weather/adapter.js";
import fixture from "../fixtures/adapters/weather.json" with { type: "json" };
import { adapterDatabase } from "../fixtures/adapters/database.js";

const place = { latitude: 38.7211, longitude: -9.144, timezone: "Europe/Lisbon", start: "2026-11-21", end: "2026-11-22" };
const day = 86_400_000;
let db: Database.Database;
let now: number;
const clock = () => now;
beforeEach(() => {
  db = adapterDatabase();
  now = Date.parse("2026-11-20T12:00Z");
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });

it("normalizes a forecast and uses one fresh cache row for points in the same rounded cell", async () => {
  const transport = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "38.72", longitude: "-9.14", start_date: place.start, end_date: place.end,
      daily: "temperature_2m_max,temperature_2m_min,weather_code", timezone: place.timezone, temperature_unit: "celsius",
    });
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
    return Response.json(fixture);
  });
  const weather = createWeather(db, { clock, transport });
  const result = await weather(place);
  expect(result).toMatchObject({ status: "forecast", days: [
    { date: place.start, lowC: 9.4, highC: 17.5, code: 0 }, { date: place.end, lowC: 10, highC: 18.2, code: 61 },
  ], source: { name: "Open-Meteo" }, asOf: new Date(now).toISOString() });
  expect(await weather({ ...place, latitude: 38.723, longitude: -9.141 })).toEqual(result);
  expect(transport).toHaveBeenCalledOnce();
  expect(db.prepare("SELECT COUNT(*) AS count FROM weather_cache").get()).toEqual({ count: 1 });
});

it("serves the original forecast on timeout through 24 hours and expires it thereafter", async () => {
  const initial = now;
  const transport = vi.fn().mockResolvedValueOnce(Response.json(fixture))
    .mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
  const weather = createWeather(db, { clock, transport });
  await weather(place);
  now = initial + day;
  expect(await weather(place)).toMatchObject({ status: "stale", asOf: new Date(initial).toISOString() });
  now++;
  expect(await weather(place)).toMatchObject({ status: "unavailable", reason: "UPSTREAM_UNAVAILABLE" });
  expect(db.prepare("SELECT COUNT(*) AS count FROM weather_cache").get()).toEqual({ count: 0 });
});

it("accepts day 15, treats day 16 as seasonal or unavailable, and rejects bad dates and timezones", async () => {
  const transport = vi.fn(async () => Response.json({ daily: {
    time: ["2026-12-05"], temperature_2m_min: [40], temperature_2m_max: [52], weather_code: [2],
  } }));
  const weather = createWeather(db, { clock, transport });
  expect(await weather({ ...place, start: "2026-12-05", end: "2026-12-05", units: "fahrenheit" })).toMatchObject({
    status: "forecast", days: [{ date: "2026-12-05", lowF: 40, highF: 52, code: 2 }],
  });
  const distant = { ...place, end: "2026-12-06" };
  const seasonal = { note: "A seasonal climate note.", source: { name: "Fixture archive", url: "https://example.test/" } };
  expect(await weather(distant, seasonal)).toEqual({ status: "seasonal", ...seasonal });
  expect(await weather(distant)).toMatchObject({ status: "unavailable", reason: "OUTSIDE_WINDOW" });
  expect(await weather({ ...place, start: "2026-02-30" })).toMatchObject({ status: "unavailable" });
  expect(await weather({ ...place, timezone: "Europe/Forged" })).toMatchObject({ status: "unavailable" });
  expect(transport).toHaveBeenCalledOnce();
});

it.each([
  { weather_code: [0, 255] },
  { temperature_2m_min: [0] },
  { temperature_2m_max: [17, 400] },
  { time: ["2026-11-22", "2026-11-23"] },
])("rejects malformed daily fields %j", async (bad) => {
  const weather = createWeather(db, { clock, transport: async () => Response.json({ daily: { ...fixture.daily, ...bad } }) });
  expect(await weather(place)).toMatchObject({ status: "unavailable", reason: "UPSTREAM_UNAVAILABLE" });
  expect(db.prepare("SELECT COUNT(*) AS count FROM weather_cache").get()).toEqual({ count: 0 });
});

it("returns disabled without attempting transport", async () => {
  const transport = vi.fn();
  const weather = createWeather(db, { enabled: false, clock, transport });
  expect(await weather(place)).toMatchObject({ status: "unavailable", reason: "DISABLED" });
  expect(transport).not.toHaveBeenCalled();
});
