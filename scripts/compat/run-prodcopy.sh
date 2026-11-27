#!/bin/bash
# 2026-11-27: build 88 + build 87 compat on an ISOLATED RESTORED COPY of production (backup 20261126T145104Z).
# Internal docker network (no route out, checked by the restore), cron paused, copy deleted at the end.
set -u
C=/workspaces/.nearby-verify/compat; B=/workspaces/.nearby-verify/backups; TS=20261126T145104Z
CK="20270354 20270362 20270366 20270369 20270372 20270373 20270381 20270382 20270396 20270398 20270406 20270417 20270429 20270432 20270433"
say() { echo "=== $(date -u +%H:%M:%S) $*" >> $C/prodcopy.log; }
restore() {
  cd /workspaces/Nearby && RESTORE_ONLY=$TS RESTORE_NAME=nearby-prodcompat bash scripts/backup/prod-logical-backup.sh > $C/prodcopy-restore-$1.log 2>&1
  say "restore for $1: $(grep -E '^(PASS|FAIL)' $C/prodcopy-restore-$1.log | cut -c1-160)"
  grep -q '^PASS' $C/prodcopy-restore-$1.log || exit 1
  docker exec -e PGPASSWORD=postgres nearby-prodcompat bash -c 'getent hosts example.com >/dev/null 2>&1 && exit 9 || exit 0' || { say "copy resolves the internet: abort"; exit 1; }
  docker exec -i -e PGPASSWORD=postgres nearby-prodcompat psql -h localhost -U supabase_admin -d postgres -XAtq -c "update cron.job set active = false" >/dev/null
  say "cron paused: $(docker exec -i -e PGPASSWORD=postgres nearby-prodcompat psql -h localhost -U supabase_admin -d postgres -XAt -c "select count(*) filter (where active) || ' active of ' || count(*) from cron.job")"
  say "ledger max: $(docker exec -i -e PGPASSWORD=postgres nearby-prodcompat psql -h localhost -U supabase_admin -d postgres -XAt -c 'select max(version) from private.migration_ledger')"
}
outbound() {
  local q="select count(*)||' requests, '||count(*) filter (where status_code between 200 and 399)||' reached a server, '||count(*) filter (where error_msg is not null)||' failed: '||coalesce(string_agg(distinct left(error_msg,40),' | '),'none') from net._http_response"
  say "$1 outbound: $(docker exec -i -e PGPASSWORD=postgres nearby-prodcompat psql -h localhost -U supabase_admin -d postgres -XAt -v ON_ERROR_STOP=1 -c "$q" 2>&1 | tail -1)"
}
: > $C/prodcopy.log
restore b88
cd /workspaces/Nearby && REPLAY_NETWORK=nearby-restore-internal DB=nearby-prodcompat START=20270347 CHECKPOINTS="$CK" OUT=$C/prodcopy-b88 bash scripts/compat/release-compat.sh > $C/prodcopy-b88.out 2>&1
say "b88 done"; outbound b88
restore b87
cd /workspaces/Nearby && APP_ROOT=/workspaces/.nearby-verify/wt-b87compat MIGRATIONS_FROM=/workspaces/Nearby REPLAY_NETWORK=nearby-restore-internal DB=nearby-prodcompat START=20270347 CHECKPOINTS="$CK" OUT=$C/prodcopy-b87 bash scripts/compat/release-compat.sh > $C/prodcopy-b87.out 2>&1
say "b87 done"; outbound b87
docker rm -f nearby-prodcompat >/dev/null 2>&1; say "copy deleted: $(docker ps -a --format '{{.Names}}' | grep -c nearby-prodcompat) left"
say FINISHED
