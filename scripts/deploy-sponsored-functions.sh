#!/usr/bin/env bash
# Deploys the two sponsored-placement edge functions (inert without Stripe secrets). Run from the repo root.
set -euo pipefail
export SUPABASE_ACCESS_TOKEN="$(grep -o 'sbp_[A-Za-z0-9]*' .claude/mcp.json | head -1)"
REF=enmosvippabmuqslzrox
npx --yes supabase functions deploy create-sponsored-checkout --project-ref "$REF"
npx --yes supabase functions deploy sponsored-stripe-webhook --project-ref "$REF"
npx --yes supabase functions deploy admin-sponsored-refund --project-ref "$REF"
