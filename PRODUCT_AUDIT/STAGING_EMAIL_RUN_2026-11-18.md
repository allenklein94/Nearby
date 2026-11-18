# Staging email run (owner approved steps 1-3, 2026-11-18)

Approved (owner, 2026-11-18, chat): apply migrations + deploy functions to the ISOLATED staging project, configure staging
email, run the staging safety check, run the email / browser / link tests (E1-E23 minus phone-only ones), clean up.
NOT approved: anything on production, the GitHub custom domain, the production website, production merges, Build 87.

Tree deployed: `integ/staging-run` (never merged) = `integ/ml-x-trust-x-business-messages` (business web + email incl.
`EMAIL_REPLY_TO`, multi-location 0424-0427, the trust & safety stack, business messages 0428; 551 migration files) +
`staging/environment-config` (approval B tooling + the 2026-11-18 email preflight). Merge notes in commit cb3c924b.

## Status

| Step | State |
|---|---|
| Isolation (local facts) | PASS: staging ref `hxsioiiulubavhogzipo` != production; staging URL names only that ref; the staging website bundle embeds only the staging URL + publishable key (production appears only as the constants a staging build compares against and refuses) |
| Tree assembled + Jest | PASS: 593/593 suites, 7998 tests (cb3c924b) |
| Local bootstrap rehearsal (all 551 files, re-point + outbound audit per transaction) | see below |
| Private staging website | built (APP_VARIANT=staging, base /business), served from this codespace on port 8787 (private: only your GitHub login opens it): `https://automatic-space-robot-vppgg79q56j7cxj7j-8787.app.github.dev/business/`. A codespace restart stops the server; the session restarts it (same address). |
| Hosted staging bootstrap, functions, Auth, secrets | WAITING on the two owner steps below |

## Owner step 1: a separate Supabase access token for staging (needed before ANY staging change)

Approval B requires the staging tools to use their own token, never the one production work uses
(`NEARBY_STAGING_ACCESS_TOKEN`, refused if equal to `SUPABASE_ACCESS_TOKEN`). None exists yet.

1. supabase.com > your avatar > **Account preferences > Access Tokens > Generate new token**, name `nearby-staging-session`,
   expiry 7 days if offered. Copy it into Bitwarden (Nearby — Infrastructure).
2. Put it in the codespace without it touching chat, Git or history. In the codespace terminal (VS Code / browser, bash):
   ```
   read -rs T && printf '%s' "$T" > /workspaces/Nearby/.claude/staging-access-token && chmod 600 /workspaces/Nearby/.claude/staging-access-token; unset T
   ```
   Paste, press Enter (nothing is shown). `.claude/` is gitignored. Tell the session "token in place".
   Revoke it in the dashboard when staging testing ends.

## Owner step 2: the staging Resend key (after the session reports functions deployed)

Easiest, nothing in any shell: Supabase dashboard > project **nearby-staging** (`hxsioiiulubavhogzipo`) > **Edge Functions >
Secrets** > Add `RESEND_API_KEY` = paste the STAGING key from Bitwarden > Save. Check the project name before saving.

PowerShell alternative (Supabase CLI logged in on your PC). `Read-Host -AsSecureString` input is never written to PowerShell
history; the key exists only in this window's memory and is cleared at the end:
```powershell
$sec = Read-Host -AsSecureString "Staging Resend key"
$key = [System.Net.NetworkCredential]::new('', $sec).Password
$tmp = New-TemporaryFile
Set-Content -Path $tmp -Value "RESEND_API_KEY=$key" -NoNewline
npx supabase secrets set --project-ref hxsioiiulubavhogzipo --env-file $tmp
Remove-Item $tmp -Force; Remove-Variable key, sec
npx supabase secrets list --project-ref hxsioiiulubavhogzipo   # names + digests only
```
(`--env-file` keeps the key off the command line, so it isn't in process listings either.) Then tell the session
"staging Resend key set". The session sets the non-secret values itself: `EMAIL_FROM=Nearby Staging
<alerts@mail.thisisnearby.com>`, `EMAIL_REPLY_TO=support@thisisnearby.com`, `BUSINESS_WEB_URL=<the address above>`, and runs
the preflight with `NEARBY_STAGING_RESEND_KEY_CONFIRMED=1 NEARBY_STAGING_EXPECTED_WEB_URL=<that address>` (fails closed if
the URL digest is missing or differs).

## Results

(filled in as the run proceeds)
