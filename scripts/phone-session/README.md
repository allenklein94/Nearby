# First phone session: test data (owner, 2026-10-23)

Setup S4-S6 of `PRODUCT_AUDIT/FIRST_PHONE_SESSION_RUN_ORDER_2026-10-23.md`. Adds no product behaviour.

## What the seed creates (fixed ids, so reruns create nothing new)
- 3 test people: Maya (test), Jordan (test), Sam (test). Emails `@phone-session.nearby.invalid`: they cannot sign in or receive mail. No push token, not photo-verified.
- 8 public gatherings near `SEED_LAT/SEED_LNG`, titles ending "(test)", made as their host through the app's own insert (RLS + every trigger):
  starting within the hour (Coffee), tonight 7:30 PM (Live Music), tomorrow 9 AM (Pickleball, Sam hosts), tomorrow 3 PM (Coffee),
  the next Friday incl. today 2 PM (Pickleball), Saturday 10 AM (Pickleball, **approval needed**), Saturday 8 PM (Live Music, Sam hosts),
  next week's Wednesday 8:30 AM (Coffee). Any start already past is skipped and reported.
- 3 joins between test people (so some "N attending" figures are real).
- 1 test business "Harbor Coffee (test)" (Coffee, open 7 AM-9 PM daily, groups up to 10, its own pin), linked to `BUSINESS_OWNER_EMAIL`.
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
The seeded gatherings, business, people (and what cascades from them), the business-owner link, then any row in `public`/`private`
whose uuid column still names a seeded id (queued pushes to test people, events about test objects). Attendance is deleted first, so
nobody who joined during the session gets a "gathering was cancelled" push. Kept: the real accounts, their own gatherings and their
business requests (minus the request rows to the test business; the dry run counts them).

## Verified (2026-10-23, local from-scratch replay 463/463, never production)
Seed, rerun (0 created), simulated session (join, approval request, Interested, broadcast + directed request reaching the test
business, its Opportunities showing both, an own gathering), cleanup dry run, wrong/missing code refused, apply; afterwards every
table's content fingerprint equals the pre-seed baseline except the real accounts' own activity. Refusals (unknown email, owner
already manages a business, missing location, production without flags) wrote nothing.
