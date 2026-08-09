# Product Risks — Nearby

*Basis: findings across all other audit files, synthesized by risk category, plus live
production re-verification performed during this refresh (Management API against
`enmosvippabmuqslzrox`) — noted explicitly wherever a risk was actually re-tested rather than
re-read. **Refreshed 2026-08-09.** The last audit (2026-08-08) had to leave nearly every
security-shaped item as "reported fixed, not independently re-verified" — this refresh closes
that gap for essentially all of them. See `AUDIT_CHANGELOG.md` for the full diff.*

## Safety risks

- ~~The 13-button `Alert.alert` may make relationship-safety content unreliable on Android~~ —
  **RESOLVED.** The menu was already a real `ActionSheetModal.js` component, not a native
  `Alert.alert`, at the point the last audit was written — the risk it flagged was never
  actually live in that snapshot. See `UX_GAPS.md`.
- **No automated third-party alerting exists for the date-safety check-in flow** — unchanged,
  confirmed again this refresh (no `twilio`/`resend`/`sendgrid`/`smtp` anywhere in the repo). A
  genuinely at-risk user still depends on their own phone remaining usable to trigger a share.
  Real, structural, not a bug.
- ~~`is_blocked()`'s historical bug was not independently re-verified live~~ — **RESOLVED.**
  Live-tested this refresh with a real disposable block row, both directions: the blocked party
  (the historical failure mode) correctly sees the block; an unrelated third party correctly
  cannot probe the pair. **CONFIRMED SECURE.**
- **Admin screens still show no client-side role check of their own** — unchanged, architecturally
  consistent with the rest of the app; not independently re-tested against a real non-admin
  session this refresh either (same limitation as the last audit).

## Privacy risks

- **`gatherings`/`communities` RLS is still deliberately wide open** — unchanged design posture,
  re-confirmed live this refresh (`"Anyone can view gatherings" using (true)`). The product-
  owner decision the last audit called for (is "obscurity via normal app usage" an acceptable
  risk posture for an `invite_only` gathering) is still not made explicit anywhere in the code —
  still worth a direct answer. **Partially mitigated since the last audit**: `join_gathering()`
  itself now has real server-side `invite_only` enforcement (a determined caller can no longer
  auto-join an invite-only gathering by hitting the RPC directly), even though the underlying
  row-visibility RLS is unchanged. The two are different guarantees — join enforcement doesn't
  change what a direct `SELECT` can see.
- ~~Several business-facing RPCs previously had no ownership check, not independently
  re-verified~~ — **RESOLVED.** All 5 original functions plus 3 new-this-session ones
  live-tested this refresh (`pg_get_functiondef` read + grant checks via
  `has_function_privilege`) — all 8 confirmed to carry the ownership guard and correctly
  restrict `anon`. **CONFIRMED SECURE.**
- **A real, previously-open question about `hosting_partner_id` self-edit is now resolved,
  positively.** The last audit's own build history flagged, as a "check before building" item,
  whether a host could self-set a business affiliation on their own gathering with zero consent
  from that business — and never circled back with a documented answer. Live-tested directly
  this refresh on a real, non-test gathering: a self-edit attempt is silently reverted by a
  dedicated trigger. **CONFIRMED SECURE** — closes an open question the last audit's risk file
  didn't even know to ask about, since it predates that audit's own scope.
