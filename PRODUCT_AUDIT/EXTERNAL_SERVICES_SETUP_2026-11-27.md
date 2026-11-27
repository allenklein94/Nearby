# External services: exact setup steps (2026-11-27)

Owner runs every step. Never paste a key into chat or a file in the repo. Each `supabase secrets set` below reads the
key from a hidden prompt (`read -rs`), so it never lands in shell history. Secret names checked read-only 2026-11-27:

- production (`enmosvippabmuqslzrox`) has: ANTHROPIC_API_KEY (org has no credit), AWS_*, REVENUECAT_WEBHOOK_SECRET,
  REVIEW_LOGIN_PIN. Missing: RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, BUSINESS_WEB_URL, GOOGLE_WEB_RISK_API_KEY,
  REVIEWER_EMAIL, all STRIPE_*.
- staging (`hxsioiiulubavhogzipo`) has: RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, BUSINESS_WEB_URL. Missing:
  ANTHROPIC_API_KEY, GOOGLE_WEB_RISK_API_KEY.

Setting a secret changes no data and needs no migration. Functions read secrets when they start, so a new value applies
on the next cold start, usually within a minute or two. To undo: `supabase secrets unset --project-ref <ref> NAME`.

## 1. Anthropic

**Staging (do now):** your recorded decision (2026-11-21) is a SEPARATE organization for staging: new email, its own
billing. Never add credit to production's organization for staging tests.
1. console.anthropic.com -> sign up with the new email -> Settings > Billing -> add credit (e.g. $25) and set a monthly
   spend limit (Settings > Limits).
2. Settings > API Keys -> Create Key, name `nearby-staging`. Copy it into Bitwarden.
3. ```
   read -rs K && supabase secrets set --project-ref hxsioiiulubavhogzipo ANTHROPIC_API_KEY="$K"; unset K
   ```
4. Tell Claude "staging Anthropic key set". Claude then runs the staging screening checks (offer screening, A1-A12).

**Production: a decision, not a step for today.** The production key already exists; only its organization has no credit.
Adding credit turns on, AT ONCE and in production, every AI feature that now returns an error: offer and profile
screening start passing content instead of failing closed, plus "Read this for me", translation, Tell Nearby, assistants.
That is fine for launch, but it is a production change. Recommended timing: fund it right before the first real business
owner, with a monthly spend limit. If you want it now: console.anthropic.com (the production org) -> Billing -> add credit
+ Limits -> spend limit. Nothing to set in Supabase.

## 2. Google Web Risk

Needed from migration 0396 (until then nothing calls it). Without it, every public post with a link is refused.
1. console.cloud.google.com -> the project that holds the Maps key -> APIs & Services > Library -> search "Web Risk
   API" -> Enable. (Billing is already active on that project.)
2. APIs & Services > Credentials -> Create credentials > API key. Then on that key: Edit -> API restrictions ->
   Restrict key -> tick only "Web Risk API" -> Save. Application restrictions: None (it is called from Supabase servers,
   not from a phone or website). Name it `nearby-web-risk`. Copy into Bitwarden.
3. Optional check (prints only the HTTP status, never the key):
   ```
   read -rs K && curl -s -o /dev/null -w '%{http_code}\n' \
     "https://webrisk.googleapis.com/v1/uris:search?threatTypes=MALWARE&uri=https%3A%2F%2Fexample.com&key=$K"; unset K
   ```
   200 = works. 403 = API not enabled or the restriction is wrong.
4. Set it on both projects (same key is fine, or make a second key for staging):
   ```
   read -rs K && supabase secrets set --project-ref hxsioiiulubavhogzipo GOOGLE_WEB_RISK_API_KEY="$K" \
     && supabase secrets set --project-ref enmosvippabmuqslzrox GOOGLE_WEB_RISK_API_KEY="$K"; unset K
   ```
   Safe on production today: the live functions don't read it.

## 3. Resend (production; staging is done)

Domain `mail.thisisnearby.com` is already verified; the production sending key is already in Bitwarden.
```
read -rs K && supabase secrets set --project-ref enmosvippabmuqslzrox RESEND_API_KEY="$K"; unset K
supabase secrets set --project-ref enmosvippabmuqslzrox \
  EMAIL_FROM='Nearby for Business <alerts@mail.thisisnearby.com>' \
  EMAIL_REPLY_TO=support@thisisnearby.com \
  BUSINESS_WEB_URL='https://allenklein94.github.io/Nearby/business/'
```
Effect today (production send-push v28): a business alert to an owner with NO push token is now emailed. Production has
0 business owners without the app, so in practice nothing is sent yet. Change BUSINESS_WEB_URL only at the custom-domain
cutover. Check: resend.com -> Emails shows the first real send; nothing else to verify until a website-only owner exists.

## 4. Twilio (before the first outside business owner)

Twilio Console -> Billing -> Upgrade account (adds a payment method; removes the trial's verified-numbers-only limit).
No Supabase change: production Auth already uses Twilio Verify. Staging's Twilio upgrade stays deferred (staging uses
the test code). Check: a sign-up from a phone number you never verified in Twilio receives its code.

## 5. Reviewer email (only before redeploying review-login or setup-review-account)

The live versions work without it. When one of those is redeployed:
```
read -r E && supabase secrets set --project-ref enmosvippabmuqslzrox REVIEWER_EMAIL="$E"; unset E
```
(the App Review account's address, the same one the live functions use).

## 6. Stripe: stays off; verified off (2026-11-27)

Three independent layers keep payment from appearing, each checked:
1. App: production `stripePublishableKey` is empty (`npx expo config`), so `isStripeConfigured()` is false. The request
   screen never opens Stripe's payment sheet ("Payment not yet available" / "You're still booked... you'll settle up with
   the business directly"); the business dashboard says payment collection isn't set up, with no Connect button.
2. Database: `accept_business_offer` creates a pending payment only when the business has `stripe_charges_enabled`.
   Production: 0 businesses with charges enabled, 0 with a Stripe account, 0 payment rows. Every acceptance is
   `not_required`, so no "Pay" or "Try payment again" button can show.
3. Server: no STRIPE_* secret on production; the payment, Connect onboarding and sponsored functions check for the key
   first and refuse without it (checked in the repo sources; their live versions weren't re-read).
   Sponsored placements: empty allow-list, so nothing is offered for sale.
Bookings work without Stripe (acceptance is the booking). Turning Stripe on later = keys + the owner approvals recorded
under "Blocked on the owner" in CLAUDE.md.
