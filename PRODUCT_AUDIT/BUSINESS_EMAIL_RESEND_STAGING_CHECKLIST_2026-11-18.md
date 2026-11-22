# Business email (Resend) setup + hosted staging checklist (2026-11-18)

**What this is for:** owners who use only the website have no phone app, so the email fallback is how they hear about
customer requests and messages. This file is the exact setup and the checks to run on the hosted staging project
(`nearby-staging`). **Nothing here is done yet.** Each step that touches staging needs approval B
(`STAGING_PROJECT_PLAN_2026-11-15.md`). Production stays a separate approval. Never paste a key into chat, Git or a log.
Set secrets yourself with the commands below.

## 0. Infrastructure status (owner, 2026-11-17/18; DNS re-checked from public resolvers 2026-11-18)

DONE by the owner, nothing left to do in Resend or Cloudflare for email:
- Domain `thisisnearby.com` (Cloudflare, auto-renew). Sending domain **`mail.thisisnearby.com` verified in Resend**.
- Public DNS seen 2026-11-18: DKIM `resend._domainkey.mail` present; `send.mail` = Resend's MX + SPF; apex SPF =
  Cloudflare Email Routing; `_dmarc` = `v=DMARC1; p=none; rua=mailto:support@thisisnearby.com`. From
  `alerts@mail.thisisnearby.com`, DKIM (d=mail.thisisnearby.com) and SPF (send.mail.thisisnearby.com) both align with
  DMARC's relaxed rule, so the existing apex DMARC record covers alert email. No change needed.
- `support@thisisnearby.com` forwards to the owner's inbox (Cloudflare Email Routing).
- Two API keys, **Sending access, restricted to mail.thisisnearby.com**: one staging, one production, kept in the owner's
  password manager (Bitwarden, "Nearby — Infrastructure"). Never in chat, Git or a log.
- Standalone test (staging key): `Nearby for Business <alerts@mail.thisisnearby.com>` -> support@ = Resend "Delivered" and
  arrived in the owner's inbox via forwarding. This proves the key, domain and both mail directions; it does NOT prove
  Nearby's own send path (send-push / business-email), which is what section 3 checks.
- `alerts@mail.thisisnearby.com` receives NO mail (no MX on `mail.`). Hence `EMAIL_REPLY_TO` (below): an owner who
  replies to an alert reaches support@ instead of a bounce.

### Exact values (replaces the "no domain yet" guidance in section 2)

| Secret | Staging (`hxsioiiulubavhogzipo`) | Production (`enmosvippabmuqslzrox`, own approval) |
|---|---|---|
| `RESEND_API_KEY` | the STAGING key | the PRODUCTION key |
| `EMAIL_FROM` | `Nearby Staging <alerts@mail.thisisnearby.com>` | `Nearby for Business <alerts@mail.thisisnearby.com>` |
| `EMAIL_REPLY_TO` (new, optional) | `support@thisisnearby.com` | `support@thisisnearby.com` |
| `BUSINESS_WEB_URL` | the private staging website address, trailing `/` (NEVER a production address: the staging preflight refuses it) | before the cutover `https://allenklein94.github.io/Nearby/business/`; after it `https://thisisnearby.com/business/` |

Set them yourself, one at a time, so no key lands in shell history (the prompt hides what you type):

```
read -rs RESEND_API_KEY && supabase secrets set --project-ref hxsioiiulubavhogzipo RESEND_API_KEY="$RESEND_API_KEY"; unset RESEND_API_KEY
supabase secrets set --project-ref hxsioiiulubavhogzipo EMAIL_FROM='Nearby Staging <alerts@mail.thisisnearby.com>' EMAIL_REPLY_TO=support@thisisnearby.com BUSINESS_WEB_URL='<staging website URL>/'
supabase secrets list --project-ref hxsioiiulubavhogzipo    # names + digests only
NEARBY_STAGING_RESEND_KEY_CONFIRMED=1 NEARBY_STAGING_ACCESS_TOKEN=... node scripts/staging/preflight.js
```

The staging preflight (branch `staging/environment-config`, fa25c9d6) refused any Resend key before 2026-11-18; it now
allows the staging key only with `NEARBY_STAGING_RESEND_KEY_CONFIRMED=1` (you confirm it is the STAGING key), and then
requires `EMAIL_FROM` + `BUSINESS_WEB_URL` and refuses a production website address (compared by SHA-256 digest).
Staging test businesses verify their alert address through the code email, so staging can only email an inbox someone
proved they control; use support@ or a plus-address of your own inbox (if your provider supports it) as test inboxes.

## 1. How the email works today (code facts, both trees)

- **Sender:** `supabase/functions/_shared/email.ts` makes one Resend call: `POST https://api.resend.com/emails`,
  `{ from: EMAIL_FROM, to: [address], subject, text }`, plain text, 10 s limit. If `RESEND_API_KEY` or `EMAIL_FROM` is
  missing, it returns `email_not_configured` and sends nothing.
