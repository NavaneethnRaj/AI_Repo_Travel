import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

function loadMigrations() {
  const directory = new URL("./migrations/", import.meta.url);
  const files = readdirSync(directory).sort();

  if (files.length === 0) throw new Error("No bundled migrations");

  return files.map((file, index) => {
    const match = /^(\d{4})_([a-z][a-z0-9_]*)\.sql$/.exec(file);
    const version = index + 1;
    if (!match || Number(match[1]) !== version) {
      throw new Error("Bundled migration versions must be unique and consecutive from 0001");
    }

    return { version, name: file, sql: readFileSync(new URL(file, directory), "utf-8") };
  });
}

type MigrationStatus = { version: number | null; valid: number; count: number };

function readVersion(status: Database.Statement<[], MigrationStatus>, latest: number) {
  const row = status.get();
  if (!row) throw new Error("Could not read the database version");
  const version = row.version ?? 0;
  if (version > latest) throw new Error("Database migration version is newer than this build");
  if (version !== row.count || row.count !== row.valid) throw new Error("Invalid database migration history");
  return version;
}

export function openDatabase(dataDir: string): {
  db: Database.Database;
  readyVersion(): number | null;
  close(): void;
} {
  const migrations = loadMigrations();
  const latest = migrations.length;
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "wayfarer.db"));

  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const status = db.prepare<[], MigrationStatus>(`
      SELECT MAX(version) AS version, COUNT(*) AS count,
        COUNT(CASE WHEN version > 0 THEN 1 END) AS valid
      FROM schema_migrations
    `);
    const record = db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
    const apply = db.transaction((migration: typeof migrations[number]) => {
      if (readVersion(status, latest) < migration.version) {
        db.exec(migration.sql);
        record.run(migration.version, migration.name, new Date().toISOString());
      }
    });
    for (const migration of migrations) apply.immediate(migration);

    return {
      db,
      readyVersion() {
        return readVersion(status, latest) === latest ? latest : null;
      },
      close() {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
