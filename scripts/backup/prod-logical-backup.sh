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
printf 'SRC=%s\nPGOPTIONS=-c default_transaction_read_only=on\n' "$(tr -d '\n' < "$URL_FILE")" > "$ENVF"
NETFLAG=${SOURCE_NETWORK:+--network $SOURCE_NETWORK}
DUMP="$OUT/prod-$TS.dump"

# Every source read happens in ONE read-only repeatable-read snapshot, opened once (2026-11-26: production's temporary
# login role has a 5-minute password, and fingerprints taken at another moment than the dump can differ because cron
# jobs write; so the dump, schema dump, fingerprints, cron, extensions and the public-ACL check all share that snapshot).
# Read-only friendly: no temp tables (CREATE is refused in a read-only transaction), fingerprints via \gexec.
FPQ="select format('select %L||'' ''||count(*)||'' ''||md5(coalesce(string_agg(x::text, E''\\n'' order by x::text collate \"C\"), '''')) from %I.%I x', n.nspname||'.'||c.relname, n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') order by n.nspname||'.'||c.relname"
CRONFP="select 'cron.job '||count(*)||' '||md5(coalesce(string_agg(jobname||'|'||schedule||'|'||command||'|'||active, E'\\n' order by jobname collate \"C\"), '')) from cron.job"
CRONQ="select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command) || case when active then '' else format(' update cron.job set active = false where jobname = %L;', jobname) end from cron.job order by jobname"
EXTQ="select format('create schema if not exists %I; create extension if not exists %I with schema %I;', n.nspname, e.extname, n.nspname) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pg_trgm', 'btree_gist') and n.nspname not in ('public', 'private', 'auth', 'storage')"
EXTPUBQ="select format('create extension if not exists %I with schema public;', e.extname) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public' and e.extname in ('pg_trgm', 'btree_gist')"
PUBQ="select exists (select 1 from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'USAGE')"
B=$(basename "$DUMP" .dump); SRCSQL="$OUT/source-$TS.psql"
cat > "$SRCSQL" <<PSQL
\\set ON_ERROR_STOP 1
\\pset tuples_only on
\\pset format unaligned
set default_transaction_read_only = on;
\\if `[ -n "\$SRC_ROLE" ] && echo 1 || echo 0`
\\set r `echo \$SRC_ROLE`
set role :"r";
\\endif
begin isolation level repeatable read read only;
select current_setting('transaction_read_only') = 'on' and current_setting('default_transaction_read_only') = 'on' as ro \\gset
\\if :ro
\\echo 'snapshot read-only: yes'
\\else
\\echo 'FAIL: snapshot is not read-only'
select 1/0;
\\endif
select pg_export_snapshot() as snap \\gset
\\setenv SNAP :snap
\\! pg_dump "\$SRC" \${SRC_ROLE:+--role="\$SRC_ROLE"} --snapshot="\$SNAP" -Fc --no-subscriptions -n public -n private -n auth -n storage -f /out/$B.dump && touch /out/$B.dump.ok
\\! pg_dump "\$SRC" \${SRC_ROLE:+--role="\$SRC_ROLE"} --snapshot="\$SNAP" --schema-only -n public -n private -f /out/schema-source-$TS.sql && touch /out/schema-source-$TS.sql.ok
\\o /out/fp-source-$TS.txt
$FPQ \\gexec
$CRONFP;
\\o /out/cron-$TS.sql
$CRONQ;
\\o /out/ext-$TS.sql
$EXTQ;
\\o /out/extpub-$TS.sql
$EXTPUBQ;
\\o /out/pub-$TS.txt
$PUBQ;
\\o
commit;
PSQL

if [ -n "${RESTORE_ONLY:-}" ]; then
  # Re-prove a restore from an existing backup (no source connection at all): RESTORE_ONLY=<timestamp of that backup>
  TS=$RESTORE_ONLY; DUMP="$OUT/prod-$TS.dump"; [ -f "$DUMP" ] || { echo "no $DUMP"; exit 2; }
  echo "restore-only: $DUMP (source not contacted)"
else
echo "1/3 source snapshot: dump + schema + fingerprints + cron -> $DUMP"
docker run --rm $NETFLAG --user "$(id -u):$(id -g)" -e HOME=/tmp -e SRC_ROLE --env-file "$ENVF" -v "$OUT":/out "$CLIENT" bash -c \
  'umask 077; psql "$SRC" -X -q -f /out/'"$(basename "$SRCSQL")" > "$OUT/source-$TS.log" 2>&1 || { echo "FAIL: source snapshot (see source-$TS.log)"; exit 3; }
