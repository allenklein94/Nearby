# Your remaining actions, in dependency order (updated 2026-11-27)

Only what needs your credentials, your phone or your approval. Everything else (tests, packets, gates, drafts) is done
or done by Claude on request. Each step names what it unblocks. Nothing here is deployed by Claude without your word.

## A. Now (no dependencies)
1. **Backup passphrase.** In your OWN Codespace terminal (not `!`):
   `python3 /workspaces/Nearby/scripts/backup/set-backup-passphrase.py`. Save it in Bitwarden.
   Tell Claude "passphrase set". Claude encrypts + proves the 2026-11-26 backup opens. Unblocks: step 2 + every batch
   (deploy.js refuses a migration without a verified + encrypted backup < 24 h).
2. **Download the encrypted backup** (`/workspaces/.nearby-verify/backups/nearby-backup-<ts>.tar.gpg`) to your computer
   (VS Code: right-click > Download), and check it opens there: `gpg -d <file> | tar -t | head`.
3. **App Store Connect check.** List every build on the App Store and in TestFlight (internal + external groups) and
   who has each. Tell Claude the result. Unblocks: Batch 1 (R2: no public build <= 86) and, later, the 0373 client-floor
   gate ("distribution" line; deploy.js refuses 0373+ without it).
4. **Privacy corrections to counsel.** Send `PRODUCT_AUDIT/PRIVACY_LEGAL_REVIEW_2026-11-27.md` (part 1 = processing
   live today, expedited). Unblocks: publishing part 1 (separate approval).
5. **Staging test sign-in expires 2026-11-28 15:23 UTC.** If you want staging phone tests after that, tell Claude to
   renew it (staging only; a new fictional-number entry).

## B. Tier 1 (needs build 87 on your iPhone; it is there)
6. **Tier 1 on build 87** (`BATCH1_APPROVAL_PACKET_2026-11-25.md`, "Tier 1"). Three results are KNOWN and fixed by
   migrations (record as known, not FAIL): Dating Browse/Crossed Paths empty, Set as main photo error, Friends Crossed
   Paths repeats. Unblocks: Batch 1 (R3).

## C. Batch 1 day (needs 1, 3, 6)
7. Say "go: Batch 1 backup". Claude runs the temporary-role backup (no connection string needed) + encrypts it;
   you download it (as step 2).
8. **Website five-tab pass** on the Coastal Coffee account + one profile save (R8), right before 0348.
9. **Publish the 0351 Privacy sentence** (packet "Privacy Policy wording" item 4, suspended-account data requests) on
   or before the day of 0351: deploy.js refuses 0351 until it is on main with its marker (Claude prepares the commit;
   you approve publishing; counsel first if you want it reviewed). 0348-0350 don't wait for it.
10. **Approve each migration** 0348-0354 by its code (packet), then `moderate-photo` right after 0349. Claude deploys
   one at a time, runs its checks, stops at the first failure.

## D. Batches 2-5 (needs C passing)
11. Approve publishing the Privacy sentences for 0355, 0356, 0357 and 0363 (packet "Privacy Policy wording" 1-3 + 5; deploy.js refuses each until its sentence is on main), then each migration.

## E. Build 88 (can run in parallel with B-D)
12. **Staging build** (iPhone already registered on Expo, team P3K6PZ46T6; Apple provisions it at this build):
```
cd /workspaces/Nearby && git checkout main && git pull
export APP_VARIANT=staging NEARBY_STAGING_EAS_PROJECT_ID=6f49be3c-0885-45bf-892f-3b722cd4aa54 \
       NEARBY_STAGING_SUPABASE_URL=https://hxsioiiulubavhogzipo.supabase.co
read -rs NEARBY_STAGING_PUBLISHABLE_KEY && export NEARBY_STAGING_PUBLISHABLE_KEY
eas build -p ios --profile staging      # sign in to Apple when asked (ad hoc)
```
   Then `BUILD88_DEVICE_CHECKLIST_2026-11-26.md` on it. Maps are blank in staging (no staging Maps key).
13. **Anthropic:** fund production's org (screening, 0372+), and create + fund the separate staging org (new email).
14. **Production build 88:** `eas build -p ios --profile production`, then approve the TestFlight submit. Install on
    every device that has Nearby. Re-check App Store Connect (step 3) so no older build remains available.

## F. Wall B: 0373 onward (needs D, 13, 14)
15. **Website:** approve re-export + publish from build 88 source (Claude prepares it). Gives the "website" line.
16. Tell Claude the App Store Connect result after step 14 (the "distribution" line). deploy.js also checks, live, that
    no older app build is still signed in: an old device must update or sign out first.
17. **External services before their batch:** Google Web Risk key (before 0396), Resend production secrets (business
    email; commands below), Twilio upgrade (before any outside business owner).
18. Approve Batches 6-11 migration by migration.

### Resend on production (step 17; never paste the key in chat)
```
read -rs RESEND_API_KEY && supabase secrets set --project-ref enmosvippabmuqslzrox RESEND_API_KEY="$RESEND_API_KEY"; unset RESEND_API_KEY
supabase secrets set --project-ref enmosvippabmuqslzrox EMAIL_FROM='Nearby for Business <alerts@mail.thisisnearby.com>' \
  EMAIL_REPLY_TO=support@thisisnearby.com BUSINESS_WEB_URL='https://allenklein94.github.io/Nearby/business/'
```

## Removed from your list (2026-11-27)
- `.claude/prod-db-url` / `set-prod-db-url.py`: not needed; backups use the temporary Supabase role.
- Staging iPhone registration (`eas device:create`): already done, still registered.
- Build 88 compatibility testing: done (`BUILD88_COMPATIBILITY_2026-11-26.md`).
