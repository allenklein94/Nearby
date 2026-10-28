#!/bin/bash
# Runs Supabase's real Storage API (supabase/storage-api, the service behind /storage/v1) against a KEEP=1 replay
# database, on the replay's internal network (no route out). Never production. Used by photo-storage-api.js.
#   KEEP=1 bash scripts/replay/from-scratch-replay.sh && bash scripts/replay/storage-api-up.sh
# Prints the Storage API URL; writes the local (made-up) JWT secret + anon/service keys to $OUT/storage-keys.json.
# What this does besides starting the container, so nothing is silent:
#  - the replay image's storage schema predates the Storage API's own migrations, whose 'storage-schema' step recreates
#    storage.foldername() and refuses while policies depend on it: every storage.objects policy is saved, dropped, the
#    Storage API migrates its schema, then the SAME policies are recreated and compared (md5 of name/cmd/roles/using/check;
#    the script stops if they differ).
#  - sets a local password on supabase_storage_admin (the role the Storage API connects as).
set -euo pipefail
NAME=${NAME:-nearby-replay}
OUT=${OUT:-/tmp/nearby-replay}
STORAGE_IMAGE=${STORAGE_IMAGE:-supabase/storage-api:v1.11.13}
mkdir -p "$OUT/storage-data"; chmod 777 "$OUT/storage-data"
P() { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
POLHASH="select md5(string_agg(policyname||cmd||array_to_string(roles,',')||coalesce(qual,'')||coalesce(with_check,''),'|' order by policyname)) from pg_policies where schemaname='storage'"

node -e "
const c=require('crypto');const s='local-replay-jwt-secret-not-a-real-key-'+c.randomBytes(8).toString('hex');
const j=(p)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const b=Buffer.from(JSON.stringify(p)).toString('base64url');return h+'.'+b+'.'+c.createHmac('sha256',s).update(h+'.'+b).digest('base64url');};
const now=Math.floor(Date.now()/1e3);
require('fs').writeFileSync('$OUT/storage-keys.json',JSON.stringify({secret:s,anon:j({role:'anon',iat:now,exp:now+86400}),service:j({role:'service_role',iat:now,exp:now+86400})}));"
K="$OUT/storage-keys.json"; key() { node -p "require('$K').$1"; }

P -c "alter role supabase_storage_admin with password 'postgres';"
before=$(P -c "$POLHASH")
P -c "select 'create policy '||quote_ident(policyname)||' on storage.objects as '||permissive||' for '||cmd||' to '||array_to_string(roles, ', ')||coalesce(' using ('||qual||')','')||coalesce(' with check ('||with_check||')','')||';' from pg_policies where schemaname='storage' and tablename='objects' order by policyname" > "$OUT/storage-policies.sql"
P -c "select 'drop policy '||quote_ident(policyname)||' on storage.objects;' from pg_policies where schemaname='storage' and tablename='objects'" | P

docker rm -f nearby-storage >/dev/null 2>&1 || true
docker run -d --name nearby-storage --network nearby-replay-internal \
  -e ANON_KEY="$(key anon)" -e SERVICE_KEY="$(key service)" -e AUTH_JWT_SECRET="$(key secret)" -e PGRST_JWT_SECRET="$(key secret)" \
  -e DATABASE_URL="postgres://supabase_storage_admin:postgres@$NAME:5432/postgres" -e FILE_SIZE_LIMIT=52428800 \
  -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub \
  -e ENABLE_IMAGE_TRANSFORMATION=false -e DB_INSTALL_ROLES=false -v "$OUT/storage-data:/var/lib/storage" "$STORAGE_IMAGE" >/dev/null
for i in $(seq 1 60); do docker logs nearby-storage 2>&1 | grep -q 'Started Successfully' && break; sleep 2; done
docker logs nearby-storage 2>&1 | grep -q 'Started Successfully' || { docker logs nearby-storage 2>&1 | tail -5; exit 1; }

P < "$OUT/storage-policies.sql"
after=$(P -c "$POLHASH")
[ "$before" = "$after" ] || { echo "storage policies differ after restore ($before vs $after)"; exit 1; }
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nearby-storage)
echo "storage policies restored identical ($after)"
echo "NEARBY_LOCAL_STORAGE_URL=http://$IP:5000 NEARBY_LOCAL_STORAGE_KEYS=$K"
