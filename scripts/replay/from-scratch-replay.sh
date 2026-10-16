#!/bin/bash
# From-scratch migration replay on an empty database (Docker, supabase/postgres:15.1.0.147).
#   bash scripts/replay/from-scratch-replay.sh            # fresh container, every migration, stops at the first error
#   KEEP=1 bash scripts/replay/from-scratch-replay.sh     # leave the container running for checks afterwards
# Never touches production. Each migration file runs in ONE transaction with ON_ERROR_STOP (production applies each file
# as one Management API query), as `postgres`, in filename order. Log: $OUT/replay.log (default /tmp/nearby-replay).
# Then, with KEEP=1 (IP = docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nearby-replay):
#   psql ... < scripts/replay/journey-fixtures.sql            # synthetic actors the journeys pick from
#   NEARBY_LOCAL_DB_URL=postgres://postgres:postgres@$IP:5432/postgres [NEARBY_PG_MODULE=/path/to/pg] npm run journeys
#   NEARBY_LOCAL_DB_URL=... node scripts/replay/booking-capacity-concurrency.js   # item 116 under real concurrency
#
# Everything this script does besides running the migration files is listed here, so nothing is silently skipped:
#  ENVIRONMENT (the image, not the migrations): the hosted auth/storage services add these columns through their own
#   migrations, which this image predates: auth.users.phone, storage.buckets.public / file_size_limit / allowed_mime_types,
#   and auth.uid()/role()/email()/jwt() reading request.jwt.claims (the image's read only the legacy per-claim settings).
#   Extensions are created as supabase_admin (pg_cron, pg_net, pg_trgm, btree_gist), as on a hosted project. The image is
#   PG 15; production is PG 17.6 (MAINTAIN revokes are version-guarded no-ops here).
#  ISOLATION: several functions post to PRODUCTION's edge-function URLs (hard-coded), so the container runs on an
#   internal Docker network with no route out (checked before any migration runs: the replay aborts if it can reach the
#   internet). pg_net is the real one; its queued calls just fail. vault gets a placeholder secret (not a key).
#   Cron jobs are created by the migrations, then paused after the replay.
#  OPERATIONAL STEPS production ran outside a migration file, reproduced at the same point:
#   - before 20270294 (item 168): the app code inventory sync (scripts/taxonomy/sync-code-dependencies.js). The migration's
#     moves refuse to run on a database that has never been synced. Inventory = scripts/taxonomy/code-dependencies.json at
#     main just before the item-168 merge (f62ff7e9^1); production's exact earlier sync is not recorded.
#   - after 20270294: runbook step 7, the re-sync from the merge commit (f62ff7e9).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=${NAME:-nearby-replay}
OUT=${OUT:-/tmp/nearby-replay}
mkdir -p "$OUT"
psql_as() { local u=$1; shift; docker exec -i -e PGPASSWORD=postgres "$NAME" psql -h localhost -U "$u" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

sync_inventory() { # $1 = git revision whose code-dependencies.json is synced
  git -C "$ROOT" show "$1:scripts/taxonomy/code-dependencies.json" > "$OUT/inventory.json" || return 1
  docker cp "$OUT/inventory.json" "$NAME:/tmp/inventory.json" >/dev/null || return 1
  psql_as postgres -1 <<SQL
select pg_catalog.set_config('replay.inv', pg_read_file('/tmp/inventory.json'), true);
select 'inventory sync @ $1: ' || sync_category_code_dependencies(current_setting('replay.inv')::jsonb, 'replay:$1')::text;
SQL
}

docker rm -f "$NAME" >/dev/null 2>&1
docker network inspect nearby-replay-internal >/dev/null 2>&1 || docker network create --internal nearby-replay-internal >/dev/null
docker run -d --name "$NAME" --network nearby-replay-internal -e POSTGRES_PASSWORD=postgres supabase/postgres:15.1.0.147 >/dev/null || exit 1
for _ in $(seq 1 90); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] && break; sleep 2; done
# no route out: a real request from inside the container must fail
if docker exec "$NAME" timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then echo "container can reach the internet; refusing"; exit 1; fi

psql_as supabase_admin <<'SQL' || exit 1
alter table auth.users add column if not exists phone text unique default null;
alter table storage.buckets add column if not exists public boolean default false;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];
-- the hosted auth service's current helpers (this image's read only the legacy request.jwt.claim.* settings)
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $f$;
create or replace function auth.email() returns text language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $f$;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
-- pg_read_file for the inventory sync step only (test container)
grant pg_read_server_files to postgres;
SQL
# a placeholder vault secret so senders queue their hand-off like production (it cannot leave the network); it is not a real key
psql_as supabase_admin -c "select vault.create_secret('replay-placeholder-not-a-key', 'service_role_key')" >/dev/null || exit 1
[ "$(psql_as postgres -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace")" = 0 ] \
  || { echo "public schema is not empty"; exit 1; }

: > "$OUT/replay.log"
n=0; total=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l)
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  base=$(basename "$f"); n=$((n + 1))
  if [ "$base" = 20270294_v1_category_pass.sql ]; then
    sync_inventory 'f62ff7e9^1' >> "$OUT/replay.log" 2>&1 || { echo "FAIL pre-sync before $base"; exit 1; }
  fi
  if ! psql_as postgres -1 < "$f" > "$OUT/last.out" 2>&1; then
    echo "FAIL #$n/$total $base" | tee -a "$OUT/replay.log"; grep -E 'ERROR|CONTEXT' "$OUT/last.out" | head -5
    exit 1
  fi
  echo "ok #$n $base" >> "$OUT/replay.log"
  if [ "$base" = 20270294_v1_category_pass.sql ]; then
    sync_inventory f62ff7e9 >> "$OUT/replay.log" 2>&1 || { echo "FAIL post-sync after $base"; exit 1; }
  fi
done
echo "ALL $n/$total migrations applied (log $OUT/replay.log)"
# scheduled jobs stay off so nothing changes the database between checks (their SQL was created and is inspectable)
psql_as supabase_admin -c "update cron.job set active = false" >/dev/null
[ "${KEEP:-0}" = 1 ] || docker rm -f "$NAME" >/dev/null
