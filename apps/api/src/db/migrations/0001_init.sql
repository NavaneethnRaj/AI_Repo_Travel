CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES
  ('instance_id', lower(hex(randomblob(16)))),
  ('created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
