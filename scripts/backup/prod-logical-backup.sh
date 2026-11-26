#!/bin/bash
# Production logical backup + verified restore (owner option B, 2026-11-23). READ-ONLY on the source: pg_dump only reads.
#
#   bash scripts/backup/prod-logical-backup.sh                 # source = production, URL from the secret file below
#   SOURCE_URL_FILE=<file> bash scripts/backup/prod-logical-backup.sh   # any other source (e.g. a local replay, for a dry run)
#
# Secret: the production connection string lives ONLY in a file the owner creates, mode 0600, never in Git, chat or logs:
#   .claude/prod-db-url   (gitignored)   e.g. postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres
# This script never prints it (set +x, passed to containers through a 0600 env file that is deleted on exit).
#
# What it does:
#  1. pg_dump (custom format, schemas public, private, auth, storage, extensions, cron, vault excluded) -> a 0600 file in
#     $OUT (default /workspaces/.nearby-verify/backups, outside the repo). The dump holds personal data: never commit it.
#  2. Restores it into a NEW container on an internal Docker network with no route out (production's engine image), so
#     nothing restored can call production (several functions post to production's edge-function URLs).
#  3. Verifies: per-table exact row count + an md5 of every row (ordered by its text) on SOURCE and RESTORED, compared
#     table by table; plus a schema-only dump of both, diffed. Any table mismatch = FAIL (exit 1).
# Leaves the restored container running (name nearby-restore) for the full-sequence migration test.
set -euo pipefail
set +x
REPO=$(cd "$(dirname "$0")/../.." && pwd)
URL_FILE=${SOURCE_URL_FILE:-/workspaces/Nearby/.claude/prod-db-url}
OUT=${OUT:-/workspaces/.nearby-verify/backups}
IMAGE=${RESTORE_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.003}
CLIENT=${CLIENT_IMAGE:-postgres:17}
NAME=${RESTORE_NAME:-nearby-restore}
NET=nearby-restore-internal
TS=$(date -u +%Y%m%dT%H%M%SZ)
umask 077
mkdir -p "$OUT"; chmod 700 "$OUT"
[ -f "$URL_FILE" ] || { echo "missing $URL_FILE (create it yourself, mode 0600)"; exit 2; }
perm=$(stat -c %a "$URL_FILE"); [ "$perm" = 600 ] || { echo "$URL_FILE must be mode 600 (is $perm)"; exit 2; }
ENVF=$(mktemp "$OUT/.env.XXXXXX"); trap 'rm -f "$ENVF"' EXIT
printf 'SRC=%s\n' "$(tr -d '\n' < "$URL_FILE")" > "$ENVF"
NETFLAG=${SOURCE_NETWORK:+--network $SOURCE_NETWORK}
DUMP="$OUT/prod-$TS.dump"

echo "1/3 dump -> $DUMP"
# Runs as this user with umask 077: the dump is owned by us and 0600 from its first byte (as root it was root-owned,
# so chmod failed and the file kept the workspace's default 666 ACL; found by the 2026-11-25 dry run).
docker run --rm $NETFLAG --user "$(id -u):$(id -g)" -e HOME=/tmp --env-file "$ENVF" -v "$OUT":/out "$CLIENT" bash -c \
  'umask 077; pg_dump "$SRC" -Fc --no-subscriptions -n public -n private -n auth -n storage -f /out/'"$(basename "$DUMP")"
chmod 600 "$DUMP" || { echo "cannot make $DUMP private: deleting it"; rm -f "$DUMP"; exit 3; }
[ "$(stat -c %a "$DUMP")" = 600 ] || { echo "$DUMP not 0600: deleting it"; rm -f "$DUMP"; exit 3; }
sha256sum "$DUMP" | tee "$DUMP.sha256"

echo "2/3 restore into $NAME (internal network, no route out)"
docker network inspect $NET >/dev/null 2>&1 || docker network create --internal $NET >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network $NET -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
# Wait for the image's own health check: pg_isready alone is true during first-time setup, whose server then restarts
# and drops the restore's connection (2026-11-25 dry run: 4452 'no connection to the server').
for i in $(seq 1 90); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] && break; sleep 2; done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] || { echo "restore container never became healthy"; exit 3; }
SA() { docker exec -i -e PGPASSWORD=postgres "$NAME" "$@"; }  # as supabase_admin: this image's postgres is not a superuser
docker exec "$NAME" bash -c 'getent hosts example.com >/dev/null 2>&1 && exit 9 || exit 0' || { echo "restore container can resolve the internet: abort"; exit 3; }
docker cp "$DUMP" "$NAME":/tmp/prod.dump
# The image already carries Supabase's roles and the auth/storage schemas; restore over them, keep going on errors that
# are platform-owned objects, and record every error so none is silently skipped.
SA pg_restore -h localhost -U supabase_admin -d postgres --clean --if-exists /tmp/prod.dump \
  > "$OUT/restore-$TS.log" 2>&1 || true
echo "   restore errors: $(grep -c 'ERROR' "$OUT/restore-$TS.log" || true) (see $OUT/restore-$TS.log)"

echo "3/3 verify (row counts + row md5 per table, schema diff)"
FP=$(cat <<'SQL'
do $$ declare r record; c bigint; h text; begin
  create temp table _fp(tbl text primary key, n bigint, h text);
  for r in select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') loop
    execute format('select count(*), md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from %I.%I x', E'\n', '', r.s, r.t) into c, h;
    insert into _fp values (r.s||'.'||r.t, c, h);
  end loop; end $$;
select tbl||' '||n||' '||h from _fp order by tbl;
SQL
)
docker run -i --rm $NETFLAG --env-file "$ENVF" "$CLIENT" bash -c 'psql "$SRC" -X -q -A -t -v ON_ERROR_STOP=1' <<<"$FP" > "$OUT/fp-source-$TS.txt"
SA psql -h localhost -U supabase_admin -d postgres -X -q -A -t -v ON_ERROR_STOP=1 <<<"$FP" > "$OUT/fp-restored-$TS.txt"
docker run --rm $NETFLAG --env-file "$ENVF" "$CLIENT" bash -c 'pg_dump "$SRC" --schema-only -n public -n private' > "$OUT/schema-source-$TS.sql"
SA pg_dump -h localhost -U supabase_admin -d postgres --schema-only -n public -n private > "$OUT/schema-restored-$TS.sql"
diff <(grep -v '^--' "$OUT/schema-source-$TS.sql" | grep -v '^$') <(grep -v '^--' "$OUT/schema-restored-$TS.sql" | grep -v '^$') > "$OUT/schema-diff-$TS.txt" || true
tables=$(wc -l < "$OUT/fp-source-$TS.txt")
[ "$tables" -gt 0 ] || { echo "FAIL: source fingerprint is empty"; exit 1; }
bad=$(diff "$OUT/fp-source-$TS.txt" "$OUT/fp-restored-$TS.txt" | grep -c '^[<>]' || true)
echo "   tables compared: $tables; differing lines: $bad; schema diff lines: $(wc -l < "$OUT/schema-diff-$TS.txt")"
if [ "$bad" != 0 ]; then echo "FAIL: restored data differs (see fp-*-$TS.txt)"; exit 1; fi
echo "PASS: backup $DUMP restores with identical rows in every table ($tables). Restored copy left running as $NAME."
