#!/bin/bash
# Deploy edge functions to the STAGING project only (owner, 2026-11-15; staging plan approval C).
#   NEARBY_STAGING_REF=<ref> bash scripts/staging/functions-deploy.sh            # every function in supabase/functions
#   NEARBY_STAGING_REF=<ref> bash scripts/staging/functions-deploy.sh send-push  # just these
# The repo's Supabase CLI link (supabase/.temp) points at PRODUCTION, so a plain `supabase functions deploy` would hit
# production: this always passes --project-ref explicitly and refuses the production ref. The owner runs it (CLI login).
set -euo pipefail
REF=${NEARBY_STAGING_REF:-}
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "NEARBY_STAGING_REF missing or malformed"; exit 1; }
[ "$REF" != enmosvippabmuqslzrox ] || { echo "NEARBY_STAGING_REF is PRODUCTION: refused"; exit 1; }
cd "$(dirname "$0")/../.."
if [ $# -gt 0 ]; then FNS=("$@"); else mapfile -t FNS < <(ls -d supabase/functions/*/ | xargs -n1 basename | grep -v '^_'); fi
for f in "${FNS[@]}"; do
  [ -f "supabase/functions/$f/index.ts" ] || { echo "no function $f"; exit 1; }
  echo "== $f -> $REF"
  npx supabase functions deploy "$f" --project-ref "$REF"
done
