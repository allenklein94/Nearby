# Notification reason+action audit — items 48 & 49 (2026-09-11)

Audited every one of the 59 live Postgres functions in production
(`enmosvippabmuqslzrox`) whose body calls `send-push` (queried directly via
`pg_get_functiondef`, not from migration files — migration files contain
superseded versions), against:

> 48. Every recommendation-shaped notification should answer "why am I
> getting this?" and "what can I do about it?"
> 49. Don't notify users about things they can't actually act on — the
> notification system needs to be downstream of actual actionable inventory.

Cross-referenced every notification `type` against `src/services/
notifications.js`'s `routeNotificationTap()` switch (294 lines, read in
full).

## Full function-by-function table

| Function | `type` | Verdict | Why |
|---|---|---|---|
| `check_mutual_notice` | `new_match` | OK | Real names, routes to Chat |
| `notify_new_message` | `message` | OK | Sender name + body, routes to Chat |
| `notify_super_notice` | `wave` | OK | Named sender, social gesture — exempt from strict CTA |
| `notify_friend_request` | `friend_request` | OK | Named requester, routes to Friends |
| `notify_friend_request_accepted` | `friend_accepted` | OK | Named accepter, routes to Friends |
| `record_friend_discovery_swipe` | `friend_discovery_match` | OK | Named person, routes to Chat |
| `notify_sighting_crossed_paths` | `crossed_paths_sighting` | OK | Named person + real event, routes to ViewProfile |
| `notify_new_story` | `new_story` | OK | Named poster, routes to ViewProfile (honest, no story-viewer route exists) |
| `send_birthday_reminders` | `birthday` | OK | Named person, routes to ViewProfile |
| `notify_screenshot_taken` | `screenshot` | OK | Named person, routes to Chat |
| `notify_video_call_started` | `video_call` | OK | Named caller, routes to Chat |
| `send_match_reminders` | `match_reminder` | OK | Real elapsed time + name, routes to Chat |
| `notify_playlist_addition` / `notify_trip_idea_addition` / `notify_shared_decision_addition` / `notify_constitution_addition` / `notify_memory_addition` / `notify_stress_test_addition` / `notify_timeline_addition` | resp. types | OK | Named adder + specific content, routes to Chat |
| `notify_gathering_approved` | `gathering_approved` / `gathering_waitlisted` | OK | Real gathering title + real state change, routes via match_id/browse |
| `notify_gathering_cancelled` | `gathering_cancelled` | OK | Real title; no id since row is deleted — honest browse fallback |
| **`notify_gathering_interest`** | `gathering_interest` | **violates-49** | Body names a real person + real gathering ("X is interested in 'Title'"), but the payload never includes `gathering_id` even though `new.gathering_id` is right there in the trigger row — tap falls through to a generic `Gatherings` browse instead of the specific gathering the host needs to review/approve |
| `notify_gathering_interest_threshold` | `recommended_gathering` | OK | Real count + title + interest match, routes to GatheringDetail |
| `notify_gathering_updated` | `gathering_updated` | OK | Real title + what changed, routes to GatheringDetail |
| `generate_next_recurring_gathering` | `recurring_gathering` | OK | Real title, routes to GatheringDetail |
| `invite_friend_to_gathering` | `gathering_invite` | OK | Named inviter + title, routes to GatheringDetail |
| `send_gathering_reminders` | `gathering_reminder` | OK | Real title + real time, routes to GatheringDetail |
| `notify_matching_things_to_do` | `recommended_gathering` | OK | Real title/category/when + "matches your interests", routes to GatheringDetail |
| **`notify_matching_business_availability`** | `recommended_business_availability` | **violates-49 (fix already in flight)** | Body is a real, specific reason ("Y's 'X' matches your interests") — satisfies 48. But the tap (`routeNotificationTap`) just lands on the generic Discover tab, not the matched posting, even though the payload carries `availability_id`/`partner_id` and a real bound consumer action already exists (`AskBusinessScreen`'s `matchedAvailability` flow). `get_business_availability_by_id()` (`supabase/migrations/20261010_business_availability_by_id.sql`) is already written AND already applied live in production to close this — but `notifications.js` was never updated to call it. **This is the single biggest fix on this list.** |
| `notify_group_intent_threshold` | `group_intent_signal` | OK (soft) | Real count + category, routes to Home, where the real card re-renders — acceptable, though slightly generic vs. a category-scoped destination; not worth touching |
| `propose_group_plan` / `invite_to_business_request` | `group_plan_invite` | OK | Named initiator + category, routes to GroupPlan |
| `confirm_group_plan` | `group_plan_confirmed` | OK | Real category, routes to GroupPlan |
| `respond_to_group_plan` | `group_plan_response` | OK | Named responder + real outcome, routes to GroupPlan |
| `set_group_plan_budget` | `group_plan_response` (reused) | OK | Real reason (budget changed), routes to GroupPlan |
| `confirm_group_plan_offer` | `group_plan_offer_pending` / `group_plan_reservation_confirmed` | OK | Real state, routes to GroupPlan |
| `remove_group_plan_participant` | `group_plan_removed` | OK | Real category, routes to GroupPlan |
| **`cancel_community`** | `community_cancelled` | **no-tap-handler** | Real name + reason ("'X' has been cancelled by its creator") satisfies 48, but `community_cancelled` has **no case at all** in `routeNotificationTap` — tap does literally nothing (falls to `default: break`). The sibling `gathering_cancelled` case already has the correct honest fallback shape (land on browse, since the row is gone) — this type was just never added alongside it. |
| `notify_community_area_demand_threshold` | `community_area_demand_growing` | OK | Real count + category, routes to CommunityDetail |
| `notify_aggregated_demand_threshold` | `aggregated_demand_growing` | OK | Real count + category, routes to BusinessDashboard requests |
| `_business_request_fanout` / `_match_request_to_availability` / `_match_request_to_policy` / `_ai_auto_respond_to_business_requests` | `business_opportunity_received` | OK | Title is generic ("New opportunity nearby!" / "Your availability was just matched!") but body always carries the real specific request text — routes to BusinessDashboard requests, genuinely actionable (business can respond) |
| `admin_review_business_content_screening` / `post_business_availability` / `submit_business_offer` | `business_offer_received` | OK | Named business + real request text, routes to BusinessRequestDetail |
| `_accept_business_offer_internal` / `accept_business_offer` | `business_offer_accepted` | OK | Real request text, routes to BusinessDashboard |
| **`withdraw_business_offer`** | `business_offer_withdrawn` | **no-tap-handler** | Named business + real request text satisfies 48, but `business_offer_withdrawn` has **no case** in `routeNotificationTap` — tap does nothing. The sibling `business_offer_received` already proves `BusinessRequestDetail` with `request_id` is the right destination for this exact request object. |
| `approve_business_partner_request` | `business_partner_approved` | OK | Real business name, routes to BusinessDashboard |
| `deny_business_partner_request` | `business_partner_denied` | OK | Real reason (admin notes or fallback text), routes to MyBusinessApplication |
| `request_more_business_partner_info` | `business_partner_needs_info` | OK | Real reviewer notes, routes to MyBusinessApplication |
| `respond_to_business_partnership_request` | `business_partnership_response` | OK | Named business + real outcome, routes to Gathering/CommunityDetail |
| `notify_business_update` | `business_update` | OK | Direct content from a followed business (self-explanatory source), routes to BusinessProfile |
| **`propose_date`** | `date_proposal` | **no-tap-handler** | Named proposer + real plan text satisfies 48, but `date_proposal` has **no case** in `routeNotificationTap` — tap does nothing. Payload already carries `match_id`; `DateProposalScreen` is keyed by `matchId` (confirmed via its 4 real navigation call sites in `MatchesScreen.js`/`ChatScreen.js`/`ViewProfileScreen.js`) and calls `getLatestDateProposal(matchId)` itself, so no new lookup is needed — just wire the case. |
| **`respond_to_date_proposal`** | `date_proposal_response` | **no-tap-handler** | Real outcome + named responder satisfies 48, but `date_proposal_response` has **no case** either — same fix as above (`match_id` already in payload). |
| **`submit_social_offer`** | `social_offer_received` | **no-tap-handler** | Named offerer + real offer text satisfies 48, but `social_offer_received` has **no case**. Payload carries `request_id`/`offer_id`, not `proposal_id` — and the only consumer-facing surface for a social offer at all is `GroupPlanScreen` (keyed by `proposalId`, confirmed via `groupPlans.js`'s `getGroupPlanDetail()` — social offers are scoped to `proposal.resulting_request_id`; no other screen queries `social_offers`). Needs a small RPC change (see fix list), not just a client-side switch case. |
| **`respond_to_social_offer`** | `social_offer_responded` | **no-tap-handler** | Same shape/fix as above. |
| `submit_social_offer` (RLS note, not a push finding) | — | — | The RPC's own eligibility check (friendship/match/community/shared-gathering) doesn't technically require the target request to be part of a group plan — but the client (`src/screens/GroupPlanScreen.js`) is the *only* caller anywhere in `src/`, and it always passes `proposal.resulting_request_id`. So in real usage this is never orphaned; flagged for awareness only, not a fix. |
| `send_first_mission_reminders` | `first_mission_reminder` | OK (soft) | Generic-ish copy ("Say yes to one thing this week") but this is an onboarding nudge, not a recommendation about specific inventory — reason is implicit (you haven't done your first mission yet); routes to Gatherings browse, acceptable |
| `send_momentum_nudges` | `momentum_streak_nudge` / `reward_tier_nudge` | OK | Real streak/redemption counts, routes to Momentum/Rewards |

## Fix list (concrete, worth doing)

1. **Wire `recommended_business_availability` tap to the specific posting** (biggest item). `get_business_availability_by_id()` is already live. In `notifications.js`, make `routeNotificationTap` handle this case by calling `supabase.rpc('get_business_availability_by_id', { availability_id_param: data.availability_id })`; on a real row back, navigate to `AskBusinessScreen` with a `matchedAvailability` object shaped exactly like `intentResolver.js`'s (`availabilityId, partnerName, title, description, offerType, price, attributes, cuisine`) plus `partnerId`; on no row (already expired/inactive — the RPC filters `status='active' and ends_at > now()`), fall back to the current generic Discover-tab behavior with no dead end. Since `routeNotificationTap` is currently synchronous, this needs to become async-tolerant (the function can stay sync and fire-and-forget the async branch only for this one case, same as any other async work triggered from an event handler).

2. **Add `gathering_id` to `notify_gathering_interest`'s push payload.** One-line SQL migration: `'data', jsonb_build_object('type', 'gathering_interest', 'gathering_id', new.gathering_id)`. No client change needed — `notifications.js`'s existing `gathering_interest` case already checks `data.gathering_id`.

3. **Add a `community_cancelled` case** to `routeNotificationTap`, alongside `gathering_cancelled` — same honest "row's gone, land on browse" shape: `navigationRef.navigate('Communities')`.

4. **Add a `business_offer_withdrawn` case** to `routeNotificationTap` — same destination as its sibling `business_offer_received`: `navigationRef.navigate('BusinessRequestDetail', { requestId: data.request_id })`.

5. **Add `date_proposal` and `date_proposal_response` cases** to `routeNotificationTap` — both already carry `match_id`; route to `navigationRef.navigate('DateProposal', { matchId: data.match_id })`. No new RPC needed.

6. **Fix `social_offer_received`/`social_offer_responded`** — two-part fix since `GroupPlanScreen` needs a `proposalId`, not a `request_id`:
   - In `submit_social_offer()` and `respond_to_social_offer()`, add a lookup (`select id into v_proposal_id from group_plan_proposals where resulting_request_id = <the request id> limit 1`) and include `'proposal_id', v_proposal_id` in the push payload.
   - In `notifications.js`, add `social_offer_received`/`social_offer_responded` into the existing `group_plan_invite`/`group_plan_response`/etc. case group (same `if (data.proposal_id) navigate('GroupPlan', ...)` shape already there).

Everything else surveyed is either already correctly reason-bearing and actionable, or is a purely social/relational notification (message, match, friend request, wave, screenshot, video call, Together-tools additions) that's inherently self-explanatory and already routes to the one real place it's actionable — no changes recommended there.