- **The base schema's privacy model is otherwise genuinely strong** — unchanged, independently
  re-confirmed this refresh (zero lat/lng-shaped columns among `profiles`' real 66 columns).

## Spam/abuse risks

- **Business-partnership approve/deny asymmetry** — confirmed directly this refresh (not just
  flagged as UNCLEAR): `AdminBusinessRequestsScreen`'s Approve calls a real RPC, Deny is a plain
  client `.update()`. Still worth checking whether Deny's integrity guarantees genuinely differ
  in practice — not independently re-tested for an actual exploit path this refresh, same
  UNCLEAR-severity as before, just now confirmed as a real code-level asymmetry rather than
  inferred from screen behavior alone.
- ~~No proof-of-redemption mechanism was found~~ — **RESOLVED.** A real 6-digit confirmation-code
  flow now exists; only confirmed redemptions count toward billing.
- **Content moderation via `checkTextModeration`** — unchanged, still a real, positive, repeated
  pattern.

## Growth problems

- **The referral/growth mechanism and the gathering/community invite mechanism are still
  unrelated systems sharing a casual name** — unchanged. Partially narrowed: a real path to
  invite a non-app-user to a *specific* gathering now exists (a share-link action), closing the
  specific growth gap the last audit called out, even though the naming-overlap UX risk itself
  is unchanged.
- ~~The relationship-longevity suite is nearly invisible~~ — **RESOLVED.** See `UX_GAPS.md`; a
  real consolidated hub now exists.

## Retention problems

- ~~Three real personal-stat screens are dead ends~~ — **PARTIALLY RESOLVED.** All three now
  have a real in-app CTA. The proactive-push half (a "you're on a streak"/"close to a tier"
  notification) still does not exist — no grep hit for anything resembling it in
  `supabase/functions/` or the migrations. This remains the single sharpest fall-out point in
  the product flywheel — see `PRODUCT_FLYWHEEL.md`.
- **`FeaturesOverviewScreen`'s lack of deep links** — unchanged.

## Marketplace problems (business ↔ consumer matching)

- ~~Business self-onboarding is incomplete~~ — **PARTIALLY RESOLVED.** The dashboard's own
  profile-editing gap is fixed; a real self-*claim* flow (becoming a partner without admin
  review) still doesn't exist — unchanged half of the original finding.
- ~~Whether a business can host its own gathering unilaterally is UNCLEAR~~ — **RESOLVED, as a
  definite NO.** Direct code reading confirms `host_id` is always the caller's own session; a
  business can only ever be attached via the consumer-initiated partnership flow.

## Business adoption problems

- **No payment processor exists at all** — unchanged, confirmed again this refresh. Still the
  single largest business-model gap in the codebase.
- ~~The dashboard's incomplete self-editing is a real friction point~~ — **RESOLVED**, same fix
  as above.

## Monetization problems

- **Two entirely separate monetization systems with no shared infrastructure** — unchanged.
- **Redemption-based billing depended on redemption data being trustworthy** — **materially
  improved**: a real proof-of-redemption mechanism now exists and gates what counts toward
  billing, closing the specific trust gap the last audit flagged (money still can't move at all,
  per the payment-processor gap above, but the accounting input is now more trustworthy).

## Scalability concerns

- ~~Roughly 45 of ~53 tables have no `CREATE TABLE` anywhere in this repo~~ — **RESOLVED, and
  replay-verified, not just statically confirmed.** See `DATABASE_AND_DATA_MODEL.md` for the
  full account, including one regression found and fixed during this very refresh. This was the
  single largest technical/scalability risk in the last audit and is now the single largest
  positive change in this one.
- **Search is still a client-side filter over already-fetched lists** — unchanged, confirmed
  STILL PRESENT.
- **`GatheringsScreen.js`/`ChatScreen.js` remain 1400+-line single files** — unchanged.
  `BusinessDashboardScreen.js` (1202 lines) now also crosses this threshold, a new observation
  from this refresh's own churn (three feature stacks landed in the same file this session), not
  a new class of problem.

## UX risks

**Every concrete, evidence-backed UX risk the last audit cited by name is now resolved**:
production debug code, the broken empty state, the non-functional recommendation flow, silent
message-send failures, and the relationship-tools discoverability/reliability gap. What remains
is smaller and lower-severity: the `ChemistryDiaryListScreen`/`FeaturesOverviewScreen` gaps, the
withdraw-pending-request gap, naming/terminology confusions, and — genuinely new this refresh —
the hardcoded-URL pattern being 5x larger in scope than previously documented. See `UX_GAPS.md`
for the full current-state list.

## Overall risk posture — how much actually changed

The last audit's risk section was dominated by items in an unresolved, "reported fixed but never
independently checked" state — a real, honest limitation of a code-only audit with no database
access. **This refresh had database access and used it**: essentially every safety/security-
shaped item that could be live-tested was live-tested, with real disposable test data, cleaned
up afterward, matching this repo's own established verification convention. The net result is a
genuinely lower-risk picture than the last audit could respons­ibly claim — not because the
underlying code changed dramatically in every case, but because several real fixes that existed
only as claims in `CLAUDE.md`'s own history are now independently, directly confirmed. The
remaining open risks are concentrated in two places: **business monetization is still entirely
uncollectible** (no payment processor, unchanged) and **the retention loop is still only
half-activated** (CTAs exist, proactive pushes don't) — both are product/scope decisions, not
security gaps.