- **Who gets email:** only a row in `business_email_settings` with `verified_at` set and `enabled = true`. The address is
  verified by the `business-email` function (6-digit code, 30 min, 1 min between sends, attempt cap).
- **When it sends (send-push):** only for the owner alert types (`EMAIL_TYPES`, now including
  `business_message_received`), and only as a FALLBACK, never a second copy:
  1. the owner has no push token (website-only), or
  2. Expo refuses the send as `DeviceNotRegistered`, or
  3. the receipt check (every 5 min, sends older than 15 min) finds `DeviceNotRegistered`. Then ONE email goes out.
- **Mutes:** `_send_push` drops a muted type before it reaches the outbox, so a switch that is off stops push AND email.
  Customer messages = its own switch (`owner_messages`, "Customer messages", on by default); "New requests" no longer
  covers messages.
- **Links:** `BUSINESS_WEB_URL` + `?n=<type>&r=<request or message id>` (+ `&b=<location>` on the multi-location tree).
  The email contains no message text and no customer name or id.
- **Fix made 2026-11-18:** the receipt-check email (case 3) used to keep only `type` + `request_id`. A message alert
  therefore linked to the plain dashboard, and on multi-location the location was dropped for every alert. It now keeps
  `message_id` and `partner_id` too (ids only). Test: `sendPushDeadToken.test.js`.

## 2. Resend configuration (owner does this)

| Step | Staging | Production (later, own approval) |
|---|---|---|
| Resend account | the owner's account (free tier is enough) | same account |
| Sending domain | none needed: Resend's test sender `onboarding@resend.dev` delivers ONLY to the Resend account's own email address. For a second inbox, verify a staging subdomain instead | a domain the owner owns. `github.io` can't be verified, so a domain must be bought. Add Resend's SPF + DKIM DNS records and wait for "Verified"; add a DMARC record (`p=none` to start) |
| API key | a separate key, permission **Sending access** | a separate key, Sending access, restricted to the production domain |
| `RESEND_API_KEY` | `supabase secrets set --project-ref hxsioiiulubavhogzipo RESEND_API_KEY=…` | `--project-ref enmosvippabmuqslzrox` |
| `EMAIL_FROM` | `Nearby Staging <onboarding@resend.dev>` | e.g. `Nearby <alerts@your-domain>` (must be on the verified domain) |
| `BUSINESS_WEB_URL` | the private staging website address, with a trailing `/` | `https://allenklein94.github.io/Nearby/business/` (trailing `/`) |

### Which domain (2026-11-18)

Nearby has no domain of its own today: the repo uses a Gmail address and `allenklein94.github.io`, and Resend can send
from neither. So:

1. **Buy one domain for Nearby** at any registrar (the name is your choice). Call it `<domain>` below.
2. **Verify a sending subdomain, not the root:** `notify.<domain>`. That keeps alert email's reputation separate and
   leaves the root free for a website and a support mailbox later. Sender: `Nearby <alerts@notify.<domain>>`.
3. **Until then, staging needs no domain:** use `onboarding@resend.dev` and the Resend account's own address as the test inbox.

Exact steps in Resend (owner):

1. Resend > **Domains** > **Add domain** > `notify.<domain>`, region **us-east-1**.
2. Resend shows the DNS records to add, typically an **MX** and a **TXT (SPF)** record on `send.notify.<domain>` and a
   **TXT (DKIM)** record at `resend._domainkey.notify.<domain>`. Copy each one exactly as Resend shows it into the
   registrar's DNS. Don't change any existing records on the root.
3. If the root has no DMARC record yet, add a TXT at `_dmarc.<domain>`: `v=DMARC1; p=none;`.
4. Click **Verify** and wait for "Verified" (usually minutes, up to 48 h).
5. Resend > **API keys** > create one key per environment, permission **Sending access**, domain = `notify.<domain>`.
   Keep it in a password manager. Set it yourself with `supabase secrets set` (table above), never in chat or Git.
   The production key + secrets wait for their own approval.

The alert email has no reply handling: it says to open Nearby, and the link does that.

Edge functions read secrets when they run. After setting them, the code email in check E1 shows they're live.
Check names only: `supabase secrets list --project-ref <ref>` (shows digests, never values).

**Prerequisites before any email check can pass:** on staging, the combined tree's migrations in number order
(including 20270421 dead-token handling and 20270428 message alerts), then `send-push` and `business-email` deployed from that
same tree. Without the `send-push` redeploy, the message push still goes out but sends no email. For the link
checks, the staging website must also be exported from that tree and pointed at staging.

## 3. Hosted staging checks

Use dedicated staging test accounts only: owner W (website only, no app), owner P (phone app), a customer C, and on the
multi-location tree one owner who manages locations L1 + L2. Record each check as PASS / FAIL / SETUP-BLOCKED with time,
account and the evidence (inbox screenshot, `push_outbox` row id, function log line).

