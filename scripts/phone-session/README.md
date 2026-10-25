# First phone session: test data (owner, 2026-10-23)

Setup S4-S6 of `PRODUCT_AUDIT/FIRST_PHONE_SESSION_RUN_ORDER_2026-10-23.md`. Adds no product behaviour.

## What the seed creates (fixed ids, so reruns create nothing new)
- 3 test people: Maya (test), Jordan (test), Sam (test). Emails `@phone-session.nearby.invalid`: they cannot sign in or receive mail. No push token, not photo-verified.
- 8 public gatherings near `SEED_LAT/SEED_LNG`, titles ending "(test)", made as their host through the app's own insert (RLS + every trigger):
  starting within the hour (Coffee), tonight 7:30 PM (Live Music), tomorrow 9 AM (Pickleball, Sam hosts), tomorrow 3 PM (Coffee),
  the next Friday incl. today 2 PM (Pickleball), Saturday 10 AM (Pickleball, **approval needed**), Saturday 8 PM (Live Music, Sam hosts),
  next week's Wednesday 8:30 AM (Coffee). Any start already past is skipped and reported.
- 3 joins between test people (so some "N attending" figures are real).
- 7 test businesses (owner, 2026-10-25), names ending "(test)", description "Not a real business.", each with its own pin
  (west/north/south of the seed point), hours and largest group. Only "Harbor Coffee (test)" is linked to `BUSINESS_OWNER_EMAIL`;
  the other six have no owner (no business push, nobody can reply):

  | Business | Category | Distance | Hours (daily) | Expected |
  |---|---|---|---|---|
  | Harbor Coffee (test) | Coffee | 0.6 mi | 7 AM-9 PM | everywhere; nearest coffee |
  | Tidewater Pickleball Courts (test) | Pickleball, outdoor | 2.5 mi | 8 AM-8 PM | pickleball only |
  | Driftwood Coffee Bar (test) | Coffee | 4 mi | 7 AM-9 PM | coffee, after Harbor |
  | Lantern Room Live Music (test) | Live Music, indoor | 7 mi | 5-11 PM | live music only; closed for "coffee at 10 AM"-type times |
  | Seagrass Yoga Studio (test) | Yoga, indoor | 11 mi | 6 AM-8 PM | yoga only; inside 15 mi |
  | Far Shore Coffee (test) | Coffee | 22 mi | 7 AM-9 PM | Discover word search + map (50 mi); NOT a typed ask / Ask Nearby Businesses at 15 mi; yes at 30 |
  | Inland Lanes Bowling (test) | Bowling, indoor | 60 mi | 10 AM-11 PM | nowhere (beyond the 50 mi maximum) |
- 1 accepted friendship: Sam (test) and `FRIEND_ACCOUNT_EMAIL` (written already accepted, with its chat row, so no friend-request push).

## Use
```
# local test database (from-scratch replay container): NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg
SEED_LAT=.. SEED_LNG=.. FRIEND_ACCOUNT_EMAIL=.. BUSINESS_OWNER_EMAIL=.. node scripts/phone-session/seed.js plan    # read-only + approval code
...                                                                         node scripts/phone-session/seed.js apply
node scripts/phone-session/cleanup.js plan                    # dry run (rolled back): exact rows per table + approval code
node scripts/phone-session/cleanup.js apply --confirm=<code>  # commits only if the deletion still equals that dry run
```
Production (no `NEARBY_LOCAL_DB_URL`, `SUPABASE_ACCESS_TOKEN` set) additionally needs `SESSION_DATE` + `SESSION_START`, and
`apply --production --confirm=<code>` with the code from a plan the owner approved. Without them the scripts refuse before writing.

## What cleanup removes
The seeded gatherings, businesses, people (and what cascades from them), the business-owner link, then any row in `public`/`private`
whose uuid column still names a seeded id (queued pushes to test people, events about test objects). Attendance is deleted first, so
nobody who joined during the session gets a "gathering was cancelled" push. Kept: the real accounts, their own gatherings and their
business requests (minus the request rows to the test businesses). The dry run lists, by id, every request a REAL account sent
that touches a seeded id (`real_account_requests`, each marked DELETED or kept), and its approval code covers that exact list:
the owner approves each one before deletion; a different set at apply time = nothing deleted.

## Verified (2026-10-23, local from-scratch replay 463/463, never production)
Seed, rerun (0 created), simulated session (join, approval request, Interested, broadcast + directed request reaching the test
business, its Opportunities showing both, an own gathering), cleanup dry run, wrong/missing code refused, apply; afterwards every
table's content fingerprint equals the pre-seed baseline except the real accounts' own activity. Refusals (unknown email, owner
already manages a business, missing location, production without flags) wrote nothing.

## Notification safety (owner, 2026-10-24)
- `seed.js apply` aborts (writes nothing) if the seed queued a push for ANY real account. The known path: a public gathering's
  "🎯 This matches you" goes to every account in `push_target_areas` (presence < 1 h OR app opened < 48 h) with a matching interest,
  at any distance unless it set one. Clear it by waiting, or turn off that account's discovery ("things to do") notifications.
- The seeded Sam <-> friend chat is written with `reminder_sent_at`, so `send_match_reminders` never sends "Say hi to Sam (test)!".
- Cleanup also deletes pushes whose data names a seeded id (notifications to real accounts about test objects).
- `simulate.js` (same settings): seed -> [SIM_MODE=B: session activity by the friend account] -> cleanup in ONE transaction that is
  aborted at the end; reports every push queued, and whether every row naming the friend/owner account is byte-identical afterwards.
  Verified on production 2026-10-24 (aborted, nothing written): mode A refused (the phone-login account would get 3 pushes);
  mode B = pushes only to test people, friend + owner rows identical, every table's row count back to its pre-seed value.
