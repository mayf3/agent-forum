#!/bin/bash
# docker-entrypoint.sh for svc-forum
set -euo pipefail

MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-30}"
RETRY_DELAY="${MIGRATE_RETRY_DELAY_SECS:-2}"

mask_url() {
  printf '%s' "$DATABASE_URL" \
    | sed -E 's#(postgresql\+?://)[^@]*@#\1***@#; s#\?.*##'
}

echo "[entrypoint] Target database: $(mask_url "$DATABASE_URL")"

if [ "${OPS_SKIP_MIGRATE:-}" = "1" ]; then
  echo "[entrypoint] OPS_SKIP_MIGRATE=1: skipping prisma migrate deploy"
  echo "[entrypoint] Starting command: $*"
  exec "$@"
fi

echo "[entrypoint] Running: npx --no-install prisma migrate deploy (up to ${MAX_ATTEMPTS} attempts)"

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  if npx --no-install prisma migrate deploy >/tmp/migrate.log 2>&1; then
    tail -n 20 /tmp/migrate.log
    echo "[entrypoint] Schema migration complete (attempt ${attempt})."
    break
  fi

  tail -n 20 /tmp/migrate.log
  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] Migration failed after ${MAX_ATTEMPTS} attempts. Aborting." >&2
    exit 1
  fi
  echo "[entrypoint] Attempt ${attempt}/${MAX_ATTEMPTS} failed. Retrying in ${RETRY_DELAY}s..."
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "[entrypoint] Installing standalone lifecycle indexes (SQL-047/SQL-048)"
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  if node scripts/apply-lifecycle-indexes.mjs >/tmp/lifecycle-indexes.log 2>&1; then
    tail -n 20 /tmp/lifecycle-indexes.log
    echo "[entrypoint] Lifecycle index installation complete (attempt ${attempt})."
    break
  fi

  tail -n 20 /tmp/lifecycle-indexes.log
  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] Lifecycle index installation failed after ${MAX_ATTEMPTS} attempts. Aborting." >&2
    exit 1
  fi
  echo "[entrypoint] Lifecycle index attempt ${attempt}/${MAX_ATTEMPTS} failed. Retrying in ${RETRY_DELAY}s..."
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY"
done

echo "[entrypoint] Starting command: $*"
exec "$@"