[ -f "$DUMP.ok" ] || { echo "FAIL: pg_dump did not finish (see source-$TS.log)"; rm -f "$DUMP"; exit 3; }
[ -f "$OUT/schema-source-$TS.sql.ok" ] || { echo "FAIL: schema dump did not finish"; exit 3; }
rm -f "$DUMP.ok" "$OUT/schema-source-$TS.sql.ok"
chmod 600 "$OUT"/*-"$TS"* "$DUMP"
[ "$(stat -c %a "$DUMP")" = 600 ] || { echo "$DUMP not 0600: deleting it"; rm -f "$DUMP"; exit 3; }
sha256sum "$DUMP" | tee "$DUMP.sha256"
echo "   cron jobs exported: $(grep -c 'cron.schedule' "$OUT/cron-$TS.sql"); tables fingerprinted: $(grep -vc '^cron.job' "$OUT/fp-source-$TS.txt")"
echo "   source connections closed: nothing below touches the source"
fi

echo "2/3 restore into $NAME (internal network, no route out)"
docker network inspect $NET >/dev/null 2>&1 || docker network create --internal $NET >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network $NET -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for i in $(seq 1 90); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] && break; sleep 2; done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] || { echo "restore container never became healthy"; exit 3; }
SA() { docker exec -i -e PGPASSWORD=postgres "$NAME" "$@"; }  # as supabase_admin: this image's postgres is not a superuser
docker exec "$NAME" bash -c 'getent hosts example.com >/dev/null 2>&1 && exit 9 || exit 0' || { echo "restore container can resolve the internet: abort"; exit 3; }
SA psql -h localhost -U supabase_admin -d postgres -X -q < "$OUT/ext-$TS.sql" > "$OUT/ext-restore-$TS.log" 2>&1 || true
docker cp "$DUMP" "$NAME":/tmp/prod.dump
SA pg_restore -h localhost -U supabase_admin -d postgres --clean --if-exists /tmp/prod.dump > "$OUT/restore-$TS.log" 2>&1 || true
# Extensions in public (pg_trgm, btree_gist on production) can't be made before the restore: public would then survive
# --clean and keep this image's default grants. So: restore, add them, then replay only the indexes/constraints that
# failed for lack of them (named in the restore log).
if [ -s "$OUT/extpub-$TS.sql" ]; then
  SA psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < "$OUT/extpub-$TS.sql" >/dev/null
  grep -oE 'CREATE (UNIQUE )?INDEX [a-z0-9_]+|ADD CONSTRAINT [a-z0-9_]+' "$OUT/restore-$TS.log" | awk '{print $NF}' | sort -u > "$OUT/replay-$TS.names"
  SA pg_restore -l /tmp/prod.dump | grep -E ' (INDEX|CONSTRAINT|FK CONSTRAINT) ' | grep -wFf "$OUT/replay-$TS.names" > "$OUT/replay-$TS.list" || true
  docker cp "$OUT/replay-$TS.list" "$NAME":/tmp/replay.list
  SA pg_restore -h localhost -U supabase_admin -d postgres -L /tmp/replay.list /tmp/prod.dump > "$OUT/replay-$TS.log" 2>&1 || true
  echo "   replayed after public extensions: $(wc -l < "$OUT/replay-$TS.list") objects, errors: $(grep -c 'error:' "$OUT/replay-$TS.log" || true)"
fi
echo "   restore errors: $(grep -c 'ERROR' "$OUT/restore-$TS.log" || true) (see $OUT/restore-$TS.log)"
if [ "$(tr -d '[:space:]' < "$OUT/pub-$TS.txt")" = t ]; then
  SA psql -h localhost -U supabase_admin -d postgres -X -q -c 'grant usage on schema public to public' >/dev/null
fi
SA psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -c 'create extension if not exists pg_cron' >/dev/null
SA psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < "$OUT/cron-$TS.sql" >/dev/null || { echo "FAIL: cron jobs did not recreate"; exit 1; }

echo "3/3 verify (row counts + row md5 per table, schema + grants diff)"
printf '%s\n' '\pset tuples_only on' '\pset format unaligned' "$FPQ \\gexec" "$CRONFP;" \
  | SA psql -h localhost -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 > "$OUT/fp-restored-$TS.txt"
SA pg_dump -h localhost -U supabase_admin -d postgres --schema-only -n public -n private > "$OUT/schema-restored-$TS.sql"
diff <(grep -v '^--' "$OUT/schema-source-$TS.sql" | grep -v '^$') <(grep -v '^--' "$OUT/schema-restored-$TS.sql" | grep -v '^$') > "$OUT/schema-diff-$TS.txt" || true
grants=$(diff <(grep -E '^(GRANT|REVOKE)' "$OUT/schema-source-$TS.sql" | sort) <(grep -E '^(GRANT|REVOKE)' "$OUT/schema-restored-$TS.sql" | sort) | grep -c '^[<>]' || true)
echo "   grant lines differing: $grants"
tables=$(wc -l < "$OUT/fp-source-$TS.txt")
[ "$tables" -gt 1 ] || { echo "FAIL: source fingerprint is empty"; exit 1; }
bad=$(diff "$OUT/fp-source-$TS.txt" "$OUT/fp-restored-$TS.txt" | grep -c '^[<>]' || true)
echo "   tables compared: $tables; differing lines: $bad; schema diff lines: $(wc -l < "$OUT/schema-diff-$TS.txt")"
chmod 600 "$OUT"/*-"$TS"* 2>/dev/null || true
if [ "$grants" != 0 ]; then echo "FAIL: restored grants differ from the source (see schema-diff-$TS.txt)"; exit 1; fi
if [ "$bad" != 0 ]; then echo "FAIL: restored data differs (see fp-*-$TS.txt)"; exit 1; fi
echo "PASS: backup $DUMP restores with identical rows in every table ($tables). Restored copy left running as $NAME."
# Machine-readable pass record, read by deploy.js's backup gate (scripts/migrations/releaseGates.js): only written on PASS.
printf '{"ts":"%s","verified_at":"%s","tables":%s,"dump_sha256":"%s"}\n' "$TS" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tables" \
  "$(sha256sum "$DUMP" | cut -d' ' -f1)" > "$OUT/verified-$TS.json"; chmod 600 "$OUT/verified-$TS.json"
