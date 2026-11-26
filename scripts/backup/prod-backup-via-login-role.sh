#!/bin/bash
# Production backup with NO database password (owner approved 2026-11-26):
#  1. Management API creates a TEMPORARY READ-ONLY login role (POST /v1/projects/{ref}/cli/login-role, read_only=true;
#     the mechanism `supabase db dump --linked` uses). Its password goes only into a 0600 file, never printed.
#  2. Checks the role really is read-only (a write must fail) and can read every dumped schema.
#  3. Runs prod-logical-backup.sh against it (dump -> isolated restore -> row-by-row verify).
#  4. ALWAYS deletes the login role (trap, also on failure) and the URL file, then checks no CLI login role is left.
set -euo pipefail
set +x
REPO=$(cd "$(dirname "$0")/../.." && pwd)
REF=enmosvippabmuqslzrox
OUT=${OUT:-/workspaces/.nearby-verify/backups}
umask 077; mkdir -p "$OUT"; chmod 700 "$OUT"
TOKF=$(mktemp "$OUT/.tok.XXXXXX"); URLF=$(mktemp "$OUT/.url.XXXXXX")
python3 -I -c "import json,re,sys;print(re.search(r'sbp_[A-Za-z0-9]+',open(sys.argv[1]).read()).group(0))" \
  /workspaces/Nearby/.claude/mcp.json > "$TOKF"
api() { curl -sS -f -H "Authorization: Bearer $(cat "$TOKF")" -H 'Content-Type: application/json' "$@"; }
cleanup() {
  rc=$?
  shred -u "$URLF" 2>/dev/null || rm -f "$URLF"
  if api -X DELETE "https://api.supabase.com/v1/projects/$REF/cli/login-role" >/dev/null 2>&1; then
    echo "cleanup: temporary login role deleted"
  else
    echo "cleanup: WARNING role delete call failed; retry: DELETE /v1/projects/$REF/cli/login-role"
  fi
  left=$(api -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -d '{"query":"select count(*) n from pg_roles where rolname like '"'"'cli_login_%'"'"'"}' 2>/dev/null || echo '?')
  echo "cleanup: cli_login_* roles left: $left"
  shred -u "$TOKF" 2>/dev/null || rm -f "$TOKF"
  exit $rc
}
trap cleanup EXIT

POOLER=$(api "https://api.supabase.com/v1/projects/$REF/config/database/pooler" | python3 -I -c "
import json,sys
d=json.load(sys.stdin); d=d if isinstance(d,list) else [d]
s=[p for p in d if p.get('pool_mode')=='session' or p.get('database_type')=='PRIMARY'][0]
print(s['db_host'])")
echo "pooler host: $POOLER"
# 2026-11-26 first run: Supabase's read_only=true role can read 0 of 206 tables, so it cannot back anything up.
# FULL_READ=1 asks for the CLI's normal role (owner approval needed: it CAN write). It is still used only inside
# read-only transactions (prod-logical-backup.sh's one snapshot), lives <= 5 min, and is deleted by the trap.
RO=true; [ "${FULL_READ:-0}" = 1 ] && RO=false
api -X POST "https://api.supabase.com/v1/projects/$REF/cli/login-role" -d '{"read_only":'"$RO"'}' | python3 -I -c "
import json,sys,urllib.parse as u
d=json.load(sys.stdin)
sys.stderr.write('temporary role: %s (ttl %ss)\n' % (d['role'], d['ttl_seconds']))
print('postgresql://%s.%s:%s@%s:5432/postgres?sslmode=require' % (d['role'], sys.argv[1], u.quote(d['password'], safe=''), sys.argv[2]))
" "$REF" "$POOLER" > "$URLF"
chmod 600 "$URLF"

ENVF=$(mktemp "$OUT/.env.XXXXXX")
# Owner (2026-11-26): the FULL_READ role can write, so EVERY connection to production is read-only. Supabase's pooler
# drops connect-time options (PGOPTIONS / ?options=, tested 2026-11-26: both arrive as "off") and the direct host is
# IPv6-only, so: each psql session's FIRST statement sets default_transaction_read_only=on (RO below), every check
# proves it took effect, and pg_dump always runs its own REPEATABLE READ, READ ONLY transaction (pg_dump's
# setup_connection; logged on the dry run). PGOPTIONS stays set in case a later pooler honours it.
printf 'SRC=%s\nPGOPTIONS=-c default_transaction_read_only=on\n' "$(cat "$URLF")" > "$ENVF"
RO="set default_transaction_read_only = on;"
echo "read-only enforcement check:"
ro=$(docker run -i --rm --env-file "$ENVF" postgres:17 bash -c 'psql "$SRC" -X -q -A -t -v ON_ERROR_STOP=1 -c "$0" -c "show default_transaction_read_only"' "$RO")
[ "$ro" = on ] || { rm -f "$ENVF"; echo "FAIL: session did not become read-only ($ro); nothing dumped"; exit 4; }
probe=$(docker run -i --rm --env-file "$ENVF" postgres:17 bash -c 'psql "$SRC" -X -q -A -t -c "$0" -c "create temp table nearby_ro_probe(x int)" 2>&1' "$RO" || true)
echo "$probe" | grep -q 'read-only transaction' || { rm -f "$ENVF"; echo "FAIL: write probe was not refused as read-only"; exit 4; }
echo "   session read-only: on; write probe refused (read-only transaction)"
echo "permission check:"
docker run -i --rm --env-file "$ENVF" postgres:17 bash -c 'psql "$SRC" -X -q -A -t -v ON_ERROR_STOP=1' <<'SQL' || { rm -f "$ENVF"; echo "FAIL: permission check"; exit 4; }
set default_transaction_read_only = on;
select 'read_only_default='||current_setting('default_transaction_read_only');
select 'can_read '||count(*)||' tables' from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') and has_table_privilege(c.oid,'select');
select 'cannot_read '||count(*)||' tables' from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') and not has_table_privilege(c.oid,'select');
SQL
unread=$(docker run -i --rm --env-file "$ENVF" postgres:17 bash -c 'psql "$SRC" -X -q -A -t -c "set default_transaction_read_only = on" -c "$0"' "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') and not has_table_privilege(c.oid,'select')")
[ "$unread" = 0 ] || { rm -f "$ENVF"; echo "FAIL: role cannot read $unread tables; a backup would be incomplete"; exit 5; }
echo "role can read every table; every source read below runs in one READ ONLY transaction"
rm -f "$ENVF"

SOURCE_URL_FILE="$URLF" OUT="$OUT" bash "$REPO/scripts/backup/prod-logical-backup.sh"
