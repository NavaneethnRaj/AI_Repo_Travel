#!/usr/bin/env bash
set -eu

node node_modules/typescript/bin/tsc -b --watch &
types_pid=$!
node --watch apps/api/dist/main.js &
api_pid=$!
(
  cd apps/web
  # OpenUI's development bootstrap loads its Inspect widget from a public CDN.
  NODE_ENV=production exec node ../../node_modules/vite/bin/vite.js --configLoader runner --host 0.0.0.0 --strictPort
) &
web_pid=$!

stop() {
  kill "$types_pid" "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$types_pid" "$api_pid" "$web_pid" 2>/dev/null || true
}

trap stop EXIT
trap 'exit 0' INT TERM
wait -n "$types_pid" "$api_pid" "$web_pid"
