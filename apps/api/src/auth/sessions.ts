import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import type Database from "better-sqlite3";

const idleLimit = 12 * 60 * 60 * 1000;
const absoluteLimit = 7 * 24 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function newId() {
  return randomBytes(16).toString("base64url");
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest();
}

type Session = { token_digest: Buffer; user_id: string | null; csrf_secret: Buffer; last_seen_at: string; expires_at: string };

export function csrfToken(session: Session) {
  return createHmac("sha256", session.csrf_secret).update("csrf").digest("base64url");
}

export function matchesCsrf(session: Session, value: unknown) {
  return typeof value === "string" && tokenPattern.test(value)
    && timingSafeEqual(Buffer.from(csrfToken(session), "ascii"), Buffer.from(value, "ascii"));
}

export function createSessions(db: Database.Database, clock: () => number, localHttp: boolean) {
  const name = localHttp ? "wayfarer_local_session" : "__Host-wayfarer_session";
  const attributes = `Path=/; HttpOnly; SameSite=Lax${localHttp ? "" : "; Secure"}`;
  const find = db.prepare<[Buffer], Session>(`
    SELECT token_digest, user_id, csrf_secret, last_seen_at, expires_at FROM sessions WHERE token_digest = ?
  `);
  const erase = db.prepare("DELETE FROM sessions WHERE token_digest = ?");
  const prune = db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?");
  const update = db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_digest = ? AND last_seen_at <= ?");
  const insert = db.prepare(`
    INSERT INTO sessions (token_digest, user_id, csrf_secret, issued_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function read(digest: Buffer) {
    const session = find.get(digest);
    if (!session) return undefined;
    const now = clock();
    if (Date.parse(session.expires_at) <= now || Date.parse(session.last_seen_at) + idleLimit <= now) {
      erase.run(digest);
      return undefined;
    }
    return session;
  }

  return {
    fromCookie(cookie: string | undefined) {
      const entries = cookie?.split(";").map((item) => item.trim()).filter((item) => item.startsWith(`${name}=`));
      const token = entries?.length === 1 ? entries[0]?.slice(name.length + 1) : undefined;
      return token && tokenPattern.test(token) ? read(tokenDigest(token)) : undefined;
    },
    read,
    touch(session: Session) {
      const now = clock();
      const touchBefore = new Date(now - 60_000).toISOString();
      if (session.last_seen_at <= touchBefore) {
        update.run(new Date(now).toISOString(), session.token_digest, touchBefore);
      }
    },
    create(userId: string | null) {
      const now = clock();
      const issued = new Date(now).toISOString();
      const token = randomBytes(32).toString("base64url");
      const session: Session = {
        token_digest: tokenDigest(token),
        user_id: userId,
        csrf_secret: randomBytes(32),
        last_seen_at: issued,
        expires_at: new Date(now + absoluteLimit).toISOString(),
      };
      prune.run(issued, new Date(now - idleLimit).toISOString());
      insert.run(session.token_digest, userId, session.csrf_secret, issued, issued, session.expires_at);
      return { token, session };
    },
    erase(session: Session) {
      erase.run(session.token_digest);
    },
    setCookie(reply: FastifyReply, token: string) {
      reply.header("Set-Cookie", `${name}=${token}; ${attributes}; Max-Age=${absoluteLimit / 1000}`);
    },
    clearCookie(reply: FastifyReply) {
      reply.header("Set-Cookie", `${name}=; ${attributes}; Max-Age=0`);
    },
  };
}

export type { Session };
