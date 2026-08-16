# Domain C — Group/Merged Request (Phase D group plans) deep audit

**STATUS UPDATE (2026-08-15, same day): Findings C1, C2, and C3 below are all FIXED**, in
`supabase/migrations/20260815_v4_group_plan_fixes.sql`, verified live against production with
real disposable test data reproducing each exact scenario described below (the cascade, the
race, and the cross-proposal double-commitment) and confirming none of them still occur, plus 3
separate from-scratch migration replays. See `CLAUDE.md`'s "Aug 15 2026 — connectivity audit
fixes" section for the full record. This file is otherwise left as originally written — the
original findings text below is the real, accurate account of what was broken before the fix.

Source: `supabase/migrations/20260815_v3_group_plans_phase_d.sql` (947 lines, read in full),
cross-referenced against `supabase/migrations/20260814_business_fulfillment.sql`
(`submit_business_offer`, `cancel_business_request`, `expire_stale_business_requests`),
`src/services/businessFulfillment.js`, `src/screens/BusinessDashboardScreen.js`,
`src/screens/BusinessRequestDetailScreen.js`, `src/services/notifications.js`. Static code
reading only — no live DB queries run. Everything below is a real, confirmed defect found by
tracing the actual current function bodies, not inferred from CLAUDE.md's own changelog (which
documents this feature's own self-testing at build time, not an independent second look).

## What's genuinely solid (checked, not assumed)

- Every one of the 7 RPCs correctly re-derives caller identity from `auth.uid()` — none trust a
  client-supplied user id anywhere.
- `propose_group_plan`/`respond_to_group_plan`/`set_group_plan_budget`/`confirm_group_plan`/
  `leave_group_plan` all lock the `group_plan_proposals` row `for update` as their first real
  read — since `leave_group_plan` and `confirm_group_plan` lock the *same* row, a leave and a
  confirm racing each other correctly serialize instead of interleaving.
- `respond_to_group_plan` genuinely double-response-guards (`status <> 'invited'` → reject) and
  expiry-guards (`expires_at < now()`) — reproducible, not just claimed.
- `set_group_plan_budget`'s re-consent reset (rule 7) is real: every already-`accepted`
  non-initiator participant is demoted back to `invited` on any budget change, with a real push
  telling them why. Confirmed this fires even on the *first* budget-set call (not just
  subsequent changes) — intentional per the rule's own text ("material change... requires
  re-consent," and before a budget is set nobody has consented to a specific number at all), but
  worth flagging as a UX cost: **every real group plan requires two full accept round-trips**
  (accept the invite → get reset when budget is set → re-accept) even in the best case where the
  budget never actually changes after the first time it's set. Not a defect, a real design
  tradeoff — P3, note only.
- `confirm_group_plan`'s roster finalization is real: excluded users and anyone still
  `invited`/`declined` are flipped to `left` before the final `party_size`/`count` sum, so the
  count genuinely reflects only real `accepted` rows (rule 5, rule 9 both hold).
- `accept_business_offer` genuinely cannot be called by a group-plan request's own `requester_id`
  (`if v_request.group_plan_id is not null then raise exception...`) — reconfirmed by reading the
  *current* function body (not an older migration), so the Aug 15 same-day claim that this guard
  survived a `CREATE OR REPLACE` intact is independently re-verified true here, not just trusted.
- `_accept_business_offer_internal` and `accept_business_offer` are genuinely byte-identical in
  logic (both re-checked line by line) — the internal one just omits the requester-ownership
  check, matching the documented design.
- `is_group_plan_participant()` correctly refuses to answer for a pair not involving the caller
  (`when auth.uid() <> user_id_param then false`) — same defensive shape as `is_blocked()`.

## FINDING C1 — P1 — [FIXED 2026-08-15] Confirmed: merging a group plan leaves the participants' own original
individual requests' *already-generated* business offers permanently orphaned, in a state both
the business dashboard and the consumer's own request-detail screen render incoherently

