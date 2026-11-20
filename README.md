# Wayfarer (working name)

An AI travel planner. You chat with an AI (Google Gemini) and it builds your trip live on a Trip Board: itinerary, map,
budget, weather. Replies render as rich interactive UI using OpenUI (generative UI). It runs with Docker.

**Status:** WP1 includes the Fastify server, persistent SQLite and a mock OpenUI destination card. The page displays the bundled Lisbon fixture. Gemini requests and trip planning arrive in later packages.

## Run locally

From the repository root, using Docker Compose:

```sh
docker compose up --build --wait
curl -fsS http://127.0.0.1:8080/health/ready
```

Readiness returns `{"status":"ready","migration":1}`. Open http://127.0.0.1:8080/ to see the card. The default uses mock mode and needs no `.env`. Compose fixes the internal listener on port 8080 and keeps the database under `/data` on the `trip-data` volume.

## Verify persistence

With the app running, take a snapshot of the migration history and instance marker before and after recreating the service.

```sh
snapshot() {
  docker compose exec -T app node --input-type=module -e '
    import Database from "better-sqlite3";
    const db = new Database("/data/wayfarer.db", { readonly: true });
    console.log(JSON.stringify({
      migrations: db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all(),
      marker: db.prepare("SELECT key, value FROM app_meta ORDER BY key").all()
    }));
    db.close();
  '
}
before="$(snapshot)" &&
  docker compose down &&
  docker compose up --wait &&
  test "$before" = "$(snapshot)" &&
  printf '%s\n' "Migration history and instance marker persisted."
```

Stop the service with `docker compose down` to keep the stored data.

## Test and develop

The test container blocks network access. The first image build retrieves the pinned base and npm dependencies.

```sh
docker compose -f compose.yaml -f compose.test.yaml run --rm --build app npm run test:offline
docker compose -f compose.yaml -f compose.test.yaml run --rm app npm run typecheck
```

For local development, stop the release service with `docker compose down`, then run:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build --wait
```

Open http://127.0.0.1:5173/. Vite proxies `/api` and `/health` to Fastify inside the container. The dev service uses a separate SQLite volume.

With Node 26.13.1, you can also install and run these commands from the repository root:

```sh
npm ci --no-audit --no-fund
npm run build
npm run typecheck
npm run test:offline
npm run generate:openui
```

The repository’s .npmrc disables lifecycle scripts to prevent OpenUI’s install telemetry. When running tests directly, leave `GEMINI_API_KEY` unset and use the default mock provider. Run `npm run generate:openui` after editing the component library and review the generated prompt and schema diff with the source change.
