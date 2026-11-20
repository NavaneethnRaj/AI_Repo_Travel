import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import serveStatic from "@fastify/static";
import type { ApiError, LiveResponse, NotReadyResponse, ReadyResponse } from "@wayfarer/contracts";
import Fastify from "fastify";
import type { FastifyError, FastifyServerOptions } from "fastify";
import { isApiRequest, registerAuthRoutes } from "./auth/routes.js";
import { createRates } from "./auth/rates.js";
import { HttpError, respondError } from "./http.js";
import { registerTripRoutes } from "./trips/routes.js";
import type { Config } from "./config.js";
import { openDatabase } from "./db/database.js";

type ServerOptions = {
  clock?: () => number;
  logStream?: NonNullable<Exclude<FastifyServerOptions["logger"], boolean>>["stream"];
};

export function buildServer(config: Config, staticRoot?: string, { clock = Date.now, logStream }: ServerOptions = {}) {
  const app = Fastify({
    bodyLimit: 16384,
    trustProxy: false,
    disableRequestLogging: true,
    logger: {
      ...(logStream ? { stream: logStream } : {}),
      redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
    },
  });

  const database = openDatabase(config.DATA_DIR);
  app.addHook("onClose", async () => database.close());
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    if (isApiRequest(request)) {
      reply.header("Cache-Control", "no-store");
    }
    reply.header("Content-Security-Policy", "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof HttpError) return respondError(error, request, reply);
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    const body: ApiError = {
      error: status === 500
        ? { code: "INTERNAL_ERROR", message: "The request could not be completed" }
        : { code: "REQUEST_ERROR", message: "The request was rejected" },
      requestId: request.id,
    };
    reply.code(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = { error: { code: "NOT_FOUND", message: "Resource not found" }, requestId: request.id };
    reply.code(404).send(body);
  });

  app.get<{ Reply: LiveResponse }>("/health/live", () => ({ status: "ok" }));
  app.get<{ Reply: ReadyResponse | NotReadyResponse }>("/health/ready", async (_request, reply): Promise<ReadyResponse | NotReadyResponse> => {
    try {
      const migration = database.readyVersion();
      if (migration !== null) return { status: "ready", migration };
    } catch {
      // Probe failures are intentionally reported without database details.
    }
    reply.code(503);
    return { status: "not_ready" };
  });

  const rates = createRates(database.db, clock);
  const requireUser = registerAuthRoutes(app, database.db, config, clock, rates);
  registerTripRoutes(app, database.db, clock, rates, requireUser);

  for (const path of ["/signin", "/signup", "/trips", "/trips/:id"]) {
    app.get(path, (_request, reply) => reply.sendFile("index.html"));
  }

  const root = staticRoot ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const assets = join(root, "assets");
  app.register(serveStatic, {
    root,
    cacheControl: false,
    setHeaders(response, path) {
      const policy = dirname(path) === assets ? "public, max-age=31536000, immutable" : "no-cache";
      response.setHeader("Cache-Control", policy);
    },
  });
  return app;
}
