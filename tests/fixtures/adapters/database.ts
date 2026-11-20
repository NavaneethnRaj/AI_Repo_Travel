import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";

export function adapterDatabase() {
  const directory = new URL("../../../apps/api/src/db/migrations/", import.meta.url);
  const name = readdirSync(directory).find((file) => /^\d{4}_adapter_caches\.sql$/.test(file));
  if (!name) throw new Error("Missing adapter cache migration");
  const database = new Database(":memory:");
  database.exec(readFileSync(new URL(name, directory), "utf8"));
  return database;
}
