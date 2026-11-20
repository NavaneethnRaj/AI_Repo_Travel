import { osmAttribution } from "@wayfarer/contracts";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Rates } from "../auth/rates.js";
import { input, problem } from "../http.js";
import { createPlaceSearch, publicPlace } from "./adapter.js";

const query = z.strictObject({ q: publicPlace });

export function registerPlaceRoutes(
  app: FastifyInstance, db: Database.Database, rates: Rates, requireUser: (request: FastifyRequest) => string,
  options: NonNullable<Parameters<typeof createPlaceSearch>[1]>,
) {
  const search = createPlaceSearch(db, options);
  app.get("/api/v1/places/search", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = requireUser(request);
    if (options.enabled === false) problem(503, "PLACES_DISABLED", "Place search is disabled");
    const { q } = input(query, request.query);
    rates.take(["places", user]);
    return { results: await search(q), ...osmAttribution };
  });
}
