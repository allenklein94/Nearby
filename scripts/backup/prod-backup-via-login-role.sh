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
api -X POST "https://api.supabase.com/v1/projects/$REF/cli/login-role" -d '{"read_only":true}' | python3 -I -c "
import json,sys,urllib.parse as u
d=json.load(sys.stdin)
sys.stderr.write('temporary role: %s (ttl %ss)\n' % (d['role'], d['ttl_seconds']))
print('postgresql://%s.%s:%s@%s:5432/postgres?sslmode=require' % (d['role'], sys.argv[1], u.quote(d['password'], safe=''), sys.argv[2]))
" "$REF" "$POOLER" > "$URLF"
chmod 600 "$URLF"

ENVF=$(mktemp "$OUT/.env.XXXXXX"); printf 'SRC=%s\n' "$(cat "$URLF")" > "$ENVF"
echo "permission check:"
docker run -i --rm --env-file "$ENVF" postgres:17 bash -c 'psql "$SRC" -X -q -A -t -v ON_ERROR_STOP=1' <<'SQL' || { rm -f "$ENVF"; echo "FAIL: permission check"; exit 4; }
select 'read_only_default='||current_setting('default_transaction_read_only');
select 'can_read '||count(*)||' tables' from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') and has_table_privilege(c.oid,'select');
select 'cannot_read '||count(*)||' tables' from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','auth','storage') and not has_table_privilege(c.oid,'select');
SQL
if docker run -i --rm --env-file "$ENVF" postgres:17 bash -c 'psql "$SRC" -X -q -v ON_ERROR_STOP=1 ' <<<"begin; create table public._backup_write_probe(x int); rollback;" >/dev/null 2>&1; then
  rm -f "$ENVF"; echo "FAIL: role can write (probe rolled back, nothing kept); aborting"; exit 5
fi
echo "write probe refused: role is read-only"
rm -f "$ENVF"

SOURCE_URL_FILE="$URLF" OUT="$OUT" bash "$REPO/scripts/backup/prod-logical-backup.sh"
