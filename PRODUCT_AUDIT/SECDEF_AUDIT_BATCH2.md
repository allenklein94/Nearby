# SECURITY DEFINER audit — batch 2 of 2

Part of the "Scorecard to 10" Phase 1 systematic audit of all `authenticated`-callable
SECURITY DEFINER functions, hunting for the ownership-check-gap bug shape this codebase has
already found and fixed six times (admin self-escalation, `matches`/`friendships` identity
hijack, `is_blocked()`'s RLS-visibility gap, business-RPC ownership gaps,
`check_and_increment_ai_use`'s cross-user rate-limit bypass). This batch covers 68 functions,
alphabetically `get_partner_billing_estimate` through `upsert_business_customer_note`. Batch 1
(`_accept_business_offer_internal` through `get_partner_avg_response_time`) is a separate report.

Read-only audit — nothing here was applied to the live database. Only real findings are listed;
every other function in this batch (the large majority) was read and is correctly scoped.

## Findings

### 1. HIGH — `increment_browse_views(user_id_param, count_param, daily_limit)` has no ownership check

The function locks and updates `profiles.browse_views_today`/`browse_views_date` for whatever
`user_id_param` is passed, with zero check that `auth.uid() = user_id_param`. The one real
client caller, `checkAndCountBrowseView()` in `src/services/browseLimits.js`, always passes the
caller's own id — but that's a client-side convention, not server-side enforcement.

**Exploit**: any authenticated user can call
`supabase.rpc('increment_browse_views', { user_id_param: '<victim-id>', count_param: 999,
daily_limit: 30 })` directly (bypassing the app entirely) to burn a victim's daily Browse
allowance to the cap, denying them Browse (a real Discovery surface, per
`browseLimits.js`'s own comment: "Crossed Paths stays unlimited... Browse is the unlimited-pool
mode") for the rest of their day, repeatable daily.

**This is the exact `check_and_increment_ai_use` bug, unfixed here.** Same remediation:

```sql
if auth.uid() is distinct from user_id_param then
  return query select false, 0;
  return;
end if;
```
at the top of the function, before the row lock.

### 2. MEDIUM — `get_sighting_fuzzed_coords(sighting_ids uuid[])` bypasses `sightings`' real RLS with no ownership check

`sightings` has a real RLS policy — `auth.uid() = user_a OR auth.uid() = user_b, and not
is_blocked(...)` — but this SECURITY DEFINER function takes an arbitrary `uuid[]` and returns
fuzzed lat/lng for every matching row with **zero check that the caller is `user_a`/`user_b`**
on any of them.

**Currently not reachable via the app itself** — confirmed via a full grep of `src/services/`:
the real client code (`proximity.js`) queries `sightings` directly through the correctly-scoped
RLS path and never calls this RPC. Zero callers found anywhere in `src/`. Real defense-in-depth
gap regardless (a live, `authenticated`-granted function bypassing RLS with no internal guard,
one leaked/logged sighting id away from exposing two other users' fuzzed "crossed paths"
location to a third party) — same shape as this codebase's own prior "not currently exploitable,
but real hygiene" fixes (e.g. the `business_partner_requests` anon-grant close).

**Fix**: add an internal guard before returning any row, matching `is_blocked`/
`is_community_visible_to`'s established pattern:
```sql
where s.id = any(sighting_ids)
  and (s.user_a = auth.uid() or s.user_b = auth.uid())
  and s.approx_area is not null;
```

### 3. LOW-MEDIUM — `has_mutual_notice(from_id, to_id)` — same gap, appears to be dead code

Zero ownership check on either parameter; bypasses `notices`' RLS to answer whether *any* two
arbitrary users have a mutual notice between them. **Zero client callers found anywhere in
`src/`** — this looks superseded by `check_mutual_notice` (in batch 1), which is itself also
uncalled from any client code. Worth confirming both are genuinely dead before deciding whether
to harden or drop `has_mutual_notice` outright; if kept, same fix shape as finding 2 (`auth.uid()
in (from_id, to_id)` guard).

### 4. LOW — `get_weather_result(request_id_param bigint)` trusts an unscoped shared id space

Pairs with `submit_weather_request()`, which returns a bare `net.http_get()` request id with no
row anywhere recording which user submitted it. `get_weather_result` then accepts any
`request_id_param` and parses whatever's in `net._http_response` at that id — a table shared by
*every* async job in the app (pushes, other weather requests, etc.), not scoped per user.
**Low real severity**: the returned fields (temp/condition/forecast label) never echo back the
original lat/lng, so even a successful cross-user hit doesn't leak location — just another
user's local weather, itself nearly public information. In normal use the client only ever
polls the id it just received, so this is adversarial-only. Real gap, but the honest fix (a
`weather_requests(id, user_id)` mapping table, written by `submit_weather_request` and checked
by `get_weather_result`) is a small schema addition, not a five-minute guard — flagged rather
than half-fixed.

### 5. LOW, hygiene — 5 cron-only functions are still `EXECUTE`-granted to `authenticated`

`purge_expired_sightings()`, `send_birthday_reminders()`, `send_first_mission_reminders()`,
`send_gathering_reminders()`, `send_match_reminders()` all take zero parameters and are meant to
run only via their own scheduled `pg_cron` jobs — but nothing revokes `authenticated`'s default
`EXECUTE` grant. Any signed-in user can call one directly, triggering an unscheduled
full-platform notification blast on demand. Mostly self-limiting in practice (each has its own
"already sent" guard — `reminder_sent`, `reminder_sent_at`, a day-of-month/window check — so a
repeat call after the real cron run typically no-ops), but it's still an unintended over-broad
grant on a job that should only ever be invoked by `pg_cron`/`postgres`. **Fix**:
`revoke execute on function public.purge_expired_sightings(), public.send_birthday_reminders(),
public.send_first_mission_reminders(), public.send_gathering_reminders(),
public.send_match_reminders() from authenticated, anon;` — matching the existing
`_business_request_fanout`-style internal-helper lockdown convention already used elsewhere in
this schema. (Batch 1's equivalent cron functions — `generate_monthly_invoices`,
`expire_stale_business_requests`, `send_momentum_nudges`, `delete_expired_stories`,
`delete_expired_disappearing_messages`, `expire_live_tracking_sessions` — weren't checked here;
worth the same grant check when batch 1's findings are reviewed.)

## Secondary observation, not counted as a primary finding

`match_contacts_to_users(phone_numbers text[])` lets a caller submit an arbitrary phone-number
array and learn which correspond to real Nearby accounts. This is the inherent, intended shape
of a contact-import feature (not a target-row-ownership gap — there's no existing "consent
record" it should be checking against), so it doesn't match the requested bug pattern. Flagged
only because there's no visible rate limit on this specific RPC, which could make it a real
phone-number-enumeration vector at scale if ever abused directly (bypassing the app's own
contact-picker UI). Worth a look in a future pass, not scored here.

## Summary

**5 of 68 functions in this batch had a real finding** (4 direct ownership-check gaps —
`increment_browse_views`, `get_sighting_fuzzed_coords`, `has_mutual_notice`,
`get_weather_result` — plus one grant-hygiene finding touching 5 more cron-only functions,
listed together under finding 5). Everything else in this batch — including every
`notify_*`/trigger function (which can't be invoked directly via RPC regardless of grants,
since they take no client-supplied target id and are bound to their own table's row context),
every `is_*`/`get_*` helper with a real `auth.uid()` guard, and every business/group-plan RPC —
was read and is correctly scoped, matching this codebase's own established remediation patterns
already applied elsewhere.