**Evidence.** `confirm_group_plan` (`20260815_v3_group_plans_phase_d.sql:517-535`) does two
things to the participants' original individual `business_requests` rows: creates the one new
shared row, then:
```sql
update business_requests br
set status = 'merged', superseded_by_group_plan_id = proposal_id_param
from group_plan_participants gpp
where gpp.proposal_id = proposal_id_param
and gpp.status = 'accepted'
and br.id = gpp.source_request_id
and br.status = 'open';
```
This flips the *parent request's* status, but **never touches `business_request_offers` rows
that reference those same now-`merged` `source_request_id`s.** Every individual participant's
original solo request (including the initiator's own) was already fanned out to nearby
businesses the moment it was first created (`_business_request_fanout`/`_match_request_to_
availability`, called from `create_business_request` at line ~230 of
`20260814_business_fulfillment.sql`) — so by the time a group plan gets proposed and confirmed,
it is entirely normal for one or more of the merged individual requests to already have real
`pending` or `offered` `business_request_offers` rows sitting against them.

**Compare against this exact codebase's own established convention for every other "a request
stops being open" path** — `cancel_business_request` (`20260814_business_fulfillment.sql:518-
523`):
```sql
update business_requests set status = 'cancelled' where id = request_id_param;
update business_request_offers
set status = 'cancelled'
where request_id = request_id_param and status in ('pending', 'offered');
```
and `expire_stale_business_requests()` (`20260815_v3_group_plans_phase_d.sql:914-946`), which
expires a request's own pending/offered offers *in the same sweep* as the parent's own expiry.
**`confirm_group_plan` is the one place in this whole schema that closes a request without
cascading that closure onto its own child offers.**

**Confirmed downstream impact, both directions:**
1. **Business side** — `getBusinessOpportunities()` (`businessFulfillment.js:113-121`) has no
   filter on the joined `business_requests.status`; it returns every offer row for the partner,
   unfiltered, ordered by `created_at desc`. `BusinessDashboardScreen.js`'s Requests-tab render
   (lines 1087-1124) only shows the Make-an-Offer/Decline buttons when
   `o.status === 'pending' && o.business_requests?.status === 'open'` (line 1097) — correctly
   suppressed for a merged parent — **but the "else" status line at line 1119 only fires when
   `o.status !== 'pending'`.** For a still-`'pending'` offer row whose parent has since been
   merged, *neither* branch renders: no buttons (correctly suppressed) *and no status text*
   (the row is left blank below the request text/category line) — a permanently stuck, silently
   unexplained row that `getBusinessOpportunities()` will keep returning forever, since
   `expire_stale_business_requests()` never reaches it (its own sweep is scoped to `status =
   'open'` parents only, and this parent is `'merged'`, never `'open'` again).
2. **Consumer side, worse** — `BusinessRequestDetailScreen.js`'s offer-accept gate (lines 358-
   378) is `!hasWinner && isGroupPlanRequest` → "Confirm With the Group" vs. `!hasWinner &&
   !isGroupPlanRequest` → a real, tappable **"Accept This Offer"** button calling
   `handleAccept(o.id)` directly. `isGroupPlanRequest` is `!!request.group_plan_id` (line 267) —
   for the *merged, superseded* individual request, `group_plan_id` is **not** set (only
   `superseded_by_group_plan_id` is — that column is entirely different and only checked for the
   *banner*, at line 268/312, never for the offer-accept gate). So if a business had already
   submitted a real offer (`status = 'offered'`) on Claude's solo request *before* Claude formed
   a group plan with it, the resulting screen for that now-`'merged'` request shows **both**: the
   correct "This request became part of a shared group plan → View Group Plan" banner (line
   312-324) **and**, further down, a live "Accept This Offer" button on the stray offer card,
   since neither branch's condition checks `request.status === 'open'` (or the already-computed
   `isMergedIntoGroupPlan`) at all. Tapping it calls `accept_business_offer`, which *does*
   correctly reject server-side (`request.status <> 'open'` → `'This request has already been
   resolved.'`) — so no data corruption results — but the screen presents two contradictory
   pieces of UI at once (go elsewhere / also, accept right here) and the second path always
   dead-ends in a confusing server error for something the UI itself offered as a real action.

**Why it matters**: this is precisely the audit's own named risk under section 5 ("what happens
to each participant's own already-submitted individual request once merged?") and section 6
("can the UI ever display stale or contradictory information? ... duplicate representations?").
Rule 4's text ("must not also independently generate a *duplicate* business opportunity") is
half-enforced — no *new* opportunity is created against a merged request — but an
*already-existing* one is left as a dead, still-partially-actionable relic on both ends.

**Fix**: `confirm_group_plan` should cascade-expire (not cancel — the terms weren't declined,
they were superseded) every `pending`/`offered` `business_request_offers` row whose
`request_id` is one of the just-merged `source_request_id`s, in the same statement block that
flips the parent to `'merged'` — mirroring `cancel_business_request`'s own adjacent-line pattern
exactly. Belongs entirely in the database/RPC layer; no frontend change needed once the backend
stops leaving these rows dangling (the `business_requests?.status === 'open'` gates already in
both screens would then correctly suppress everything with zero further UI work, since a
`'merged'` parent's offers would legitimately read `'expired'`).

## FINDING C2 — P1 — [FIXED 2026-08-15] Confirmed: `confirm_group_plan_offer` has no row lock on its
quorum-counting path — the exact "last confirmation" race the function exists to guard against

**Evidence** (`20260815_v3_group_plans_phase_d.sql:816-905`). Every other accept-adjacent RPC in
this schema (`accept_business_offer`, `_accept_business_offer_internal`,
`approve_gathering_interest` per the Aug 15 architecture-hardening fix, `join_gathering`) takes a
`for update` lock on the row(s) whose state determines whether an action is allowed to proceed,
specifically to close the exact race two concurrent callers can otherwise hit. `confirm_group_
plan_offer` does not:
```sql
select * into v_proposal from group_plan_proposals where id = proposal_id_param;   -- no lock
...
select * into v_offer from business_request_offers where id = offer_id_param;      -- no lock
...
insert into group_plan_offer_confirmations (...) values (...) on conflict (offer_id, user_id) do nothing;
select count(*) into v_required_count from group_plan_participants where proposal_id = proposal_id_param and status = 'accepted';
select count(*) into v_confirmed_count from group_plan_offer_confirmations where proposal_id = proposal_id_param and offer_id = offer_id_param;
if v_confirmed_count < v_required_count then
  ... notify the rest, return {allConfirmed: false}
end if;
v_accept_result := public._accept_business_offer_internal(offer_id_param);
```
**Concrete failure scenario**: a group plan requires 3 accepted participants to confirm; 1 has
already confirmed; the remaining 2 (X and Y) tap Confirm within the same window. Under Postgres's
default READ COMMITTED isolation, each transaction inserts its own confirmation row (no
conflict — different `user_id`), then counts — but neither transaction can see the other's
not-yet-committed insert. X's count query sees `{existing 1} + {X's own}` = 2 < 3 required →
"not all confirmed" branch. Y's count query, running concurrently, sees `{existing 1} + {Y's
own}` = 2 < 3 (Y also can't see X's still-uncommitted row) → also "not all confirmed." **Both
transactions commit. The real, final state is 3/3 confirmed — quorum genuinely reached — but
neither call ever invoked `_accept_business_offer_internal`.** The reservation silently does not
happen at the moment every participant has, in fact, confirmed; the group is left thinking
they're still waiting on someone (both non-triggering calls fire the "confirm your group plan
offer" push telling the *other* not-yet-confirmed-as-of-that-snapshot participants to act, which
in this exact race can mean X and Y each get told to nudge the other, even though both already
did their part). The system is not permanently stuck — any later call to
`confirm_group_plan_offer` by *any* already-confirmed participant (the `on conflict do nothing`
insert makes a repeat call harmless and it still re-runs the count fresh) will correctly see 3/3
and trigger acceptance — but there is no guarantee anyone taps Confirm a second time, and nothing
in the UI currently prompts a "you already confirmed, but the group isn't locked in yet" retry.

**Why it matters**: this is exactly the audit's own explicit ask ("Can two merge operations occur
simultaneously?... Identify any race conditions") applied to the *offer-confirmation* step, which
is functionally the same "last person to act triggers an irreversible transaction" pattern as
capacity/waitlist and business-offer-accept — both of which this codebase already hardened with
`for update` locks in the Aug 15 architecture-hardening pass. This function was added the same
day as that hardening pass but wasn't included in it (it's a different migration).

**Fix**: lock `group_plan_proposals` (`for update`) and the specific offer row (`for update`) at
the top of the function, exactly like `_accept_business_offer_internal` already does — this
serializes concurrent confirmations from different participants on the same offer, so the count
read inside the lock is always the true, committed count. Database/RPC-layer fix only.

## FINDING C3 — P2 — [FIXED 2026-08-15] Plausible: no exclusivity between two concurrently-pending group plan
proposals that both invite the same person's still-open request

**Evidence**. `propose_group_plan` locks each invitee's `business_requests` row (`for update of
br`) only for the duration of its own transaction — nothing prevents a *second*, independent
`propose_group_plan` call (a different initiator) from inviting the same still-`open` request
into a second, concurrently-pending proposal; there is no unique constraint or check anywhere
tying a `business_requests.id` to at most one *pending* `group_plan_participants` row across
proposals (the real `unique(proposal_id, user_id)` constraint only prevents a duplicate row
*within* the same proposal). If proposal P1 confirms first, it flips that person's source
request to `'merged'`. If proposal P2 (which independently invited the same person, and where
they also `accepted`) later confirms, `confirm_group_plan`'s final party-size sum
(`group_plan_participants where status='accepted'`) does **not** re-check that each participant's
`source_request_id` is still genuinely `open` — it only conditions the *merge-flip* update on
`br.status = 'open'` (so P2's attempt to also flip that already-`merged` row silently no-ops,
correctly not double-merging the request itself), but the person's `party_size`/`guest_count`
still counts toward P2's total, and they're still fanned out as part of P2's shared request —
**effectively double-committing one person's real party size into two unrelated group plans**,
one of which (P1) they may already be locked into a real reservation for.

**Confidence**: this needs two independent initiators to concurrently target the same
still-open request before either confirms, which is a real but narrower window than Finding
C1/C2 (both of which fire on the single, mainline "one group plan, multiple participants
confirming" path). Marked P2, not P1, for that reason — plausible and traceable to real missing
enforcement, not hypothetical, but lower-frequency.

**Fix**: either a partial unique index preventing a `business_requests.id` from being an
`accepted`-or-`invited` participant source in more than one *pending* proposal at a time, or a
`confirm_group_plan`-time re-check that drops (with notice) any participant whose
`source_request_id` is no longer `'open'` before computing the final roster/party size —
database-layer fix, matching this schema's existing preference for a real constraint over
app-level discipline alone.

## Answering the audit's own Phase-D checklist directly

- **Who owns the merged request?** The initiator is `requester_id` on the new shared
  `business_requests` row — genuinely operational-submitter framing (rule 3), not exclusive
  ownership: every accepted participant gets an additive SELECT policy via
  `is_group_plan_participant()` (verified: the policy really is OR'd onto the existing
  requester-only one, confirmed by reading the actual `create policy` statement, not just
  trusting the comment).
- **Does every participant explicitly consent?** Yes — `respond_to_group_plan` is the only path
  from `invited` to `accepted`; nobody's row can reach `accepted` without their own `auth.uid()`
  call (the initiator's own row is auto-`accepted` at proposal time — that's the initiator's own
  literal act of proposing, matching rule 1's stated exception).
- **Are original requests preserved, cancelled, or linked?** Preserved and linked
  (`superseded_by_group_plan_id`), never deleted — confirmed. **But see Finding C1**: preserved
  at the request level, not cascaded to the request's own already-generated offers.
- **Can someone decline after the merge?** No explicit "decline after confirm" path exists —
  `respond_to_group_plan` only operates on `status = 'pending'` proposals (already-confirmed
  proposals reject a response attempt: `if v_proposal.status <> 'pending' then raise...`). The
  only post-confirm exit is `leave_group_plan`, which is a different, real action (not framed as
  a late decline) — matches rule 10's own framing, not a gap.
- **What happens if the organizer leaves?** They can't — `leave_group_plan` explicitly rejects
  the initiator (`'The organizer can't leave -- cancel the group plan instead.'`) — verified
  correct and intentional, not an oversight.
- **Can duplicate merged requests be created?** No — `confirm_group_plan` requires
  `status = 'pending'` and flips it to `'confirmed'` inside the same locked transaction that
  creates the one new `business_requests` row, so a double-tap/retry on the same proposal is
  correctly guarded (second call sees `status <> 'pending'` and rejects). **Two *different*
  proposals both consuming the same person's request is the separate Finding C3 above.**
- **Are all participants guaranteed to see the same canonical state?** Yes for the proposal/
  participant/confirmation rows themselves (RLS-scoped, single table, no client-side derivation)
  — but see Finding C1/C2 for cases where the *downstream* business-request/offer state that a
  participant's screen renders can diverge from what actually happened.