### Sender + verification
- **E1.** W adds their address in Business Notifications (website) -> the code email arrives within 1 min, from `EMAIL_FROM`.
  Entering the code shows the address as verified. A wrong code and an expired code show their own messages.
- **E2.** Before the secrets are set (or with them removed): adding an address shows "Email alerts aren't switched on for
  Nearby yet. Phone notifications still work." Nothing is stored as verified.
- **E3.** Resend dashboard: the code email shows "Delivered". On a custom domain, the message headers show SPF + DKIM pass.

### Email delivery + links
- **E4. Request alert:** C sends a request that reaches W's business -> W gets ONE email. Its link opens that request in
  Opportunities after sign-in.
- **E5. Message alert:** C writes to W's business -> W gets ONE email: "New message from a customer" / "Open it to read
  and reply." with "Open this conversation: …&r=<message id>". The email has no message text and no customer name.
  The link opens Business Mode > Messages on that conversation after sign-in (also when signed out at the time of the click).
- **E6. Wrong account:** another staging account opens W's link -> the plain inbox, no error, nothing from C shown.
- **E7. Burst:** C sends 3 messages within 5 min -> exactly one email (all 3 messages visible in the conversation). After
  5 quiet minutes, a new message -> one more email.
- **E8. Multi-location tree only:** C writes to L2 while the owner's selected location is L1 -> the email link carries
  `&b=<L2>`. Opening it switches to L2 and opens the conversation. A non-member opening it sees the plain fallback.

### Notification preferences
- **E9.** W turns **Customer messages** off -> a new message sends no push and no email (no `push_outbox` row for W).
  Turned back on -> the next one alerts.
- **E10.** W turns only **New requests** off -> a message still alerts. A request does not.
- **E11.** Both switches show in the app and on the website. An owner sees "Customer messages" (business) and "Messages"
  (personal) as two different lines in Settings.

### Push-to-email fallback
- **E12. No app:** W (no token) -> email only, as in E4/E5. `send-push` answers `skipped: 'no_token', emailed: true`.
- **E13. Dead device, at send:** P deletes the app (staging build). The next alert: Expo refuses `DeviceNotRegistered` ->
  P's token is cleared and P gets ONE email at once, with a link to the same object.
- **E14. Dead device, at receipt:** an alert sent while the token still looked valid -> after >= 15 min the receipt check
  clears the token and sends ONE email linking to the same conversation/request. A second receipt run sends nothing.
- **E15. Push still works:** P with the app gets the push and NO email (never a second copy). Tapping it opens the
  conversation (build after 0428). On a build 87 phone, the push shows and the tap leaves P where they were.
- **E16. Provider failure:** with a wrong `RESEND_API_KEY`, the alert is still recorded and the push still works. The
  function log shows `business email alert NOT sent (provider_error_401)`. The customer's message is unaffected.

### Links, access and privacy (added 2026-11-18)
- **E17. Full chain:** C submits a request -> W (no app) gets ONE branded email from `EMAIL_FROM` -> the link opens the
  staging website -> W signs in (phone code) -> that exact request opens in Opportunities -> W sends an offer -> C sees it.
  Record the email's arrival time vs the request time.
- **E18. Signed out at click:** the same link while signed out -> sign-in -> lands on the same request (the website keeps
  `n`/`r`/`b` across sign-in).
- **E19. Expired / answered request:** open an alert link after the request expired (or was cancelled) -> "no longer
  available", nothing else of the request shown.
- **E20. Invalid links:** `r=` a random uuid, `r=not-a-uuid`, `n=` unknown type, no query -> each lands on the plain
  dashboard or "no longer available", never an error page or another business's data.
- **E21. Wrong business:** a second staging business owner opens W's link -> nothing from W's request (as E6).
- **E22. Email privacy:** the email's full source (Gmail "Show original") holds no customer name, phone, email, message
  text or customer id; only the type, request/message id and location id in the link; headers show SPF=pass,
  DKIM=pass, DMARC=pass for `mail.thisisnearby.com`; `Reply-To: support@thisisnearby.com`.
- **E23. Redirect hop (after the cutover only):** the same link via `https://business.thisisnearby.com/?n=..&r=..&b=..`
  and via the old `https://allenklein94.github.io/Nearby/business/?n=..` keeps every parameter. (business. -> /business
  keeps the query today, checked 2026-11-18 with dummy ids; the github.io -> thisisnearby.com hop exists only after the cutover.)

### Cleanup
- Delete the staging test messages, followers, outbox rows and email settings rows by their recorded ids. Remove the
  staging Resend key when testing ends if it won't be reused.

## 4. Not covered here

Browser push (not built, out of scope), HTML email templates, unsubscribe links (the in-app switches are the control) and
production sending. Production needs its own domain verification, secrets approval and the post-deploy plan entries in
`scripts/live-verify/post-deploy.js` (20270421, 20270428).
