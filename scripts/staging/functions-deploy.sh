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
# The 5 functions production runs with verify_jwt OFF (no signed-in caller: Stripe / RevenueCat webhooks, the public web
# application form, the cron re-sweep; each checks its caller itself). Every other function keeps the CLI default (on).
NO_VERIFY_JWT=" stripe-connect-webhook sponsored-stripe-webhook revenuecat-webhook submit-business-application resweep-business-content "
SUPABASE_BIN=${SUPABASE_BIN:-npx supabase}
for f in "${FNS[@]}"; do
  [ -f "supabase/functions/$f/index.ts" ] || { echo "no function $f"; exit 1; }
  flags=(--project-ref "$REF" --use-api)
  [[ "$NO_VERIFY_JWT" == *" $f "* ]] && flags+=(--no-verify-jwt)
  echo "== $f -> $REF ${flags[*]:2}"
  $SUPABASE_BIN functions deploy "$f" "${flags[@]}"
done
