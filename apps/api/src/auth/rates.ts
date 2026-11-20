import { createHmac } from "node:crypto";
import type Database from "better-sqlite3";
import { HttpError } from "../http.js";

const policies = {
  loginAccount: { duration: 900, limit: 5 },
  loginIp: { duration: 900, limit: 20 },
  register: { duration: 3600, limit: 5 },
  board: { duration: 60, limit: 60 },
  places: { duration: 60, limit: 10 },
  weather: { duration: 60, limit: 30 },
};

type Scope = keyof typeof policies;
type Principal = readonly [Scope, string];

export function createRates(db: Database.Database, clock: () => number) {
  const secret = db.prepare<[], { value: string }>(
    "SELECT value FROM app_meta WHERE key = 'rate_limit_secret'",
  ).get()?.value;
  if (!secret) throw new Error("Missing rate limit secret");
  const key = Buffer.from(secret, "hex");

  const current = db.prepare<[Scope, Buffer, number], { bucket_start: number; count: number }>(`
    SELECT bucket_start, count FROM rate_windows
    WHERE scope = ? AND principal_digest = ? AND bucket_start > ?
    ORDER BY bucket_start DESC LIMIT 1
  `);
  const increment = db.prepare(`
    INSERT INTO rate_windows (scope, principal_digest, bucket_start, count) VALUES (?, ?, ?, 1)
    ON CONFLICT (scope, principal_digest, bucket_start) DO UPDATE SET count = count + 1
  `);
  const decrement = db.prepare(`
    UPDATE rate_windows SET count = count - 1
    WHERE scope = ? AND principal_digest = ? AND bucket_start = ? AND count > 0
  `);
  const prune = db.prepare("DELETE FROM rate_windows WHERE bucket_start <= ?");

  const reserve = db.transaction((principals: Principal[]) => {
    const now = Math.floor(clock() / 1000);
    const windows = principals.map(([scope, principal]) => {
      const { duration, limit } = policies[scope];
      const digest = createHmac("sha256", key).update(principal).digest();
      const window = current.get(scope, digest, now - duration);
      const start = window?.bucket_start ?? now;
      return { scope, digest, start, wait: (window?.count ?? 0) >= limit ? start + duration - now : 0 };
    });
    const retryAfterSeconds = Math.max(...windows.map(({ wait }) => wait));
    if (retryAfterSeconds > 0) {
      throw new HttpError(429, { code: "RATE_LIMITED", message: "Too many requests", retryAfterSeconds });
    }
    prune.run(now - 3600);
    for (const { scope, digest, start } of windows) increment.run(scope, digest, start);
    return windows;
  });

  const release = db.transaction((windows: ReturnType<typeof reserve>) => {
    for (const { scope, digest, start } of windows) decrement.run(scope, digest, start);
  });

  return {
    take(...principals: Principal[]) {
      const windows = reserve.immediate(principals);
      return () => release.immediate(windows);
    },
  };
}

export type Rates = ReturnType<typeof createRates>;
