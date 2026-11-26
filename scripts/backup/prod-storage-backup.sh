#!/bin/bash
# Production Storage backup (owner approved 2026-11-26). READ-ONLY: lists storage.objects through the Management API's
# SQL endpoint and downloads every object through the Storage API. The project's secret API key is read ONCE into a 0600
# file (never printed, never in Git/logs) and shredded on exit, also on failure.
# Verifies every file: byte size = storage.objects metadata.size, and md5 = metadata.eTag when the eTag is a plain md5
# (single-part uploads); a multipart eTag ("…-N") is checked by size only and listed as such.
set -euo pipefail
set +x
REF=enmosvippabmuqslzrox
BASE="https://$REF.supabase.co"
OUT=${OUT:-/workspaces/.nearby-verify/backups}
TS=$(date -u +%Y%m%dT%H%M%SZ)
umask 077; mkdir -p "$OUT"; chmod 700 "$OUT"
DIR="$OUT/storage-$TS"; mkdir -p "$DIR"
TOKF=$(mktemp "$OUT/.tok.XXXXXX"); KEYF=$(mktemp "$OUT/.key.XXXXXX")
cleanup() { rc=$?; shred -u "$KEYF" "$TOKF" 2>/dev/null || rm -f "$KEYF" "$TOKF"; echo "cleanup: temporary key copy removed"; exit $rc; }
trap cleanup EXIT
python3 -I -c "import re,sys;print(re.search(r'sbp_[A-Za-z0-9]+',open(sys.argv[1]).read()).group(0))" /workspaces/Nearby/.claude/mcp.json > "$TOKF"
api() { curl -sS -f -H "Authorization: Bearer $(cat "$TOKF")" -H 'Content-Type: application/json' "$@"; }

api "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true" | python3 -I -c "
import json,sys
ks=[k for k in json.load(sys.stdin) if k.get('type')=='secret' and k.get('api_key')]
if not ks: sys.exit('no secret API key found')
print(ks[0]['api_key'])" > "$KEYF"

api -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -d '{"query":"select bucket_id, name, (metadata->>'"'"'size'"'"')::bigint as size, metadata->>'"'"'eTag'"'"' as etag from storage.objects order by bucket_id, name"}' > "$DIR/manifest.json"
n=$(python3 -I -c "import json,sys;print(len(json.load(open(sys.argv[1]))))" "$DIR/manifest.json")
echo "objects listed: $n"

python3 -I - "$DIR" "$KEYF" "$BASE" <<'PY'
import json, sys, os, hashlib, urllib.request, urllib.parse
d, keyf, base = sys.argv[1], sys.argv[2], sys.argv[3]
key = open(keyf).read().strip()
rows = json.load(open(os.path.join(d, 'manifest.json')))
ok = sizeonly = 0; bad = []
for r in rows:
    path = os.path.join(d, 'objects', r['bucket_id'], r['name'])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = '%s/storage/v1/object/authenticated/%s/%s' % (base, urllib.parse.quote(r['bucket_id']), urllib.parse.quote(r['name']))
    req = urllib.request.Request(url, headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        data = urllib.request.urlopen(req, timeout=120).read()
    except Exception as e:
        bad.append((r['bucket_id'], r['name'], 'download failed: %s' % getattr(e, 'code', type(e).__name__))); continue
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(data)
    etag = (r.get('etag') or '').strip('"')
    if r['size'] is not None and len(data) != r['size']:
        bad.append((r['bucket_id'], r['name'], 'size %d != %s' % (len(data), r['size']))); continue
    if etag and '-' not in etag:
        if hashlib.md5(data).hexdigest() != etag:
            bad.append((r['bucket_id'], r['name'], 'md5 != eTag')); continue
        ok += 1
    else:
        sizeonly += 1
    r['sha256'] = hashlib.sha256(data).hexdigest()
fd = os.open(os.path.join(d, 'manifest-verified.json'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f: json.dump(rows, f, indent=1)
print('verified by md5: %d; size only (multipart / no eTag): %d; failed: %d' % (ok, sizeonly, len(bad)))
for b in bad: print('  FAIL', b[0], '(object name withheld)', b[2])
sys.exit(1 if bad else 0)
PY
chmod -R go-rwx "$DIR"
echo "PASS: Storage backup in $DIR"
