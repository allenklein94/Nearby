#!/bin/bash
# Release compatibility (owner, 2026-11-26): does THIS checkout's app build keep working on the database at every point of a
# migration rollout? LOCAL ONLY: an isolated replay database (docker container $DB on the internal replay network, no route
# out), never a hosted project.
#
#   DB=<container already replayed to the start version> START=20270347 CHECKPOINTS="20270354 20270362 ..." \
#   OUT=/workspaces/.nearby-verify/compat/<run> bash scripts/compat/release-compat.sh
#
# At START and at each checkpoint (migrations applied in number order, one transaction each, from this checkout):
#   1. static: every .rpc / .from call in src/ checked against the catalog for `authenticated` (scan-calls.js).
#   2. runtime: src/qa/compat/appBuild.compat.js = the app's real service code through a real PostgREST (restarted per
#      checkpoint so it reads the schema and the in-database pre-request config fresh).
# Results: $OUT/<version>.static.txt, $OUT/<version>.runtime.json, $OUT/<version>.jest.log, $OUT/summary.txt.
set -u
# APP_ROOT = the app build under test (default: this checkout; for a released build, a worktree of its tag, which carries
# its own runner). MIGRATIONS_FROM = where the migrations come from (default: the same tree; e.g. main for the newest ones).
ROOT=${APP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}; MIG=${MIGRATIONS_FROM:-$ROOT}
DB=${DB:?container name}; START=${START:?start version}; OUT=${OUT:?output dir}
NET=${REPLAY_NETWORK:-nearby-replay-internal}; REST=${DB}-compat-rest; IMAGE=${POSTGREST_IMAGE:-postgrest/postgrest:v13.0.7}
PGMOD=${NEARBY_PG_MODULE:-/workspaces/.nearby-verify/pgmod/node_modules/pg}
mkdir -p "$OUT"; : > "$OUT/summary.txt"
say() { echo "=== $(date -u +%H:%M:%S) $*" | tee -a "$OUT/summary.txt"; }
Q() { docker exec -i -e PGPASSWORD=postgres "$DB" psql -h localhost -U postgres -d postgres -XAt -v ON_ERROR_STOP=1 "$@"; }
docker start "$DB" >/dev/null; until docker exec -e PGPASSWORD=postgres "$DB" pg_isready -h localhost -U postgres >/dev/null 2>&1; do sleep 2; done
IP=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$DB")
case "$IP" in 172.*|10.*|192.168.*) ;; *) echo "refusing: $DB is not on a private docker network ($IP)"; exit 2;; esac
export NEARBY_LOCAL_DB_URL=postgres://postgres:postgres@$IP:5432/postgres NEARBY_PG_MODULE=$PGMOD
docker exec -e PGPASSWORD=postgres "$DB" psql -h localhost -U supabase_admin -d postgres -qc "alter role authenticator with password 'postgres';" >/dev/null
SECRET=$(openssl rand -hex 32)
HERE=$(cd "$(dirname "$0")" && pwd)
node "$HERE/scan-calls.js" "$ROOT/src" "$OUT/calls.json" | tee -a "$OUT/summary.txt"
node "$HERE/calls-to-sql.js" "$OUT/calls.json" > "$OUT/check.sql"

rest_up() {
  docker rm -f "$REST" >/dev/null 2>&1
  docker run -d --name "$REST" --network "$NET" -e PGRST_DB_URI="postgres://authenticator:postgres@$IP:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" "$IMAGE" >/dev/null
  RIP=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$REST")
  # Ready = 200 from the root, not merely an answer: before its schema cache loads PostgREST answers 503 (PGRST002).
  for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://$RIP:3000/")" = 200 ] && return 0; sleep 1; done; return 1
}
check_at() {
  local v=$1
  Q < "$OUT/check.sql" > "$OUT/$v.static.txt"
  local bad; bad=$(grep -cv '| ok |' "$OUT/$v.static.txt")
  rest_up || { say "$v PostgREST did not start"; return 1; }
  ( cd "$ROOT" && NEARBY_COMPAT_REST="http://$RIP:3000" NEARBY_COMPAT_SECRET="$SECRET" NEARBY_COMPAT_VERSION="$v" \
      NEARBY_COMPAT_OUT="$OUT/$v.runtime.json" npx jest -c jest.compat.config.js --runInBand src/qa/compat/appBuild.compat.js > "$OUT/$v.jest.log" 2>&1 )
  say "$v static: $bad calls not ok | runtime: $(grep -E '^Tests:' "$OUT/$v.jest.log")"
}
check_at "$START"
last=$START
for cp in ${CHECKPOINTS:-}; do
  for f in $(ls "$MIG/supabase/migrations" | awk -v a="$last" -v b="$cp" 'substr($0,1,8)>a && substr($0,1,8)<=b'); do
    Q --single-transaction < "$MIG/supabase/migrations/$f" > "$OUT/apply-${f%.sql}.out" 2>&1 \
      || { say "apply $f FAILED: $(tail -2 "$OUT/apply-${f%.sql}.out" | tr '\n' ' ' | cut -c1-200)"; exit 1; }
  done
  check_at "$cp"; last=$cp
done
docker rm -f "$REST" >/dev/null 2>&1
say DONE
