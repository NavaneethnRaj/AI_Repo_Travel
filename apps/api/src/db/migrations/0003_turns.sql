CREATE TABLE turns (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  request_hash BLOB NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'committed', 'suggested', 'conflict', 'failed', 'cancelled', 'interrupted')),
  intent TEXT NOT NULL,
  library_version TEXT NOT NULL,
  result_revision INTEGER,
  receipt_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (trip_id, client_id)
);

CREATE UNIQUE INDEX turns_one_active_per_trip ON turns(trip_id) WHERE state = 'active';

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  plain_summary TEXT NOT NULL,
  validated_lang TEXT,
  library_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX messages_trip_created ON messages(trip_id, created_at, id);

CREATE TABLE days (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  title TEXT NOT NULL,
  date TEXT,
  UNIQUE (trip_id, ordinal)
);

CREATE TABLE stops (
  id TEXT PRIMARY KEY NOT NULL,
  day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  place_id TEXT,
  label TEXT NOT NULL,
  period TEXT NOT NULL,
  time TEXT,
  minutes INTEGER CHECK (minutes IS NULL OR minutes >= 0),
  transfer_minutes INTEGER CHECK (transfer_minutes IS NULL OR transfer_minutes >= 0),
  note TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  walk_km_est REAL CHECK (walk_km_est IS NULL OR walk_km_est >= 0),
  UNIQUE (day_id, ordinal)
);

CREATE TABLE costs (
  id TEXT PRIMARY KEY NOT NULL,
  day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('stay', 'food', 'transport', 'activity')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'estimate'),
  UNIQUE (day_id, category)
);
