CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT UNIQUE NOT NULL,
  email_display TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  preferred_currency TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_digest BLOB PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret BLOB NOT NULL,
  issued_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  brief_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, client_id)
);

CREATE INDEX trips_owner_order ON trips(owner_id, updated_at DESC, id DESC);

CREATE TABLE board_receipts (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  request_hash BLOB NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(trip_id, client_id)
);

CREATE TABLE rate_windows (
  scope TEXT NOT NULL,
  principal_digest BLOB NOT NULL,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(scope, principal_digest, bucket_start)
);

INSERT INTO app_meta (key, value) VALUES ('rate_limit_secret', lower(hex(randomblob(32))));
