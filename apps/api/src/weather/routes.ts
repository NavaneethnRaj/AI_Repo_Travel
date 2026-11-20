import { weatherUnits } from "@wayfarer/contracts";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Rates } from "../auth/rates.js";
import { input } from "../http.js";
import { createWeather, unavailableWeather } from "./adapter.js";

const query = z.strictObject({
  placeId: z.string().min(1).max(80),
  start: z.iso.date(),
  end: z.iso.date(),
  units: weatherUnits.default("celsius"),
}).refine(({ start, end }) => start <= end);

// Keep this list server-side until the board supplies committed destinations.
const catalogue = new Map([["lisbon", { latitude: 38.72, longitude: -9.14, timezone: "Europe/Lisbon" }]]);

export function registerWeatherRoutes(
  app: FastifyInstance, db: Database.Database, rates: Rates, requireUser: (request: FastifyRequest) => string,
  options: NonNullable<Parameters<typeof createWeather>[1]>,
) {
  const weather = createWeather(db, options);
  app.get("/api/v1/weather", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = requireUser(request);
    if (options.enabled === false) return unavailableWeather("DISABLED");
    const { placeId, start, end, units } = input(query, request.query);
    rates.take(["weather", user]);
    const place = catalogue.get(placeId);
    return place ? weather({ ...place, start, end, units }) : unavailableWeather("UNKNOWN_PLACE");
  });
}
