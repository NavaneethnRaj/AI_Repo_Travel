import type Database from "better-sqlite3";
import { latitude, longitude, openMeteoSource, weatherCodes, weatherUnits } from "@wayfarer/contracts";
import type { SeasonalWeather, WeatherDay, WeatherResult, WeatherUnits } from "@wayfarer/contracts";
import { z } from "zod";
import { requestJson } from "../places/transport.js";
import type { Transport } from "../places/transport.js";

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const dailyFields = "temperature_2m_max,temperature_2m_min,weather_code";
const temperature = z.number().min(-150).max(160);
const date = z.iso.date();
const daily = z.strictObject({
  time: z.array(date).min(1).max(16),
  temperature_2m_min: z.array(temperature).max(16),
  temperature_2m_max: z.array(temperature).max(16),
  weather_code: z.array(weatherCodes).max(16),
}).refine(({ time, temperature_2m_min: lows, temperature_2m_max: highs, weather_code: codes }) =>
  time.length === lows.length && time.length === highs.length && time.length === codes.length
  && lows.every((low, i) => low <= highs[i]!));

const response = z.object({ daily });
const timezone = z.string().refine((value) => {
  if (!/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
});

const request = z.strictObject({
  latitude, longitude, timezone, start: date, end: date, units: weatherUnits.default("celsius"),
}).refine(({ start, end }) => start <= end);

type CacheRow = { payload: string; fetched_at: number };
type Reason = Extract<WeatherResult, { status: "unavailable" }>["reason"];

export function unavailableWeather(reason: Reason): WeatherResult {
  return { status: "unavailable", reason, source: openMeteoSource };
}

function rounded(coordinate: number) {
  return Number(coordinate.toFixed(2)).toFixed(2);
}

function todayInZone(now: number, timeZone: string) {
  const fields = new Intl.DateTimeFormat("en", {
    timeZone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => fields.find(({ type }) => type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function datedResult(status: "forecast" | "stale", row: CacheRow): WeatherResult {
  return { status, days: JSON.parse(row.payload) as WeatherDay[], asOf: new Date(row.fetched_at).toISOString(),
    source: openMeteoSource };
}

function forecast(value: unknown, start: number, end: number, units: WeatherUnits): WeatherDay[] {
  const { daily: { time, temperature_2m_min: lows, temperature_2m_max: highs, weather_code: codes } } = response.parse(value);
  const min = units === "celsius" ? -100 : -148;
  const max = units === "celsius" ? 65 : 149;
  if (time.length !== (end - start) / day + 1 || time.some((date, index) =>
    Date.parse(date) !== start + index * day || lows[index]! < min || highs[index]! > max)) {
    throw new Error("Upstream weather dates or temperatures out of range");
  }
  return time.map((date, i) => units === "celsius"
    ? { date, lowC: lows[i]!, highC: highs[i]!, code: codes[i]! }
    : { date, lowF: lows[i]!, highF: highs[i]!, code: codes[i]! });
}

export function createWeather(db: Database.Database, {
  enabled = true, transport = fetch, clock = Date.now,
}: { enabled?: boolean; transport?: Transport; clock?: () => number } = {}) {
  const cache = db.prepare<[string], CacheRow>("SELECT payload, fetched_at FROM weather_cache WHERE cache_key = ?");
  const save = db.prepare("INSERT OR REPLACE INTO weather_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)");
  const prune = db.prepare("DELETE FROM weather_cache WHERE fetched_at < ?");

  return async (input: z.input<typeof request>, seasonal?: SeasonalWeather): Promise<WeatherResult> => {
    if (!enabled) return unavailableWeather("DISABLED");
    try {
      const params = request.parse(input);
      const now = clock();
      const today = Date.parse(todayInZone(now, params.timezone));
      const start = Date.parse(params.start);
      const end = Date.parse(params.end);
      if (start < today || end > today + day * 15) {
        return seasonal ? { ...seasonal, status: "seasonal" } : unavailableWeather("OUTSIDE_WINDOW");
      }

      const lat = rounded(params.latitude);
      const lon = rounded(params.longitude);
      const key = `${lat},${lon},${params.start},${params.end},${params.units}`;
      prune.run(now - day);
      const row = cache.get(key);
      if (row && now - row.fetched_at < hour) return datedResult("forecast", row);

      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.search = new URLSearchParams({
          latitude: lat, longitude: lon, start_date: params.start, end_date: params.end,
          daily: dailyFields, timezone: params.timezone, temperature_unit: params.units,
        }).toString();
        const days = forecast(await requestJson(url, transport), start, end, params.units);
        const fetchedAt = clock();
        save.run(key, JSON.stringify(days), fetchedAt);
        return { status: "forecast", days, asOf: new Date(fetchedAt).toISOString(), source: openMeteoSource };
      } catch {
        if (row && clock() - row.fetched_at <= day) return datedResult("stale", row);
        return unavailableWeather("UPSTREAM_UNAVAILABLE");
      }
    } catch {
      return unavailableWeather("UPSTREAM_UNAVAILABLE");
    }
  };
}
