# Owner steps after the build 88 merge (2026-11-26). Nothing here is deployed by Claude.

## 1. Encrypt the backup (do first)
In your OWN Codespace terminal (not `!`): `python3 /workspaces/.nearby-verify/wt-catchup/scripts/backup/set-backup-passphrase.py`.
Save the passphrase in Bitwarden. Then tell Claude "passphrase set": Claude encrypts + verifies; you download the encrypted file.

## 2. Build 88 staging iPhone build (you run it; config dry-resolved OK: "Nearby Staging", com.allenklein.nearby.staging, project 6f49be3c...)
```
cd /workspaces/Nearby && git checkout main && git pull
eas device:create                       # once: register the iPhone (open the link on the phone)
export APP_VARIANT=staging NEARBY_STAGING_EAS_PROJECT_ID=6f49be3c-0885-45bf-892f-3b722cd4aa54 \
       NEARBY_STAGING_SUPABASE_URL=https://hxsioiiulubavhogzipo.supabase.co
read -rs NEARBY_STAGING_PUBLISHABLE_KEY && export NEARBY_STAGING_PUBLISHABLE_KEY
eas build -p ios --profile staging      # sign in to Apple when asked (ad hoc credentials)
```
Known: maps blank in staging (no staging Maps key). The staging test OTP expired 2026-11-28: renew before testing.

## 3. Resend on PRODUCTION (you set secrets; never paste the key in chat)
Prod today has none of them (checked: names only). send-push v28 already sends the fallback email once set, but 0 business
emails are verified, so nothing goes out until an owner verifies an address.
```
read -rs RESEND_API_KEY && supabase secrets set --project-ref enmosvippabmuqslzrox RESEND_API_KEY="$RESEND_API_KEY"; unset RESEND_API_KEY
supabase secrets set --project-ref enmosvippabmuqslzrox EMAIL_FROM='Nearby for Business <alerts@mail.thisisnearby.com>' \
  EMAIL_REPLY_TO=support@thisisnearby.com BUSINESS_WEB_URL='https://allenklein94.github.io/Nearby/business/'
supabase secrets list --project-ref enmosvippabmuqslzrox
```
Use the PRODUCTION key. Change BUSINESS_WEB_URL only at the custom-domain cutover. Exact-request links arrive with 0428 + the send-push redeploy (Batch 10).

## 4. Still yours
- R2: App Store Connect, confirm no public / external-tester build 86 or older.
- R3: Tier 1 on build 87 (`BATCH1_APPROVAL_PACKET_2026-11-25.md`).
- `.claude/prod-db-url` via `scripts/backup/set-prod-db-url.py` (same-day backup before each batch).
- Per-migration approvals: `MIGRATION_APPROVAL_PACKETS_0348-0433.md`.
- Privacy wording + counsel: `PRIVACY_POLICY_GAP_AUDIT_2026-11-26.md` (A1 AI provider + A2 Cloudflare are gaps TODAY).
- Anthropic credit (production org), Twilio upgrade before business onboarding, Google Web Risk key before 0396.
