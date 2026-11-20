CREATE TABLE weather_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT;

CREATE INDEX weather_cache_fetched_at ON weather_cache (fetched_at);

CREATE TABLE place_cache (
  query_digest TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX place_cache_expires_at ON place_cache (expires_at);
