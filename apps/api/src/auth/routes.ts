import { LoginRequest, LogoutRequest, RegisterRequest } from "@wayfarer/contracts";
import type { AccountUser } from "@wayfarer/contracts";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { input, problem } from "../http.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import type { Rates } from "./rates.js";
import { createSessions, csrfToken, matchesCsrf, newId } from "./sessions.js";
import type { Session } from "./sessions.js";

export const apiPrefix = "/api/v1";

export function isApiRequest(request: FastifyRequest) {
  return [request.routeOptions.url, request.url.split("?", 1)[0]].some((path) =>
    path === apiPrefix || path?.startsWith(`${apiPrefix}/`),
  );
}

function csrfRejected(): never {
  return problem(403, "CSRF_REJECTED", "Could not verify the request");
}

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database, config: Config, clock: () => number, rates: Rates) {
  const sessions = createSessions(db, clock, config.LOCAL_HTTP_COOKIES);
  const active = new WeakMap<FastifyRequest, Session>();
  const userById = db.prepare<[string], AccountUser>(
    "SELECT id, email_display AS email, preferred_currency AS currency FROM users WHERE id = ?",
  );
  const credentials = db.prepare<[string], { id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email_normalized = ?",
  );
  const addUser = db.prepare(`
    INSERT INTO users (id, email_normalized, email_display, password_hash, preferred_currency, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (email_normalized) DO NOTHING
  `);

  function currentSession(request: FastifyRequest) {
    return active.get(request) ?? csrfRejected();
  }

  function getUser(id: string) {
    const user = userById.get(id);
    if (!user) throw new Error("Session user is missing");
    return user;
  }

  function rotate(old: Session, id: string) {
    if (!sessions.read(old.token_digest)) csrfRejected();
    sessions.erase(old);
    return sessions.create(id);
  }

  const register = db.transaction((old: Session, email: string, passwordHash: string) => {
    const id = newId();
    const result = addUser.run(id, email.toLowerCase(), email, passwordHash, "USD", new Date(clock()).toISOString());
    if (result.changes === 0) problem(422, "REGISTRATION_FAILED", "Could not create the account");
    const created = rotate(old, id);
    return { ...created, user: getUser(id) };
  });

  const login = db.transaction((old: Session, id: string) => ({ ...rotate(old, id), user: getUser(id) }));

  app.addHook("onRequest", async (request) => {
    if (!isApiRequest(request)) return;
    const session = sessions.fromCookie(request.headers.cookie);
    if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(request.method)) {
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !config.ALLOWED_ORIGINS.includes(origin)
        || !session || !matchesCsrf(session, request.headers["x-csrf-token"])) csrfRejected();
      if (["POST", "PATCH", "PUT"].includes(request.method)
        && request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        problem(415, "JSON_REQUIRED", "Send an application/json body");
      }
    }
    if (session) {
      active.set(request, session);
      sessions.touch(session);
    }
  });

  app.get(`${apiPrefix}/session`, (request, reply) => {
    let session = active.get(request);
    if (!session) {
      const created = sessions.create(null);
      sessions.setCookie(reply, created.token);
      session = created.session;
    }
    return { user: session.user_id ? getUser(session.user_id) : null, csrfToken: csrfToken(session) };
  });

  app.post(`${apiPrefix}/auth/register`, async (request, reply) => {
    const old = currentSession(request);
    const { email, password } = input(RegisterRequest, request.body);
    const refund = rates.take(["register", request.ip]);
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(password);
    } catch (error) {
      refund();
      throw error;
    }

    const created = register.immediate(old, email, passwordHash);
    sessions.setCookie(reply, created.token);
    return reply.code(201).send({ user: created.user, csrfToken: csrfToken(created.session) });
  });

  app.post(`${apiPrefix}/auth/login`, async (request, reply) => {
    const old = currentSession(request);
    const { email, password } = input(LoginRequest, request.body);
    const normalized = email.toLowerCase();
    const refund = rates.take(["loginAccount", normalized], ["loginIp", request.ip]);
    const account = credentials.get(normalized);

    let verified: boolean;
    try {
      verified = await verifyPassword(password, account?.password_hash);
    } catch (error) {
      refund();
      throw error;
    }
    if (!account || !verified) problem(401, "INVALID_CREDENTIALS", "Could not sign in with those credentials");

    refund();
    const created = login.immediate(old, account.id);
    sessions.setCookie(reply, created.token);
    return { user: created.user, csrfToken: csrfToken(created.session) };
  });

  app.post(`${apiPrefix}/auth/logout`, (request, reply) => {
    input(LogoutRequest, request.body);
    const session = currentSession(request);
    if (!session.user_id) problem(401, "SESSION_REQUIRED", "Sign in to continue");
    sessions.erase(session);
    sessions.clearCookie(reply);
    return reply.code(204).send();
  });

  return function requireUser(request: FastifyRequest) {
    const id = active.get(request)?.user_id;
    if (!id) problem(401, "SESSION_REQUIRED", "Sign in to continue");
    return id;
  };
}
