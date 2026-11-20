import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { latitude, longitude } from "@wayfarer/contracts";
import type { PlaceResult } from "@wayfarer/contracts";
import { z } from "zod";
import { HttpError, problem } from "../http.js";
import { requestJson, UpstreamStatus } from "./transport.js";
import type { Transport } from "./transport.js";

const cacheLifetime = 7 * 24 * 60 * 60 * 1000;
const minimumSpacing = 1000;
const maxCooldown = 60_000;
const controls = /\p{Cc}/u;

function isPublicPlace(value: string) {
  return !/[@/\\]/.test(value) && !URL.canParse(value);
}

export const publicPlace = z.string().refine((value) => !controls.test(value))
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(2).max(160).refine(isPublicPlace));

const numericString = z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number);
const lat = numericString.pipe(latitude);
const lon = numericString.pipe(longitude);
const item = z.object({
  osm_type: z.enum(["node", "way", "relation"]),
  osm_id: z.int().positive(),
  name: z.string().optional(),
  display_name: z.string(),
  lat, lon,
  boundingbox: z.tuple([lat, lat, lon, lon]).refine(([s, n, w, e]) => s <= n && w <= e).optional(),
  address: z.object({ state: z.string().optional(), region: z.string().optional(), county: z.string().optional(),
    country: z.string().optional() }).optional(),
});
const envelope = z.array(z.unknown()).max(5);

function label(value?: string) {
  const plain = value?.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  if (plain && !/[<>]/u.test(plain)) return Array.from(plain).slice(0, 160).join("");
}

function normalize(value: unknown): PlaceResult[] {
  return envelope.parse(value).flatMap((candidate) => {
    const parsed = item.safeParse(candidate);
    if (!parsed.success) return [];
    const place = parsed.data;
    const name = label(place.name) ?? label(place.display_name);
    if (!name) return [];
    const region = label(place.address?.state ?? place.address?.region ?? place.address?.county);
    const country = label(place.address?.country);
    const bounds = place.boundingbox;
    return [{
      id: `osm:${place.osm_type}:${place.osm_id}`,
      name, ...(region ? { region } : {}), ...(country ? { country } : {}),
      coordinates: [place.lon, place.lat],
      ...(bounds ? { bounds: [bounds[2], bounds[0], bounds[3], bounds[1]] } : {}),
    }];
  });
}

function retryDelay(header: string | null, now: number) {
  const value = header?.trim();
  const millis = value && /^\d+$/.test(value) ? Number(value) * 1000
    : value ? Date.parse(value) - now : NaN;
  return Number.isNaN(millis) ? minimumSpacing : Math.min(maxCooldown, Math.max(0, millis));
}

type Job = {
  query: string;
  digest: string;
  resolve: (results: PlaceResult[]) => void;
  reject: (error: unknown) => void;
};

export function createPlaceSearch(db: Database.Database, {
  enabled = true, transport = fetch, clock = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: { enabled?: boolean; transport?: Transport; clock?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const cache = db.prepare<[string, number], { results: string }>(
    "SELECT results FROM place_cache WHERE query_digest = ? AND expires_at > ?",
  );
  const save = db.prepare("INSERT OR REPLACE INTO place_cache (query_digest, results, expires_at) VALUES (?, ?, ?)");
  const prune = db.prepare("DELETE FROM place_cache WHERE expires_at <= ?");
  const queue: Job[] = [];
  const inFlight = new Map<string, Promise<PlaceResult[]>>();
  let working = false;
  let nextStart = 0;

  function cached(digest: string): PlaceResult[] | undefined {
    const row = cache.get(digest, clock());
    return row ? JSON.parse(row.results) as PlaceResult[] : undefined;
  }

  async function run(job: Job) {
    const existing = cached(job.digest);
    if (existing) return existing;
    while (clock() < nextStart) await sleep(nextStart - clock());
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({
      q: job.query, format: "jsonv2", limit: "5", addressdetails: "1", "accept-language": "en",
    }).toString();
    nextStart = clock() + minimumSpacing;
    try {
      const results = normalize(await requestJson(url, transport, {
        Accept: "application/json", "User-Agent": "Wayfarer-Travel-Planner/1.0",
      }));
      save.run(job.digest, JSON.stringify(results), clock() + cacheLifetime);
      return results;
    } catch (error) {
      if (error instanceof UpstreamStatus && (error.status === 429 || error.status === 503)) {
        const now = clock();
        nextStart = Math.max(nextStart, now + retryDelay(error.retryAfter, now));
        throw new HttpError(503, { code: "PLACES_UNAVAILABLE", message: "Place search is temporarily unavailable",
          retryAfterSeconds: Math.max(1, Math.ceil((nextStart - now) / 1000)) });
      }
      problem(503, "PLACES_UNAVAILABLE", "Place search is temporarily unavailable");
    }
  }

  async function drain() {
    working = true;
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        job.resolve(await run(job));
      } catch (error) {
        job.reject(error);
      } finally {
        inFlight.delete(job.digest);
      }
    }
    working = false;
  }

  return async (name: string) => {
    if (!enabled) problem(503, "PLACES_DISABLED", "Place search is disabled");
    const query = publicPlace.parse(name);
    const digest = createHash("sha256").update(query.toLowerCase()).digest("hex");
    const now = clock();
    prune.run(now);
    const result = cached(digest);
    if (result) return result;
    const ongoing = inFlight.get(digest);
    if (ongoing) return ongoing;
    if (queue.length >= 8) {
      throw new HttpError(429, { code: "PLACE_QUEUE_FULL", message: "Place search is busy",
        retryAfterSeconds: Math.max(1, Math.ceil((Math.max(nextStart, now) - now + queue.length * minimumSpacing) / 1000)) });
    }

    const pending = new Promise<PlaceResult[]>((resolve, reject) => queue.push({ query, digest, resolve, reject }));
    inFlight.set(digest, pending);
    if (!working) void drain();
    return pending;
  };
}
