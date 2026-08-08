# Nearby — Project Context for Claude Code

Nearby is a proximity-based dating/social discovery app (React Native/Expo/Supabase).
This file captures known outstanding work as of early August 2026, so a fresh Claude Code
session has the same context as the chat session that built most of this.

## Outstanding: Create Consolidation + Create Assistant + Business Partnership Requests (IN PROGRESS — plan written before code, in case of restart)

Started Aug 8 2026, after the `bonus_notices` exploit fix (see below) was finished and
pushed. The user re-raised the Aug 7 vision-doc email's Create-tab feedback ("Create should
become one screen... 'Make a plan' and 'Start a gathering' are basically the same") and,
through a live design discussion, landed on a bigger and more specific scope than the email
implied. **Read this section fully before assuming any part of it is done** — it was
written as a plan *before* implementation started, specifically so nothing is lost if the
codespace restarts mid-build (this session has restarted several times already). Check
git log / the actual files for what's actually landed vs. still just planned here.

**Decisions locked in during the discussion, not to be re-litigated without asking again:**
1. Collapse the Create tab's overlapping "Start Something" / "Host a Gathering" cards into
   one "Start a Gathering" entry point.
2. Add a free, unbranded natural-language "Tell us what you're thinking" box that routes to
   the right creation flow with fields prefilled. **Explicitly not premium-gated and
   explicitly never labeled "AI" anywhere in the UI** — user's own reasoning: "the user
   doesn't care that AI is powering it... Premium should sell convenience and intelligence,
   not permission to participate in your core ecosystem." This is a new, separate, smaller
   feature ("Create Assistant") from the existing premium-gated AI Concierge — not an
   expansion of Concierge, and Concierge's own gating/behavior is unchanged.
3. Build the actual feature behind "Partner with a Business" that the user's own example
   needs: "I want to get 20 people together at this restaurant... business can approve
   afterward." **Confirmed by direct code investigation this does not exist today** — the
   existing `BusinessPartnerApplyScreen` → `business_partner_requests` → admin-review flow
   (used by the "Partner With Us" row gated to organizers in an earlier pass this session)
   is a generic, app-wide "onboard a new business as a partner" application with zero
   connection to any specific gathering/community. User explicitly chose to build the real
   gathering/community-specific proposal+approval flow, not just relabel/un-gate that
   existing generic form.

**Part 1 — new schema** (`supabase/migrations/20260808_business_partnership_requests.sql`,
not yet written as of this section being committed): `business_partnership_requests` table
(`requester_id`, `target_type`: `'gathering'|'community'`, `target_id`, `partner_id` FK
`brand_partners`, `message`, `status`: `'pending'|'approved'|'declined'`, `reviewed_at`) —
polymorphic target shape matching the existing `social_invites` convention. RLS: SELECT
scoped to the requester or the target business's own owner
(`profiles.managed_partner_id = partner_id`), no direct client INSERT/UPDATE — both go
through two new SECURITY DEFINER RPCs: `request_business_partnership(target_type,
target_id, partner_id, message)` (verifies caller actually owns/hosts the target, verifies
`partner_id` is real/active, rejects a duplicate pending request for the same pair) and
`respond_to_business_partnership_request(request_id, approve)` (verifies caller owns
`partner_id`, guards against double-review, sets `hosting_partner_id` on the target row
atomically on approve). **Before writing these**: check live whether `gatherings`/
`communities`' existing owner-scoped UPDATE RLS already lets a host self-set their own
`hosting_partner_id` to an arbitrary partner id with no consent check — if so, that's a
pre-existing exploit of the same shape as this session's other guarded-column fixes, worth
closing in the same pass. **Deliberately out of scope**: a business not yet in the app
can't be targeted this way (no account to approve with) — directed to the existing generic
apply flow instead, not a second parallel admin-mediated path.

**Part 2 — business search + request UI**: `getActivePartnersByName()` (name search over
active `brand_partners`) and `getMyPartnershipTargets()` (caller's own hosted upcoming
gatherings + created/led communities) in relevant services. New
`RequestBusinessPartnerScreen.js` + route, reachable two ways: from the top-level Create
tab (target picker first, since no specific gathering/community is implied) and from a new
"🤝 Request a Business Partner" link on `GatheringDetailScreen.js` (host view) and
`CommunityDetailScreen.js` (creator/leader view) — same multi-entry-point pattern already
established for "Invite friends" earlier this session, skipping the target-picker step
since the target is already known there. `BusinessDashboardScreen.js` gains a "Partnership
Requests" section (pending requests for the caller's own `managed_partner_id`,
Approve/Decline). Notify the requester on both outcomes via the existing `send-push`
mechanism (same one `invite_friend_to_gathering` already uses).

**Part 2 status: DONE except the top-level Create-tab entry point** (that one's wired
together with the Part 3 `CreateHubScreen` rebuild below, since both land in the same file
at once). `services/businessPartnerships.js` and `RequestBusinessPartnerScreen.js` were
already fully written before a codespace restart, just never wired in — confirmed this pass
that the `business_partnership_requests` migration (Part 1) was already live in production
(`request_business_partnership`/`respond_to_business_partnership_request` both exist per
`pg_proc`), so no re-application was needed. This pass added: the `RequestBusinessPartner`
route in `RootNavigator.js`; the "🤝 Request a Business Partner" link in
`GatheringDetailScreen.js`'s host banner (`targetType: 'gathering'`); the same link in
`CommunityDetailScreen.js`, gated on `isCreator || isLeader` (added a `myId` state var and
derived `isLeader` from the already-fetched `members` list, matching the RPC's own
`role in ('creator','leader')` check); and the Partnership Requests section in
`BusinessDashboardScreen.js`'s Community tab (`getPendingPartnershipRequestsForPartner` +
Approve/Decline via `respondToBusinessPartnershipRequest`, removing the row from local state
on success rather than a full reload). **Found and fixed a real bug while wiring the
dashboard section**: `RequestBusinessPartnerScreen.js` referenced `colors.surfaceAlt`, which
doesn't exist anywhere in `theme.js` (only `background`/`surface`/`surfaceElevated`/etc.) —
would have rendered `undefined` as a background color. Fixed there and avoided copying the
same mistake into the new dashboard styles (`surfaceElevated` used instead). Verified via a
full `npx expo export --platform ios` (1841 modules, two more than the prior 1839 baseline —
the two new files from before the restart, no new files this pass). Committed and pushed
(`05fcb48b`). **Not done yet**: no manual run-through in a simulator/device — next session
should click through sending a request from both entry points and approving/declining from
the dashboard as a real business owner account.

**Part 3 — Create Assistant**: new `supabase/functions/create-assistant/index.ts` — same
bearer-token auth pattern as every existing `generate-*`/`ai-concierge` function, but **no
premium check** (the one deliberate exception to that convention in this codebase). Still
calls `check_and_increment_ai_use` with `daily_limit: 150` (matching the existing
per-message-feature ceiling, not the single-shot 50 — meant to feel unlimited to a normal
user; the shared counter is a pure cost/abuse safety net, never surfaced or marketed as a
limit). `claude-haiku-4-5-20251001`, `max_tokens: 300`. Classifies the user's own free text
(low injection surface — this is the caller's own input, not content written by other
users, unlike Concierge) into `intent: 'gathering'|'community'|'business_partner'|
'unclear'` plus best-effort `title`/`category` (re-validated server-side against a
hardcoded copy of `CreateGatheringScreen.js`'s real `INTEREST_OPTIONS` list) and
`businessName` when relevant. **No date/time extraction** — deliberately not attempted,
parsing relative dates like "Friday night" reliably is fragile; the user still picks
date/time normally on the gathering wizard's own step. `CreateHubScreen.js` rebuilt to
three cards (🎉 Start a Gathering / 👥 Create a Community / 🤝 Partner with a Business) plus
a "💡 Tell us what you're thinking" input row underneath, subtext "We'll help you turn it
into a plan," routing by returned `intent` to the right prefilled screen. "Start a
Gathering" opens the existing `StartSomethingModal` with a new optional `topLevelOptions`
prop overriding its default time-of-day-adaptive list with a fixed Coffee/Dinner/Walk/
Sports/Games/Music/Volunteer/Something Else set (mapped to real existing `INTEREST_OPTIONS`
category tags — Coffee/Foodie/Outdoors/Sports/Gaming/Music/Volunteering) — no other caller
passes this prop, so `HomeScreen.js`'s own time-adaptive use of the same modal is
unaffected. This removes the separate "Host a Gathering" direct-to-blank-wizard card — the
modal's existing "Something Else" chip already covers that exact case.

**Part 3 status: DONE.** `create-assistant` deployed to production and confirmed
`verify_jwt: true` via the Management API (not assumed — this is the exact footgun this
section already flagged, and it didn't recur this time). `CreateHubScreen.js` rebuilt to the
three cards plus the NL box; `CREATE_HUB_OPTIONS` added to `StartSomethingModal.js` as
described. `CreateCommunityScreen.js` gained `quickStartTitle`/`quickStartCategory` route-param
prefill (didn't exist before — only `CreateGatheringScreen.js` had it), so the Assistant's
`community` intent has somewhere real to land. The business-partner card routes to
`RequestBusinessPartnerScreen` with `initialBusinessQuery` prefilled from the Assistant's
`businessName` — that param was already built into the screen before this pass, just unused
until now. Verified via a full `npx expo export --platform ios` (1842 modules, one more than
the 1841 baseline from the Part 2 commit — the one new `createAssistant.js` service file).
Committed and pushed (`d6225286`). **Not done yet, same standing gap as `ai-concierge`**: the
actual Anthropic call path was never exercised end-to-end — confirmed the function is live and
the gateway correctly 401s an unauthenticated request, but reaching the real classification
logic needs a signed-in session this sandbox can't mint. Also not done: no manual
simulator/device run-through of the new `CreateHubScreen` (all three cards, the NL box's
`gathering`/`community`/`business_partner`/`unclear` branches, and the `StartSomethingModal`
opening with the new fixed option set instead of the time-adaptive one).

**Overall status of this whole plan (Parts 1–3): DONE, build-wise.** Part 1 (schema) was
verified end-to-end against production in the commit that introduced it (`73f27539`). Parts 2
and 3 are described with their own status notes above. What's left across all three, gathered
in one place so it isn't scattered: a real simulator/device click-through (sending a
partnership request from all three entry points — Create tab, `GatheringDetailScreen`,
`CommunityDetailScreen` — approving/declining from `BusinessDashboardScreen`, and exercising
the Create Assistant's four intent branches with a real premium-less session), and confirming
the `create-assistant` Anthropic call itself succeeds end-to-end with real output shape once a
real session is available.

**Deliberately out of scope, flag rather than silently build**: a "Business AI Assistant"
(a chat-style analytics tool for business owners — "why did attendance drop," "create a
promotion") is a real, distinct future feature per the user's own 3-tier free/premium/
business breakdown discussed live, not attempted in this pass.

**Verification plan for this pass**: live-check the `hosting_partner_id` RLS question above
before writing the RPCs; apply the new migration to production
(`enmosvippabmuqslzrox`) via the Management API and verify end-to-end via
`set_config('request.jwt.claims', ...)` as real profiles (owner can request, duplicate
rejected, non-owner rejected, target business can approve/decline, non-owner of that
partner cannot, approve sets `hosting_partner_id`, decline doesn't) — clean up all test
state afterward, matching this session's established convention; deploy
`create-assistant` and confirm `verify_jwt: true` explicitly rather than assuming (the CLI
left `ai-concierge` on `false` by default on first deploy last time); full
`npx expo export --platform ios` after each meaningful increment, checking the module count
against the 1839 baseline. No manual simulator run-through is possible in this sandboxed
environment (standing limitation everywhere in this file) — flagged for next session same
as every other entry here.

## Aug 8 2026 — codespace restarts mid-session, work continued from a forwarded email

The user forwarded an email (sent from the prior Claude Code session, cut off mid-task by
hitting its session usage limit — visible in the email body as "You've hit your session
limit") containing feedback on a 5-tab IA (Home / Discover / Create / Inbox / Profile) checked
against a user-articulated "flywheel" vision. The email text was OCR-garbled from a
screenshot/email-client copy-paste, so **treat the email as a lead to re-verify against the
actual repo, not as ground truth** — same posture this file has always taken toward external
docs. Working tree was clean on restart (`git status` showed nothing uncommitted, nothing
lost) — the crashed session had only gotten as far as writing a task list, no files existed
yet. The 8-item task list visible in the email (from a `TaskList`-style dump) was: correct
CLAUDE.md about the invite system, build an invites schema + RPCs, add `services/invites.js`,
generalize `InviteFriendsModal` for gathering+community, plus 4 more truncated by the OCR.

Re-verified each claim in the email directly against the repo before building anything (per
this file's own long-standing rule):
- **"Invite people doesn't exist as a feature at all... this is the biggest real gap"** — 
  **partially wrong, and it's the same class of miss this file has now caught six separate
  times (Safety, AI Concierge, Business RPC ownership, Settings Business Mode, Consumer
  Billing, now this).** A real, working, already-deployed `invite_friend_to_gathering()`
  SECURITY DEFINER RPC exists in production — checks the invitee is an accepted friend, blocks
  a women-only gathering from inviting a non-woman, checks neither party has blocked the
  host, then sends a real push notification via `send-push` with
  `data: {type: 'gathering_invite', gathering_id}` (the exact push type
  `notifications.js`'s `case 'gathering_invite':` deep-link handler already exists for — that
  handler was flagged as dead code in the "Outstanding: Create Flow" section below; **that
  flag was wrong too**, corrected here). It's wired to a real 🤝 "Invite friends" button on
  two of `GatheringsScreen.js`'s three tabs (nearby, attending — not hosting) via
  `src/components/InviteFriendsModal.js`, which was sitting there the whole time under a name
  distinct from `InviteFriendsScreen.js`/`InviteFriends` route (that one's the app-referral-code
  screen — a third, unrelated "invite" name in this codebase, worth being careful about).
  **What's actually true and still missing**: this gathering-invite path (a) doesn't exist at
  all for **communities** — confirmed zero `Invite` references anywhere in
  `CommunityDetailScreen.js`/`CommunitiesScreen.js`, no RPC — a real, confirmed gap; (b) isn't
  reachable from the newer `GatheringDetailScreen.js` (only the older list-card `GatheringsScreen`
  tabs have it) or from the hosting tab; (c) is push-only/fire-and-forget with no persisted
  row anywhere, so there's no way to show "pending gathering invites" in Inbox even if you
  wanted to (only a tapped push can surface it, and if the push is missed/denied, the invite
  is simply gone).
- **"No 'Trending nearby' on Discover"** — confirmed true. `Trending` exists on `HomeScreen.js`
  and `GatheringsScreen.js`, not on `DiscoverHubScreen.js`.
- **"'Partner with a business' shown to everyone, not gated to organizers"** — confirmed true,
  read directly: `CreateHubScreen.js`'s "Partner With Us" row has no gating at all.
- **"Inbox 'Invitations' is mislabeled — shows friend requests"** — confirmed true, but with a
  nuance: `InboxScreen.js`'s "🤝 Invites" tab renders real `getPendingFriendRequests()` rows
  with honest per-row copy ("wants to be friends") — not fabricated or silently mislabeled at
  the row level, just a tab name broader than what it actually shows, and (per the point
  above) it has no way to show real gathering/community invites even though at least one of
  those (gatherings) already exists elsewhere in the app.
- **"No group/event chats surfaced in Inbox"** — confirmed true. `MatchesScreen.js` (Inbox's
  Messages tab) has zero references to gathering chat or community chat; both exist but are
  only reachable from deep inside `GatheringDetailScreen`/`GatheringHubScreen`/
  `CommunityDetailScreen`.
- **"Home community-updates section only shows one community"** — confirmed true:
  `HomeScreen.js`'s "🏘️ Continue Your Community" section (line ~175) surfaces a single
  community, not one per joined community.
- Not yet re-verified against the repo: "no invitations shown on Home" and "Create should
  become one screen across all communities" (the OCR text around these was too garbled to
  extract a concrete, checkable claim) — flagged here rather than silently acted on or
  silently dropped.

Given real gaps confirmed above, all six re-verified-true items were closed this pass — see
"Outstanding: Invite People" and the four bullets after it below. Committed and pushed after
each individual increment (not batched at the end), since this codespace was restarting
roughly every 15 minutes throughout — check git log for the granular sequence if picking this
up mid-way ever happens again.

- **Trending on Discover, gated "Partner With Us", Home's community-updates limit, and
  group-chat surfacing in Inbox — all closed this pass, each its own commit**:
  `DiscoverHubScreen.js` gained a "🔥 Trending Near You" section using the exact same signal
  Home's own trending already uses (top 3 gatherings by approved-attendee count, from the
  gathering list Discover already fetches for search — no new query).
  `CreateHubScreen.js`'s "Partner With Us" row is now gated on a real organizer signal (hosted
  a gathering, or leads/created a community via `community_members.role`) — hidden for a user
  with neither, and swapped to "🏪 Manage Your Business" → `BusinessDashboard` for an existing
  partner (same swap `SettingsScreen.js`'s Business Mode row already does), instead of showing
  the apply flow to literally everyone. `getContinueYourCommunity()` (Home's "🏘️ Continue Your
  Community") was hardcoded `.limit(1)` to the single most-recently-joined community regardless
  of how many the user belonged to — now `getContinueYourCommunities()`, fetching every joined
  community and ranking by real recent activity (unread message count in the last 24h), showing
  up to 3. `InboxScreen.js`'s Messages tab (`MatchesScreen`) had zero awareness of gathering or
  community group chats — both exist and work, just weren't reachable from Inbox at all — added
  a horizontal "Group Chats" chip row above the existing matches list (new lightweight
  `getMyGatheringChats()` in `gatherings.js` + the existing `getMyCommunities()`;
  `MatchesScreen.js` itself untouched, same "thin wrapper, don't risk the working internals"
  approach `InboxScreen.js` already uses for Messages/Activity).
- **Follow-up pass, same day**: "no invitations shown on Home" is now closed too — see the
  "Follow-up pass" bullet under "Outstanding: Invite People" below (Home gained a real pending-
  invites banner, and the Inbox tab badge itself was undercounting for the same reason).
  "Create should become one screen across all communities" is **still not re-verified** — the
  OCR text around it stayed too garbled to extract a concrete, checkable claim even on a second
  look. Flagged, not silently acted on or dropped.

## Aug 8 2026 — second restart, found and fixed a real block-check gap

Codespace restarted again (roughly the 15-minute cadence noted throughout this session).
`git status` was clean and `git log` matched `origin/main` exactly — nothing from the prior
pass was lost, everything through "Document the follow-up pass" (`6f4515f3`) was already
committed and pushed. Re-verified the two riskiest just-shipped pieces directly against
production (`enmosvippabmuqslzrox`) before doing anything new: `social_invites`/
`friend_circles`/`emergency_contacts`/`partner_contracts`/`business_invoices` tables all exist
live, and `invite_friend_to_gathering`'s deployed source matches the repo's migration exactly,
including the `social_invites` insert added in the prior follow-up pass.

While re-reading that function to confirm it, found a real, previously-uncaught bug of the
same shape as the "missing blocks check" bug already documented above:
`invite_friend_to_gathering` checks blocks between the gathering's **host** and the invitee,
but never between the **inviter** (`auth.uid()`) and the invitee — the exact check
`send_social_invite` already has correctly (`(blocker_id = auth.uid() and blocked_id =
invitee_id_param) or (blocker_id = invitee_id_param and blocked_id = auth.uid())`). Since
blocking someone doesn't remove an existing accepted friendship (confirmed live — no trigger
on `blocks` touches `friendships`), a user could still gathering-invite someone they've
blocked, or who has blocked them, as long as neither party had blocked the gathering's host —
the host-check alone doesn't cover the inviter/invitee relationship at all.

- Fixed in `20260808_gathering_invite_inviter_block_check.sql`: added the same
  auth.uid()-vs-invitee blocks check `send_social_invite` uses, ahead of the existing
  host-vs-invitee check (both now run; neither replaces the other — a host-blocked case and an
  inviter-blocked case are both real, independent reasons to reject). Applied directly to
  production via the Management API.
- **Verified live, not just applied**: confirmed `authenticated` retained execute (`anon` still
  correctly cannot) after the `CREATE OR REPLACE`. Using the two real non-test profiles that
  already had an accepted friendship in production (`Claude` / `Allen`), inserted a real block
  row (`Claude` blocked `Allen`), then called the function as `Claude` via
  `set_config('request.jwt.claims', ...)` inviting `Allen` to a real gathering **that `Allen`
  themselves hosts** — chosen specifically so the pre-existing host-check (host vs. invitee,
  same person here) couldn't mask whether the *new* check was doing anything. Got back
  `ERROR: This person cannot be invited`, confirming the new check fired. Deleted the test
  block row afterward and confirmed both `blocks` and `social_invites` were left exactly as
  before the test (the exception rolled back before the `social_invites` insert ever ran, so
  there was nothing to clean up there beyond the block row itself).
- **Not done yet**: same standing gap as the rest of this file — no manual run-through in a
  simulator/device. This was a pure backend/RPC-level fix (no client file touched), so there's
  no new UI surface to click through; next session should just confirm a real blocked pair
  still can't gathering-invite each other end-to-end through the actual `InviteFriendsModal` UI,
  not only via direct RPC calls.

## Aug 8 2026 — same session, found and fixed a systemic block-enforcement bug (`is_blocked`)

Asked to keep auditing after the fix above. Read `BusinessDashboardScreen.js` (open in the
user's editor) end to end looking for bugs in the newest, most-churned file, which led to
checking the CRM messaging path's RLS. Found that `business_messages` had **no blocks check at
all** on either INSERT policy ("Business owners can reply..." / "Followers can message a
business they follow") — unlike the plain `messages` table, whose own INSERT policy already
checks `not is_blocked(m.user_a, m.user_b)`. Wrote `20260808_business_messages_block_check.sql`
to add the same check to both policies, using the existing shared `is_blocked()` helper.

**While verifying that fix live, found something much bigger**: the test (a real block row,
then attempting the now-guarded INSERT as the blocked business owner) still went through —
the new check didn't fire. Root cause: `is_blocked(user_1, user_2)` is a plain SQL function,
not `SECURITY DEFINER`, so when it queries the `blocks` table it runs under the **calling
role's own RLS**, not a privileged bypass. `blocks`' own SELECT policy is `auth.uid() =
blocker_id` only (intentional elsewhere — the blocked party isn't supposed to be able to tell
they were blocked, e.g. `getMyBlockedUsers()` only ever lists blocks *the caller created*). Net
effect: whenever the **blocked party** (not the blocker) is the one performing the RLS-checked
action, `is_blocked()` silently returns `false`, because from their own session's point of
view the block row doesn't exist to select. This isn't specific to the new `business_messages`
policies — `is_blocked()` is referenced by **~10 policies total**: `matches` SELECT, `messages`
SELECT + INSERT, `notices` SELECT (×2), `sightings` SELECT, `shared_playlist_items` SELECT +
INSERT. Confirmed the real-world impact directly against production, not just theorized it:
using the same two real profiles as the fix above (`Claude` blocked `Allen`, a real pre-existing
match already existed between them from Jul 28), as `Allen` (the blocked party) `is_blocked(
Claude, Allen)` returned `false`, the blocked match was still fully visible in `Allen`'s own
`select * from matches`, and `Allen` could still successfully `INSERT` into `messages` for that
match — **a blocked user could still see and message the person who blocked them**, the exact
scenario the whole `blocks` feature exists to prevent.
- Fixed in `20260808_is_blocked_security_definer.sql`: made `is_blocked` `SECURITY DEFINER`
  (pinned `search_path`) so it sees the real `blocks` table regardless of which side of the
  block the caller is on. To avoid this becoming a *new* leak — an authenticated user directly
  RPC-calling `is_blocked(x, y)` to probe arbitrary pairs, including using it to detect "does
  this stranger have me blocked," which the app has never exposed anywhere — added an internal
  guard: it only ever returns a real answer when `auth.uid()` is one of the two supplied ids,
  `false` otherwise. Checked every one of the ~10 existing policy expressions first to confirm
  this is safe: every single one already independently requires `auth.uid()` = one of the same
  two ids via its own `AND` clause, so the guard changes nothing that was already working.
  Revoked `anon`/`public` execute (both had it before this fix, almost certainly just the
  default-privileges grant this file's own "Known conventions" section already warns about,
  not intentional), left `authenticated` only.
- **Verified live, exhaustively, not just theorized**: re-ran the exact prior failing
  `business_messages` insert as the blocked party — now correctly rejected. Directly compared
  `is_blocked()`'s answer for the same real pair from both sides (blocker: `true`, correctly
  unchanged; blocked party: `true`, was `false` before the fix) and confirmed the new guard
  returns `false` for a pair not involving the caller at all (tested `Allen` probing an
  unrelated third profile). Re-confirmed against the real `matches`/`messages` tables
  specifically (not just the new `business_messages` policies this session actually touched):
  while the test block was live, `Allen`'s own match list correctly dropped the blocked match
  (an unrelated second real match stayed visible, proving this wasn't a blanket empty-result
  bug), and `Allen`'s attempted `INSERT` into `messages` for that match was correctly rejected;
  removing the block made the match reappear. All test rows (`blocks`, `business_followers`,
  the one `business_messages` row that leaked through *before* the fix landed) deleted
  afterward — confirmed all three tables empty again, production back to its pre-test state.
- **Not done yet**: no manual run-through in a simulator/device (same standing gap as
  everywhere else in this file) — this was entirely a backend RLS/function fix, no client file
  touched. Next session should confirm in the running app: block someone you have a real
  match/conversation with, confirm their messages/match genuinely disappear from your own UI
  (not just via direct SQL), and confirm they can no longer send you a message or a business
  reply. Also worth a broader look at `notices`/`sightings`/`shared_playlist_items` in the
  running app, even though their `is_blocked()` usage was verified correct via the same shared
  fix — none of them were individually re-tested end-to-end the way `matches`/`messages` were.

## Aug 8 2026 — same session, found and fixed a critical admin self-escalation bug

Kept auditing after the two fixes above, per direct instruction. Went looking for the same
"missing column guard" class of bug systematically: `prevent_self_premium_edit()` (this file's
own "Known conventions" section: privileged `profiles` columns are protected by this trigger,
real writes must set `app.trusted_update`) has an explicit, hardcoded column whitelist —
checked every column on `profiles` against that whitelist rather than assuming it was complete.

**`is_admin` was not in the guarded list.** `profiles`' only UPDATE policy is `auth.uid() =
id` with no column-level restriction, so nothing besides this trigger stood between a normal
user and their own `is_admin` flag. **Verified live, carefully, on a real (genuinely
non-admin) profile**: called `update profiles set is_admin = true where id = <that profile>`
as that profile's own session — it succeeded, really setting `is_admin = true`. Reverted within
the same breath (a service-role `trusted_update` call back to `false`) before doing anything
else. This is the most severe finding of the whole session: full admin access (`AdminReportsScreen`,
`AdminBusinessRequests`, `AdminVerificationScreen`, every `is_admin`-gated RPC) was one client-side
`.update()` call away for any authenticated user. Grepped all of `src/` first to confirm zero
legitimate code path ever sets `is_admin` — it's meant to be granted by hand via the service
role only — so adding it to the guarded list has no risk of breaking a real flow.
- Fixed in `20260808_protect_is_admin_column.sql`: added `is_admin` to
  `prevent_self_premium_edit()`'s guarded-column list, identical shape to every other entry
  (`is_premium`, `managed_partner_id`, etc.) — silently reverts the client's attempted value
  back to `old.is_admin` unless `app.trusted_update` is set.
- **Verified live, both directions**: re-ran the exact same self-escalation attempt — the
  `UPDATE ... RETURNING` now comes back with `is_admin: false` even though the client asked for
  `true` (silently reverted, matching the established `is_premium` behavior, not an error).
  Separately confirmed the legitimate `trusted_update` path (how a real admin grant is meant to
  happen) still works unchanged.
- **While proving the live exploit, also found a second, separate, real bug** (not a security
  hole, a silently-broken feature): `AdminVerificationScreen.js`'s approve action tries to set
  `photo_verified = true` on the *submitter's* profile (`.eq('id', submission.user_id)`) — a
  different row than the reviewing admin's own. `profiles` has exactly one UPDATE policy
  (`auth.uid() = id`) and **no admin bypass for UPDATE at all** (only a SELECT bypass,
  `check_is_admin(auth.uid())`, exists). Verified live: granted a real profile `is_admin = true`
  via `trusted_update` (simulating a genuine admin session), then attempted that same cross-user
  update as that admin — it silently affected 0 rows (Supabase's `.update()` doesn't error on a
  no-op RLS-blocked write). **Net effect: approving an ID verification submission today marks
  the submission `approved` but never actually grants the user their verified badge** — a
  currently-broken safety/trust feature, not yet fixed. No real submissions exist in production
  yet (`id_verification_submissions` is empty) so this hasn't visibly bitten anyone, but it will
  the first time someone actually submits. Flagged here rather than fixed in the same pass —
  the correct fix is a new SECURITY DEFINER RPC (e.g. `admin_approve_id_verification`, checking
  `auth.uid()`'s own `is_admin` internally) doing both the submission-status update and the
  target's `photo_verified` update atomically, matching this codebase's established
  admin-action-via-RPC pattern, rather than opening a broad admin bypass UPDATE policy on all of
  `profiles`. **Fixed later this same pass, see below.**
- **Also found, not yet fixed, lower severity**: `bonus_notices` (a real, spendable resource —
  see `noticeLimits.js`/`referrals.js`) is written directly from client-side JS in both the
  spend path (`noticeLimits.js`) and the earn path (`referrals.js`'s +3 on a valid referral),
  neither wrapped in `trusted_update`. Since it's also absent from the same guarded-column list,
  a user could set their own `bonus_notices` to an arbitrary number directly, bypassing the real
  `referral_redemptions`-gated earn flow entirely — a currency exploit, not a privilege
  escalation. Not fixed this pass because, unlike `is_admin`, this one **does** have legitimate
  client-side writers — naively adding it to the trigger's guard list would silently break the
  real spend/earn flows too; the correct fix needs those two call sites converted to SECURITY
  DEFINER RPCs (or wrapped in `trusted_update` some other safe way) at the same time as the
  column gets protected, not attempted in this same pass to avoid shipping a half-done fix.
- **Broken admin verification approval — fixed later this same pass**: new
  `admin_approve_id_verification(submission_id, approved)` SECURITY DEFINER RPC
  (`20260808_admin_approve_id_verification.sql`) does both writes atomically — checks
  `auth.uid()`'s own `is_admin` first (raises if not), updates
  `id_verification_submissions.status`/`reviewed_at`/`reviewed_by` (guarded by `status =
  'pending'` so a submission can't be double-reviewed), then on approval sets
  `app.trusted_update` and writes the submitter's `profiles.photo_verified = true`.
  `AdminVerificationScreen.js`'s `handleDecision()` now calls this RPC instead of the two raw
  table writes. **Verified live and end-to-end for real** (not just the RLS-block proof from
  the finding above): created a real pending submission for one real profile, called the RPC as
  the other real profile (Allen — genuinely `is_admin = true` in production, not a test flag) —
  the submission correctly flipped to `approved` with real `reviewed_by`/`reviewed_at`, and the
  submitter's `photo_verified` correctly flipped to `true` in the same call. Separately
  confirmed a true non-admin calling the RPC is rejected (`Only admins can review verification
  submissions`), and that re-approving an already-reviewed submission is rejected (`Submission
  not found or already reviewed`). All test submissions deleted and the test profile's
  `photo_verified` reset to `false` afterward. Verified via a full `npx expo export --platform
  ios` (1839 modules, unchanged — an edit to an existing screen, no new client files).
- **`bonus_notices` self-edit exploit — fixed in a follow-up pass after a codespace restart.**
  The codespace restarted mid-fix; on restart, `git status` showed a clean working tree except
  one untracked, already-fully-written file — `20260808_protect_bonus_notices.sql` — matching
  exactly the fix this file had flagged as deliberately deferred. The migration itself was
  complete (both RPCs, both trigger-guard additions) but had never been applied to production,
  and `noticeLimits.js`/`referrals.js` still had their original direct-write client code, so the
  guard alone would have silently broken the real spend/earn flows had it been applied without
  the client change — exactly the risk the original deferral was written to avoid. Finished the
  other half and applied: `checkNoticeLimit()` in `noticeLimits.js` now calls
  `supabase.rpc('spend_bonus_notice')` instead of a client read-then-write; `redeemReferralCode()`
  in `referrals.js` is now a thin wrapper around `supabase.rpc('grant_referral_bonus', {
  code_param })`, collapsing five separate client round-trips (lookup, insert, two profile
  updates split across two read-then-write pairs) into one atomic server-side call — also
  closes a real read-then-write race the old code had (two concurrent redemptions could both
  read the same `bonus_notices` count before either wrote it back). `redeemReferralCode`'s now-
  unused `newUserId` param was dropped and its one caller (`InviteFriendsScreen.js`) updated to
  match, since the RPC reads `auth.uid()` server-side instead.
  Applied `20260808_protect_bonus_notices.sql` to production (`enmosvippabmuqslzrox`) via the
  Management API. **Verified live end-to-end, not just applied**: confirmed both new functions
  are `SECURITY DEFINER` with `authenticated`-only execute (`anon` correctly excluded); as the
  real profile `Claude` (3 real bonus notices at the time), called `spend_bonus_notice()` and
  confirmed a genuine decrement to 2; immediately after, attempted the exact old exploit — a
  direct `update profiles set bonus_notices = 9999` as that same session — and confirmed it was
  silently reverted to 2, matching the established `is_premium`/`is_admin` guarded-column
  behavior; confirmed `spend_bonus_notice()` correctly returns `false` (no-op) for a real
  profile already at 0. For `grant_referral_bonus`, confirmed a self-referral attempt is
  rejected (`You can't use your own referral code`), confirmed a second redemption attempt by
  an already-referred real profile correctly hits the pre-existing `23505` unique-violation
  anti-fraud gate, and ran one genuine new redemption end-to-end (a real never-referred profile
  redeeming a real referrer's code) — confirmed both sides' `bonus_notices` incremented by 3 and
  `referred_by` was set correctly on the referred profile. All test state (the one new
  redemption, both profiles' `bonus_notices`, `Claude`'s spent notice) reverted afterward via
  `trusted_update` back to exactly its pre-test values — confirmed via a final read that
  production matches its pre-test snapshot. Verified via a full `npx expo export --platform
  ios` (1839 modules, unchanged — edits to existing files only, no new client files).
- **Not done yet**: no manual run-through in a simulator/device for either this fix or the
  admin-verification RPC wiring above — next session should click through `AdminVerificationScreen`
  as a real admin account with a real pending submission and confirm approve/reject behave
  correctly in the UI, and separately confirm in the real app that spending a Notice via a
  bonus (not the daily free allotment) still decrements correctly and that redeeming a referral
  code in `InviteFriendsScreen` still shows its existing "You've both received 3 bonus Notices"
  success alert — not just via direct RPC calls.

## Outstanding: Invite People (gathering + community)

Scope, per the correction above: gatherings already had a real invite mechanism
(`invite_friend_to_gathering` + `InviteFriendsModal`, on `GatheringsScreen.js`'s nearby/
attending tabs) — left that mechanism in place rather than replacing it, since it already has
women-only and blocks safety checks a naive rebuild would have to duplicate exactly to stay as
safe. New work targeted what was actually missing: community invites, a persisted (not
push-only) invite record so Inbox can list something real, and reaching
`GatheringDetailScreen`/`CommunityDetailScreen` where no invite entry point existed at all.

- **New `social_invites` table** (`20260808_social_invites.sql`, applied to production and
  verified live via `set_config('request.jwt.claims', ...)` as real profile rows — friend
  invite succeeds, non-friend invite rejected, only the real invitee can respond, double-respond
  rejected, all test rows cleaned up after): one polymorphic table (`invite_type`:
  `'gathering' | 'community'`, `target_id`) rather than two separate tables, since both shapes
  are identical and a single Inbox list needs to read both without a union query. Two SECURITY
  DEFINER RPCs, `send_social_invite`/`respond_to_social_invite`, matching this codebase's
  established "no direct client INSERT/UPDATE, real checks inside the function" pattern (e.g.
  `set_community_member_role`). `send_social_invite` initially shipped **without** a blocks
  check — caught by comparing against `invite_friend_to_gathering`'s own blocks check right
  after finding that function existed, fixed same-session in
  `20260808_social_invites_block_check.sql`, verified live (a blocked pair's invite is now
  rejected) — every other invite-adjacent write in this codebase (`sendFriendRequest`,
  `invite_friend_to_gathering`) already checked blocks; this one initially didn't.
  Friends-only enforcement (same "no stalking vector" reasoning as Discover's unified search
  deliberately excluding People) applies to both invite types, even though communities have no
  women-only concept to also check.
- **`src/services/invites.js`**: `sendInvite`/`respondToInvite` (thin RPC wrappers),
  `getMyReceivedInvites()` — fetches pending `social_invites` for the caller, then two batched
  follow-up queries (gatherings/communities by id) to resolve real target titles, since
  `social_invites` deliberately doesn't denormalize a copy of the title onto the row.
- **`InviteFriendsModal.js` generalized**: now accepts `inviteType`/`targetId`/`targetTitle`
  alongside its original `gatheringId`/`gatheringTitle` props (kept working byte-for-byte
  unchanged for `GatheringsScreen.js`'s existing usage — `gatheringId` truthy still means
  gathering, still calls `invite_friend_to_gathering`). Community invites go through the new
  `sendInvite('community', ...)`.
- **Entry points added**: `GatheringDetailScreen.js` gained a "🤝 Invite friends" link in both
  the host banner and the post-join "You're in!" panel (previously had none at all — only the
  older `GatheringsScreen` list-card tabs did). `CommunityDetailScreen.js` gained an "🤝 Invite
  Friends" button for members/creator, next to the existing Community Chat button (communities
  had zero invite mechanism before this).
- **`InboxScreen.js`'s Invites tab wired up**: now shows a combined list — real friend
  requests (unchanged) plus real pending `social_invites` rows from `getMyReceivedInvites()`,
  each tagged by `kind` and rendered accordingly. Social invites get Accept/Decline (friend
  requests stay Accept-only, matching the original); accepting deep-links straight into
  `GatheringDetail`/`CommunityDetail` via `respond_to_social_invite` + navigation. The tab's
  badge count and empty-state copy were updated to reflect both sources honestly.
- Verified via a full `npx expo export --platform ios` after every single increment in this
  pass (1839 modules throughout, one more than the prior 1838 Billing-pass baseline — only
  `invites.js` is a new module; every other file touched in this pass was an edit, not an
  addition, so the count held steady across all of them).
- **Follow-up pass, same day**: the "deliberately not attempted" gap above (gathering invites
  not persisting into `social_invites`, only ever a fire-and-forget push) was closed —
  `invite_friend_to_gathering` now also inserts a real `social_invites` row (`ON CONFLICT DO
  NOTHING` against the same partial unique index `send_social_invite` uses), same function,
  same friends/women-only/blocks checks, unchanged. Verified live: grants survived the
  `CREATE OR REPLACE`, and a real invite call now produces a real pending row. Both invite
  paths now show up in Inbox's Invites tab identically.
- **Also found and fixed while following up**: `getInboxUnreadCount()` (the function behind the
  Inbox tab's badge number) only ever summed unread messages + new notices — it never counted
  pending gathering-join requests, pending friend requests, or pending invites, so the badge
  undercounted what Inbox actually had waiting. Factored the three pending counts into a new
  `getPendingInvitesCount()`, used by both the badge and a new "🤝 N pending invites & requests"
  banner on `HomeScreen.js` (same visual pattern as the existing perks banner) — this also
  closes the vision-doc email's "no invitations shown on Home" claim, which the first pass
  through this file had flagged as unverifiable due to OCR garbling. `InboxScreen.js` gained an
  `initialSection` route param so the banner can deep-link straight to the Invites tab (needed
  because the tab navigator keeps `InboxScreen` mounted, so a plain `useState` initial value
  wouldn't see a fresh navigation's param on an already-visited tab).
- **Not done yet**: no manual run-through in a simulator/device for any of the invite work, the
  Trending/Partner-gating/Home-communities/Inbox-group-chats fixes above, or the follow-up pass,
  beyond the direct SQL verification already run against production. Next session should click
  through: sending a gathering invite from `GatheringDetailScreen` and a community invite from
  `CommunityDetailScreen` as two real friended accounts, confirming both now show up correctly
  in the recipient's Inbox Invites tab and in the Home banner/tab badge count, accepting a
  community invite and confirming it deep-links into the right `CommunityDetail`, the new
  Trending section on Discover, "Partner With Us" visibility for an organizer vs. a non-
  organizer account, Home showing multiple communities for a multi-community account, and the
  Group Chats row in Inbox for an account with real upcoming gatherings and communities.

## Known gaps against the Aug 7 2026 external roadmap doc

The user pasted an external 16-item roadmap doc (plus a "Phase 5 (Magic)" wishlist) on
Aug 7 2026 prioritizing remaining screen work. Checked against actual repo state that same day.
Discover (item 1) was closed that session — see the section below. The rest, so nothing here
gets silently forgotten:

**Confirmed NOT built** (checked directly — grepped for it, found nothing, or the screen
exists but doesn't do the thing):
- **Unified Map Experience** (#10) — **closed this session as far as it honestly can be, see
  "Outstanding: Unified Map" below** — real businesses and a live-activity layer were added;
  people and communities were deliberately not, for reasons documented there.
- **Insights** (#13) — **closed this session, see "Outstanding: Insights screen" below.**
- **Safety — emergency contact + check-in** (#15) — **closed this session, see "Outstanding:
  Emergency Contacts" below — and the original audit line here was partly wrong, worth
  flagging.** It grepped for `emergency_contact`/`EmergencyContact`/`safetyCheckIn` and found
  nothing, concluding the whole check-in flow didn't exist. In fact a full "Date Safety
  Check-In" flow already existed under different names — `date_checkins` table,
  `services/dateSafety.js` (`createCheckIn`/`buildShareMessage`/local scheduled reminder via
  `expo-notifications`), `DateCheckInModal.js` (also live-location-sharing and one-tap
  location-snapshot sharing via `expo-location`), wired from `ChatScreen.js` and surfaced back
  in `MatchesScreen.js` as a post-date "are you safe?" prompt. Same class of mistake this file's
  own Discover section already warned about — a literal-string grep for the wrong name can miss
  a real, already-built feature. The one genuinely missing piece was a persistent, reusable
  emergency contact (name/phone/relationship) instead of picking a share recipient fresh every
  time — that's what got built.
- **AI Concierge** (Phase 5) — **closed this session, see "Outstanding: AI Concierge" below —
  and the premise in this line was wrong, worth flagging.** This line previously claimed no
  natural-language flow existed anywhere and that Concierge "would be this codebase's first
  real LLM call." **That was false.** Checking local `src/` for LLM usage was accurate (Home's
  `getHomeInsight()`, Discover's "Recommended for you" genuinely are real-signal heuristics,
  no LLM), but the check never looked at what's actually *deployed* on Supabase — the local
  `supabase/functions/*/index.ts` files are all empty stubs (a pre-existing gap in this repo's
  own practices, not something introduced this session), so a from-source grep found nothing
  while production silently had 17 real deployed Edge Functions, at least 6 of them genuine
  Claude API calls already wired to real screens: `generate-icebreaker` (`ChatScreen.js`),
  `generate-strengths` (`ProfileScreen.js`), `generate-courage-message`/`translate-message`
  (`ChatScreen.js`), `generate-introduction` (`CompatibilityReportModal.js`), `rehearsal-chat`
  (`RehearsalRoomScreen.js`) — plus a live `ANTHROPIC_API_KEY` secret already configured. Same
  class of miss this file has now caught three separate times (Safety/emergency-contacts,
  Business Profile network calls, and now this) — always verify against what's actually live,
  not just what's checked into git, before concluding a capability doesn't exist.
- **Friend Circles** (Phase 5) — **closed this session, see "Outstanding: Friend Circles"
  below.** `FriendsScreen.js` was a flat friends list with no grouping concept (Work/Fitness/
  Family/Travel) anywhere in the schema or UI.
- **Momentum** (Phase 5) — **closed this session, see "Outstanding: Momentum" below.** No
  "social momentum" signal/screen existed anywhere.
- **Empty-state audit** — **done this session, see "Outstanding: Empty-state audit" below.**

**Verified in a follow-up audit pass (Aug 7 2026, same day, after the initial doc check) — all
seven previously-unconfirmed items now checked, none left unverified**:
- **Community Screen** (#7) — **real gap, closed later this same session — see the section
  below.** `CommunityDetailScreen.js` only tracks a boolean `isCreator` to hide the Join button
  (lines 17, 29) — no members list, no leader/admin badge UI anywhere, even though
  `community_members.role` (`services/communities.js:37`) already stores `'creator'` per member
  (the data exists, the screen just never queries/renders it as a list). "Upcoming Gatherings"
  (lines 144-153) is a flat filtered/sorted list, not a calendar/month-grid view. Both Leaders
  and Calendar are genuinely absent, not just unaudited.
- **Business Profile** (#9) — **real gap, closed later this same session — see the "Outstanding:
  Business Profile" section below.** Traced every tap target that names a business:
  `BrandOffersScreen.js:142` partner name is plain non-tappable `Text`; the only nearby button
  goes to `BusinessConversation` (private chat), not a profile.
  `GatheringDetailScreen.js:295-299`'s Community Perk card shows the partner name as plain
  text too. `BusinessHostBadge.js:26-29` ("🏪 Hosted by {partnerName}") is a static `View` with
  no `onPress` at all. `RootNavigator.js` has no `BusinessProfile`/`PartnerProfile` route —
  only `BusinessDashboard` (owner-only), `BusinessPartnerApply`, `AdminBusinessRequests`,
  `BusinessConversation`. Zero path from any business name to a public profile of that
  business currently exists anywhere in the app.
- **Business Community CRM** (#12) — **partial gap.** Richer than "unconfirmed" suggested:
  `BusinessDashboardScreen.js` has real aggregate analytics — `get_business_dashboard_stats`
  (followers/redemptions + month-over-month via `get_business_growth`, lines 332-370),
  `get_gathering_attendee_breakdown` (new vs. returning attendees per gathering, 117-123/
  430-434), a "Most Engaged" top-members leaderboard via `getBusinessTopMembers` (455-465),
  and `getBusinessVisitFrequency`/top-interests insights (469-494) — all real RPCs, not
  placeholders. What's missing for true CRM depth: the "Most Engaged" rows are static, no
  drill-in to an individual customer's visit history or contact info, and outreach is limited
  to one broadcast "Post Update to Followers" — no per-customer CRM record or targeted
  outreach tool.
- **Rewards** (#11) — **closed this session, see "Outstanding: Rewards" below.** The original
  audit here (grepping for `loyalt|reward.?point|tier|streak|unlock|threshold`, all unrelated
  hits) was accurate — confirmed again via a dedicated research pass before building — zero
  loyalty/points/tier/group-unlock mechanics existed anywhere.
- **Settings** (#16) — **Payments: still a partial gap. Business Mode: the original audit line
  was wrong — closed this session, see "Outstanding: Settings Business Mode link" below.** Real
  sections confirmed in `SettingsScreen.js`: Looking For, Appearance, Language, Notifications,
  Privacy, Discovery Preferences, Account, Connect, Safety, Reflection Tools, Account & Billing,
  Help & Legal. "Account & Billing" (line 814) has exactly one row — "Manage Subscription" →
  `Paywall` — no payment-methods list or billing-history/receipts UI, still a real gap. The
  "no personal/business toggle exists at all" claim was **false** — `ProfileScreen.js:510-520`
  already had a real, fully-wired "🏪 Switch to Business" button (gated on
  `profiles.managed_partner_id`, added `git log`-confirmed **Jul 31 2026, a week before this
  Aug 7 audit**), navigating to `BusinessDashboard`, which itself loads via the caller's own
  `getMyManagedPartner()` — not gated on admin status internally. The audit only ever checked
  `SettingsScreen.js` and never grepped `ProfileScreen.js`, same class of miss this file has now
  caught four separate times (Safety, AI Concierge, Business RPC ownership, now this).
- **Profile** (#5) — **closed this session, see "Outstanding: Memory Vault → Profile link"
  below.** `ProfileScreen.js:432-437` has a real, prominent "📖 View Your Timeline" button
  (`navigation.navigate('Timeline')`) — Timeline is one tap from Profile, satisfies the doc.
  Memory Vault was not linked from Profile at all before this pass — it was only reachable from
  `ChatScreen.js:427` as a per-match "💫 Memory Vault" option, i.e. a per-conversation feature,
  not a profile sub-section. Everything else about Profile already matched the doc — quick-stats
  row, earned stats, achievements grid, photo gallery, prompts, connection-goal chips, full
  identity fields — all real, DB-backed, no placeholders.
- **People Profile** (#8) — **matches doc intent.** `ViewProfileScreen.js` is genuinely
  compatibility/vibe-oriented: a real compatibility %/report (`generateCompatibilityReport()`
  in `services/compatibility.js`, explicitly disabled for friends — "a dating-style
  compatibility score doesn't make sense for a friend's profile"), host stats/reputation via
  the same `get_host_stats`/`get_host_reputation` RPCs used elsewhere, mutual friends, shared
  music/interests. No follower/following counts, no feed layout — nothing resembling a
  generic social-network profile. No fabricated numbers found.

## Outstanding: Consumer Billing screen (closes remainder of roadmap #16 Payments)

Closed the last real piece of roadmap #16: `SettingsScreen.js`'s "Account & Billing" section
had exactly one row ("Manage Subscription" → `Paywall`), with "no payment-methods list or
billing-history/receipts UI" — flagged as a real gap in the Settings audit above and again in
the "Outstanding: Billing / Monetization" section further below (that section is the
**business/partner** side — contracts, invoices, Stripe-not-started — this is the unrelated
**consumer subscription** side, i.e. what a regular user sees about their own Premium plan).

- **Before building anything, checked whether `profiles.is_premium` was even reliable, since a
  local grep found `purchases.js`'s `purchasePackage`/`isPremium`/`restorePurchases` only ever
  read/write RevenueCat's own client-side entitlement state and never touch Supabase at all —
  which would mean a real paying customer's `profiles.is_premium` (the column every actual
  server-side gate reads, e.g. `ai-concierge`'s premium check, the two RLS policies in
  `schema.sql`) could stay permanently `false` even after a successful purchase. **This turned
  out to already be solved**, just not visible locally — same class of miss this file has now
  flagged five separate times (Safety, AI Concierge, Business RPC ownership, Settings Business
  Mode, now this): production already has a `set_premium_status(user_id, new_status)` SECURITY
  DEFINER RPC (granted only to `service_role`/`postgres`, confirmed via the Management API) and
  an already-deployed, active `revenuecat-webhook` Edge Function (`verify_jwt: false`, since
  RevenueCat calls it directly rather than as a user — authenticated instead via a
  `REVENUECAT_WEBHOOK_SECRET` Supabase secret checked against the request's `Authorization`
  header) that correctly maps real RevenueCat webhook events to `is_premium`: grants on
  `INITIAL_PURCHASE`/`RENEWAL`/`UNCANCELLATION`/`NON_RENEWING_PURCHASE`/`PRODUCT_CHANGE`,
  revokes only on `EXPIRATION` (correctly *not* on bare `CANCELLATION`, since a cancelled
  subscriber keeps access until the paid period actually runs out). Neither this RPC nor this
  function exist in local `supabase/schema.sql` or `supabase/functions/` — pulled the real
  source via the Management API's function-body endpoint, same technique used to recover the
  other "empty local stub, real deployed code" functions noted elsewhere in this file. No
  backend work was needed here; this was purely a verification pass that de-risked building UI
  on top of `is_premium` at all.
- New `getSubscriptionDetails()` / `openSubscriptionManagement()` in `src/services/purchases.js`
  — real fields straight off RevenueCat's own `CustomerInfo`/active-entitlement object (active
  status, `store`, `willRenew`, `latestPurchaseDate`, `expirationDate`, `isSandbox`,
  top-level `managementURL`), nothing invented. `openSubscriptionManagement()` prefers
  RevenueCat's own `managementURL` (correct even for non-App-Store/Play-Store cases) and only
  falls back to the plain per-platform subscriptions-page URL `PaywallScreen.js` already used
  when RevenueCat doesn't have one. `PaywallScreen.js`'s own local, now-duplicate
  `openNativeSubscriptionManagement` helper was pointed at this shared function instead of
  keeping a second copy of the same fallback URLs.
- New `src/screens/BillingScreen.js` + `Billing` route (`RootNavigator.js`, same
  `headerShown`/title/style convention as `Rewards`/`Momentum`/`EmergencyContacts`).
  `SettingsScreen.js`'s "Manage Subscription" row now opens this instead of jumping straight to
  `Paywall` — free users still land on a real "Upgrade to Premium" CTA → `Paywall` from here (no
  behavior lost), Premium users instead see real plan detail (since-date, renews/ends date with
  honest "auto-renew is off" wording when `willRenew` is false, which store it's billed through,
  a sandbox/test-purchase flag when applicable) plus working "Manage Subscription" and "Restore
  Purchases" actions.
- **Payment Methods / Billing History — deliberately not built as a data list**, same
  "don't fabricate" convention as the Emergency Contacts and business-billing sections
  elsewhere in this file: this app bills through native in-app-purchase (RevenueCat wrapping
  StoreKit/Play Billing), so Apple/Google hold the actual card and the actual itemized charge
  history — this app never receives either. `BillingScreen` says so plainly in both sections
  and points at the real store subscription page instead of inventing local receipt rows.
- Verified via a full `npx expo export --platform ios` (1838 modules, one more than the prior
  1837 baseline — the new `BillingScreen.js`, everything else is edits to existing files).
- **Not done yet**: no manual run-through in a simulator/device, and specifically — same
  limitation already noted under AI Concierge — this sandbox has no real signed-in premium
  account to exercise the "already Premium" branch against, so the active-subscription
  rendering (dates, store label, manage/restore buttons) is verified by reading the code against
  RevenueCat's real SDK shape, not by an actual live purchase. Next session should check: a free
  account sees "Free plan" + "Upgrade to Premium" → `Paywall`, a real Premium account sees
  correct real dates/store/renewal wording, "Manage Subscription" actually opens the right store
  page, and "Restore Purchases" round-trips correctly on both iOS and Android.

## Outstanding: AI Concierge (closes Phase 5 "AI Concierge" gap)

Closed against the confirmed real gap (a natural-language "find me something tonight" flow),
but built on a corrected premise — see the audit correction above. Discussed the design with
the user first rather than silently bolting this on, since it's the first *new* LLM feature
added this session (even though it turned out not to be the codebase's first ever). Deployed
to production (`enmosvippabmuqslzrox`) and applied there, not just written locally.

- **Found and fixed a live security bug while researching the existing AI pattern**, before
  building anything new on top of it: `check_and_increment_ai_use(user_id_param, daily_limit)`
  — the shared SECURITY DEFINER rate-limit RPC every `generate-*` Edge Function already calls —
  was granted `EXECUTE` to the broad `authenticated` role with no check that the caller owned
  `user_id_param`. Any logged-in user could call it directly with another user's id and burn
  through that account's shared daily AI-use counter (`profiles.ai_uses_today`) — a denial-of-
  service against another user's AI features, not a data leak. Same class of bug as the
  business RPC ownership section above. Fixed in `20260807_ai_use_ownership_check.sql`: added
  an internal `auth.uid() = user_id_param` check (returns `false` rather than raising, matching
  this codebase's "just don't allow it" convention) and revoked `authenticated`/`anon`/`public`
  execute, granting only `service_role` — the only real caller, since every existing
  `generate-*` function invokes it via a service-role admin client, never the user's own
  session. Verified live: re-ran the exact call as a different real profile via
  `set_config('request.jwt.claims', ...)` and confirmed it's now rejected at the grant level
  (`permission denied for function`) before even reaching the new internal check, and confirmed
  a service-role-style call (no JWT claims) still succeeds — the legitimate path is unaffected.
- **New `supabase/functions/ai-concierge/index.ts`**, matching the exact pattern every existing
  `generate-*` function already uses in production (extracted by pulling their real deployed
  source via the Management API's function-body endpoint, since the local stub files are
  empty): verify the bearer token via a service-role `auth.getUser()` call, gate on
  `profiles.is_premium` (matching `generate-icebreaker`/`generate-strengths`/
  `generate-courage-message` — 3 of 4 comparable single-shot "generate something for me"
  features are Premium-gated; only `generate-introduction`, feeding a core compatibility
  report, is not — Concierge fits the majority pattern), call `check_and_increment_ai_use`
  with `daily_limit: 50` (matching the single-shot-feature convention, not the higher 150 used
  by per-message features like `translate-message`/`rehearsal-chat` — this is one shared
  counter across every AI feature, not a per-feature budget, so the number had to match
  existing precedent rather than being invented), then call `claude-haiku-4-5-20251001` (same
  model every other function already uses) with `max_tokens: 600`. Deployed via
  `supabase functions deploy` and confirmed live with `verify_jwt: true` (matching every other
  function — the CLI's default deploy left it `false` on first push; caught by checking the
  live function's settings afterward instead of assuming the deploy command's defaults matched
  convention, corrected via a follow-up Management API `PATCH`).
- **Prompt-injection handling — a real design discussion with the user, not a unilateral
  choice**: gathering/community/perk titles are user-generated text, and this feature (unlike
  the existing `generate-*` functions, which only ever process the *caller's own* profile data)
  processes content written by *other* users, which the requesting user doesn't control. Talked
  through two options: (a) constrain the model to picking ids only, with reason text assembled
  from real signals server/client-side (zero new attack surface, since the model would never
  author displayed text), vs (b) freeform model-written reason sentences (more natural, but the
  model's raw output becomes on-screen text). **User chose (b)** after the tradeoff was
  clarified. Mitigations actually built: only structured, low-risk fields (id/type/title/
  category/time/distance) are ever sent to the model — full descriptions (the richest
  injection vector) are deliberately excluded from the prompt entirely, never sent by the
  client in the first place; all untrusted data is wrapped in explicit `<candidate_data>`/
  `<user_request>` tags with the system prompt stating plainly that content inside is data to
  describe, never instructions to follow; every returned id is re-validated against the real
  candidate set server-side before it's ever returned to the client (an id the model invents or
  hallucinates is silently dropped); every reason string is hard length-capped
  (`MAX_REASON_LENGTH = 220`) regardless of what the model actually returned. **Residual risk,
  stated honestly rather than claimed solved**: this delimiting reduces but doesn't eliminate
  injection risk from candidate titles — a sufficiently crafted gathering title could still
  influence a displayed reason sentence. What meaningfully caps the real-world severity: this
  is React Native, not a webview — `<Text>` renders plain strings with no HTML/script
  execution, so the actual worst case of a successful injection is a misleading sentence
  attributed to the Concierge, never code execution or an unauthorized action (the model has no
  write access or action-triggering capability in this design regardless of prompt content).
- **New `src/services/aiConcierge.js`** (`askConcierge(queryText, location)`) — reuses the same
  already-fetched Discover data sources (`getNearbyGatherings('wide')`, `getPublicCommunities()`,
  `getActiveOffers()`, the same three functions `DiscoverHubScreen.js` already calls) rather
  than new queries, builds the trimmed candidate list client-side, and maps returned picks back
  to the full local objects (so rendering still has real descriptions/photos/etc. — only the
  *prompt* excludes them, not the client's own data). **New `src/screens/AIConciergeScreen.js`**
  + `AIConcierge` route (`RootNavigator.js`) — a single text box, four example-query suggestion
  chips, and a results list (type icon, title, the model's real reason sentence, tap-through to
  `GatheringDetail`/`CommunityDetail`/`BrandOffers`). Reachable from a new "✨ Ask AI Concierge
  what to do" row on `DiscoverHubScreen.js`, directly under its existing search bar. A genuine
  "nothing fit" empty state is shown when the model legitimately returns zero picks, rather
  than hidden or defaulted to something.
- **Not done yet / known verification gap, stated plainly**: unlike every other feature closed
  this session, **the actual Anthropic call path was not exercised end-to-end** — confirmed the
  Edge Function is deployed and its gateway-level `verify_jwt` correctly rejects missing/invalid
  auth (tested directly via `curl`), and confirmed the underlying `check_and_increment_ai_use`
  RPC logic works correctly against real profile rows, but reaching the actual premium-gated
  Anthropic-calling code path requires a real premium user's live session access token, which
  this sandboxed environment has no way to mint (no stored password/credentials for any real
  account; the project's own `review-login` mechanism needs a PIN secret whose plaintext isn't
  retrievable via the Management API). Confidence here rests on matching the already-proven-
  in-production `generate-icebreaker` pattern line-for-line, not on a direct test of this
  specific function's success path. Next session should: run the app as a real Premium account,
  ask the Concierge something with real gatherings/communities/perks nearby, confirm real picks
  with sensible reasons come back and tap-through navigation lands correctly; ask as a
  non-Premium account and confirm the "This is a Premium feature." message surfaces cleanly;
  and confirm hitting the shared daily AI-use cap surfaces the 429 message correctly instead of
  a raw error.

## Outstanding: Settings Business Mode link (closes roadmap #16 Business Mode half)

The real "personal ↔ business" switch already existed before this session (`ProfileScreen.js`'s
"🏪 Switch to Business" button, `managesBusiness` gated on `profiles.managed_partner_id`) — the
roadmap audit's claim that no toggle existed at all was wrong, corrected above. What was
actually missing, confirmed by reading `SettingsScreen.js` directly: its own Business Dashboard
row was gated on `isAdmin` only, with zero awareness of `managed_partner_id` — a non-admin
business owner had no path into their dashboard from Settings at all (Profile was their only
way in), and the "Partner With Us" row always showed the application flow even to someone
who's already an approved partner.

- `SettingsScreen.js` now loads `managed_partner_id` from the same already-fetched `profiles`
  row (`select('*')` at line 80 already returned it — just wasn't read into state) into a new
  `managesBusiness` boolean, mirroring `ProfileScreen.js`'s own naming/pattern exactly.
- The "Partner With Us" row now conditionally renders as "🏪 Manage Your Business" →
  `BusinessDashboard` when `managesBusiness` is true, falling back to the original "Partner With
  Us" → `BusinessPartnerApply` application flow otherwise — so an existing partner is never
  shown an "apply to become a partner" prompt for a business they already run.
  The existing `isAdmin`-gated "Business Dashboard (Admin)" row was left untouched (an admin who
  also happens to manage a business will now see both rows — a minor, acceptable overlap, not a
  new bug — the admin row's own purpose was never about the caller's own business specifically).
- Verified via a babel compile of the touched file and a full `npx expo export --platform ios`
  (1837 modules, unchanged — an edit to an existing file, no new files this pass).
- **Not done yet**: no manual run-through in a simulator/device. Next session should check: a
  regular user sees "Partner With Us" as before, an approved business owner sees "🏪 Manage Your
  Business" and it correctly opens their own dashboard, and an admin who is also a business
  owner sees both rows without confusion.

## Outstanding: Rewards (closes roadmap #11)

Closed against the confirmed real gap: zero loyalty/points/tier or group-unlock mechanics
existed anywhere (re-confirmed via a dedicated research pass before building, not just reused
from the original audit). Design was discussed with the user first — three real decisions
(what earns points, what a tier unlocks, which entities can gate group-unlock) were resolved
before writing any schema, same practice as AI Concierge's prompt-injection discussion above.
Applied to production (`enmosvippabmuqslzrox`) and verified live end-to-end before committing —
not just a schema-shape check.

- **Points/tiers — deliberately the smaller half, no new schema at all.** Points are a live
  count of the caller's own `offer_redemptions` rows (`getMyRewardStatus()` in new
  `src/services/rewards.js`) — RLS already scopes that table's SELECT to `auth.uid() = user_id`
  (the same access `getMyRedemptions()` in `brandOffers.js` already relies on), so no ledger
  table, no `trusted_update`-guarded counter column, no race condition to guard against. Three
  fixed thresholds (Bronze 5 / Silver 15 / Gold 30 redemptions) map to a cosmetic badge only —
  explicitly **not** wired to unlock anything else, per the user's own choice when asked. New
  `src/screens/RewardsScreen.js` + `Rewards` route (`RootNavigator.js`), reachable from a new
  "🎁 Your Rewards" row on `ProfileScreen.js`, same `timelineLink` style as the Momentum/
  Insights/Memory Vault rows above it — a tier card with a progress bar to the next tier, and a
  full tier list with reached/unreached state. **Deliberately not folded into Momentum**
  (attendance streaks/deltas) even though both are "derived signal, no fabrication" features —
  keeping Rewards scoped to perks specifically avoids two screens reading the same underlying
  rows into two different-shaped numbers; this was an explicit tradeoff surfaced to the user
  before building, who chose to keep the scope narrow.
- **Group-unlock** (`20260807_rewards_group_unlock.sql`): `brand_offers` gained
  `unlock_scope` (`'community' | 'gathering' | null`), `unlock_community_id` (new FK to
  `communities`), and `unlock_min_members` — null/null/null on every pre-existing row, fully
  backward compatible. A `'gathering'`-scoped offer reuses the *existing* `gathering_id` column
  already on `brand_offers` (the one that powers gathering-tied "Community Perk" offers) rather
  than adding a second FK — a gathering-linked offer just optionally also gets a real minimum-
  approved-attendee gate. A `brand_offers_unlock_shape_check` constraint keeps the three columns
  internally consistent (scope requires its threshold and its matching linked id) so a malformed
  row can't be inserted even outside the app. **Enforced server-side, not just in the UI**: a new
  `enforce_offer_unlock_threshold()` BEFORE INSERT trigger on `offer_redemptions` counts real
  `community_members` rows (community scope) or real `gathering_interest.status='approved'` rows
  (gathering scope) and raises `'OFFER_LOCKED'` if the count is under threshold — the same
  recognizable-error-message pattern `redeemOffer()`'s callers already handle for
  `ALREADY_REDEEMED`/`REDEMPTION_LIMIT_REACHED`, so both `BrandOffersScreen.js` and
  `BusinessProfileScreen.js` now catch it with a clear "needs more people to join first" message
  instead of a raw error. Both screens also show live unlock progress ("6/10 members joined")
  and swap the redeem button for a disabled "Locked" state while the threshold isn't met, reusing
  `getCommunityMemberCount()` (already existed, `communities.js`) and a new
  `getApprovedAttendeeCount()` (`gatherings.js`, same one-line `count`-only pattern). Businesses
  set the threshold when creating an offer (`BusinessDashboardScreen.js`'s create-offer modal
  gained a group-unlock toggle — a community picker with real member counts for standing offers,
  or a plain attendee-count input for offers attached via the existing "+ Attach Reward" flow on
  a specific gathering).
- **While building this, found the "+ Attach Reward" gathering-offer flow had never actually
  been wired to a picker** — `offerGatheringId` state existed and was passed through to
  `createBusinessOffer()`, but the only way it was ever set was the per-gathering "+ Attach
  Reward" button already in the Gatherings tab (`BusinessDashboardScreen.js:441-450`, pre-
  existing, unmodified) — there was never a bare "pick any gathering" dropdown in the general
  "+ Create Offer" modal. Not a bug — the attach-from-the-gathering-row flow is a complete, real
  path — but worth noting so a future session doesn't assume a picker is missing and add a
  redundant one.
- **Verified live end-to-end before committing, not just schema application**: created real
  test offers/communities/redemptions against production
  (`brand_partners` row `Coastal Coffee`, `67dd3d6d-f36b-4b20-8a80-ac980baecc30`, the same test
  partner used by the billing section below) and confirmed via direct SQL — a gathering-scoped
  offer's redemption is genuinely rejected (`OFFER_LOCKED`) when the real approved-attendee count
  is under threshold and genuinely succeeds once it's met; same for a community-scoped offer
  after adding a second real `community_members` row; the `brand_offers_unlock_shape_check`
  constraint genuinely rejects an inconsistent insert (scope set without its matching id); and
  `getMyRewardStatus()`'s RLS-scoped count genuinely returns 5 (crossing into Bronze) for a
  profile with 5 real redemptions and genuinely returns 0 for a different profile querying at the
  same time — confirmed the isolation, not just the happy path. All test data (offers,
  redemptions, one test community) deleted afterward; production is back to its pre-test state
  (this project has almost no real data yet — 0 communities, 0 offers, 1 partner, 4 profiles at
  the time of this pass, so every scenario above had to be constructed, not found).
- **Not done yet**: no manual run-through in a simulator/device. Next session should check:
  creating a standing offer with a community-unlock threshold and a gathering-attached offer with
  an attendee-count threshold from the dashboard, that both correctly show live progress and a
  disabled "Locked" state on `BrandOffersScreen`/`BusinessProfileScreen` before their threshold is
  met and unlock in real time after it's crossed, and that the Rewards screen renders correctly
  for a brand-new account (no tier yet, 5-to-go progress bar) versus one with real redemption
  history.

## Outstanding: Friend Circles (closes Phase 5 "Friend Circles" gap)

Closed against the confirmed real gap: `FriendsScreen.js` was a flat list with no grouping
concept (Work/Fitness/Family/Travel) anywhere in the schema or UI. This is real, useful,
no-invented-signal work — unlike AI Concierge/Momentum below, nothing here needed an LLM call
or a fabricated metric, so it was built directly instead of flagged for a separate review.
**This was the change in progress when the codespace restarted mid-session** — found
`src/services/friendCircles.js` (new) and a modified `src/screens/FriendsScreen.js` already
finished but uncommitted, plus an unapplied `20260807_friend_circles.sql`. Verified and
committed this session, not written from scratch.

- New `friend_circles`/`friend_circle_members` tables (`20260807_friend_circles.sql`) — a join
  table, not a column on friendships, since one friend can belong to several circles (e.g.
  "Work" and "Fitness" at once) and a circle only ever makes sense relative to its owner's own
  friend list. `friend_user_id` is intentionally not constrained to an existing friendship row —
  a lightweight personal label, not a second relationship table to keep in sync. RLS on
  `friend_circles` is the standard `auth.uid() = user_id` owner-only shape; `friend_circle_members`
  is owned indirectly through its parent circle's `user_id`, the same indirect-ownership pattern
  already used elsewhere in this schema for join/detail tables. **Found already applied to
  production** (`enmosvippabmuqslzrox`) from before the restart — confirmed live via the
  Supabase Management API rather than re-applying blind (a second `create table` would have
  errored, which is how this was caught). Re-verified the live column list and both RLS
  policies match the migration file exactly, then independently re-proved the isolation
  end-to-end via `set_config('request.jwt.claims', ...)` as two different real profile rows: user
  A can create a circle and add a member, user B genuinely gets zero rows back querying that
  circle by id directly.
- `src/services/friendCircles.js` — plain CRUD (`getMyCircles`/`createCircle`/`deleteCircle`/
  `addFriendToCircle`/`removeFriendFromCircle`), no RPCs needed since ownership is fully covered
  by RLS. `getMyCircles()` embeds `friend_circle_members(friend_user_id)` in one query rather
  than a second round trip, mapped down to a flat `memberIds` array per circle.
  `addFriendToCircle` swallows Postgres `23505` (unique-violation) so re-adding an already-
  present member is a harmless no-op instead of a thrown error.
  **Deliberately not a member-limit-enforcing feature** — no cap on circle count or members per
  circle, matching this schema's general lack of arbitrary limits elsewhere.
- `FriendsScreen.js` gained a horizontal "Circles" chip row (tap to filter the friends list to
  that circle, long-press to delete with a confirm alert), a "+ New Circle" chip opening a
  create-name modal, and a 🏷️ tag icon per friend row opening a manage-membership modal
  (checkbox-style toggle per circle). No new route/screen — everything is inline on the
  existing `Friends` route, since circles are a lens over the same friends list, not a
  separate surface. The chip row and tag icon are both conditionally rendered (only when
  circles/friends exist) so a user with none sees the screen exactly as before.
- Verified via a full `npx expo export --platform ios` (1831 modules, one more than the prior
  1830 baseline — the new `friendCircles.js`), not yet a simulator/device run.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check:
  creating a circle, adding/removing friends via the tag icon, filtering by a circle chip,
  long-press delete, and that a brand-new user with zero circles sees an unchanged screen.

## Outstanding: Momentum (closes Phase 5 "Momentum" gap)

Closed against the confirmed real gap: no "social momentum" signal or screen existed anywhere.
Built as a purely real, derived signal — no fabricated score, same "no invented numbers"
convention as `homeDashboard.js`'s `bestPick`/`weeklyRecap` and `insights.js`'s whole premise.
Deliberately not a single composite "momentum score" (0-100, etc.) — this codebase has never
invented a blended metric like that anywhere else, so Momentum instead surfaces two honest,
separately-real signals: a weekly activity streak and month-over-month deltas.

- New `src/services/momentum.js` — `getMomentumStats()`. No new tables/RPCs; reads the same
  tables/columns already trusted elsewhere (`gathering_interest.status='approved'` joined to
  `gatherings.scheduled_at`, `gatherings.host_id`, `friendships.status='accepted'` via the same
  `user_a`/`user_b` `.or()` pattern `friends.js` already uses, `community_members.joined_at`),
  fetched once each from the earlier of an 8-week or two-month lookback, then bucketed
  client-side two ways:
  - **Weekly streak**: 8 weekly buckets (attended-or-hosted count per week), `currentStreak` =
    consecutive weeks counting back from the current week with at least one real gathering.
    A quiet week breaks the streak back to 0 — no grace period, no fabricated "streak freeze"
    mechanic.
  - **Month-over-month deltas**: real counts of gatherings attended, new (accepted) friends,
    and communities joined, this calendar month vs. last calendar month, computed from the same
    fetched rows (no extra queries) — an honest "▲/▼/—" per line, no percentage-change math
    invented on top.
- New `src/screens/MomentumScreen.js` + `Momentum` route (`RootNavigator.js`), reachable from a
  new "🔥 Your Momentum" row on `ProfileScreen.js`, same `timelineLink` style as the
  Timeline/Memory Vault/Insights rows above it. A streak card (🔥 with the week count, or 🌱
  "no active streak yet" at zero — an honest zero-state, not hidden), an 8-bar weekly mini
  chart (own lightweight bars, not a charting library — matches this codebase's existing
  hand-rolled bar style from `InsightsScreen.js`'s vibe breakdown), and a delta card for the
  three this-month-vs-last-month lines.
- Verified end-to-end against the live production schema (`enmosvippabmuqslzrox`) before
  committing: ran each of the four underlying query shapes directly via
  `set_config('request.jwt.claims', ...)` as a real profile — confirmed a user with genuine
  past attended/hosted gatherings and an accepted friendship gets real rows back, and a user
  with zero community memberships gets a real empty array (exercising the chart's zero-state
  path honestly rather than assuming it). Verified via a full `npx expo export --platform ios`
  (1833 modules, two more than the prior 1831 baseline — the two new files), not yet a
  simulator/device run.
- **Deliberately not built**: a "longest streak ever" record, streak-loss notifications/nudges,
  or any cross-user comparison ("you're more active than 80% of users") — the last one in
  particular would need either a fabricated percentile or a new aggregate query across every
  user, out of scope for a first pass and not asked for.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check: an
  established account (real streak, real bar chart, real deltas), a brand-new account (zero
  everywhere — streak card should read "no active streak yet", chart should show its empty
  state, delta card should show real 0s with `—` symbols, not blank/hidden sections), and that
  the streak correctly breaks to 0 after a genuinely quiet week rather than persisting.

## Outstanding: Memory Vault → Profile link (closes roadmap #5 partial gap)

This is the change that was in progress when the codespace restarted mid-session (found
`src/services/memoryVault.js` modified but uncommitted, with a finished but unwired
`getMyMatchesWithMemoryCounts()` already written). Finished and committed this session.

- Memory Vault is per-match (`memory_vault_items.match_id`), so there's no single "your"
  vault to deep-link Profile straight into — `getMyMatchesWithMemoryCounts()` in
  `services/memoryVault.js` instead returns every match the caller has, each with a real
  per-match memory count, mirroring how Timeline is reached from Profile as an aggregate
  view rather than a single record. Query intentionally has no explicit `user_a`/`user_b`
  filter — same pattern already used by `MatchesScreen.js`, safe because `matches` RLS
  (`supabase/schema.sql`) already scopes SELECT to rows where the caller is `user_a` or
  `user_b`; confirmed by reading the policy directly rather than assuming.
- New `src/screens/MemoryVaultIndexScreen.js` + `MemoryVaultIndex` route
  (`RootNavigator.js`) — a simple list of matches (avatar via the existing
  `getSignedPhotoUrl`, same pattern as `MatchesScreen.js`) each showing its real memory
  count, tapping through to the existing per-match `MemoryVaultScreen` (unchanged) with
  `matchId`/`matchName`, the same params `ChatScreen.js`'s entry point already passes.
  Real empty state included ("No matches yet...") rather than left blank.
- `ProfileScreen.js` gained a "💫 Memory Vault" row directly under the existing "📖 View
  Your Timeline" link, same `timelineLink` style reused rather than a new one invented,
  navigating to `MemoryVaultIndex`.
- Verified via a full `npx expo export --platform ios` (1826 modules, one more than the
  prior 1825 baseline — the new screen file), not yet a simulator/device run.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check
  the list renders real matches/counts, tapping through opens the right per-match vault,
  and the zero-matches empty state.

## Outstanding: Insights screen (closes roadmap #13)

Closed against the confirmed real gap: no dedicated Insights screen existed, real stats
were scattered inside `ProfileScreen.js` (`getProfileQuickStats`/`getEarnedProfileStats`).
Verified via a full `npx expo export --platform ios` (1828 modules, two more than the prior
1826 baseline — the new `InsightsScreen.js` + `insights.js`), not yet a simulator/device run.

- New `src/services/insights.js` — `getInsightsStats()` is purely an aggregator, no new
  queries beyond one extra: reuses `getProfileQuickStats()`/`getEarnedProfileStats()`/
  `getAchievements()` as-is, adds `hostedCount`/`communitiesCreated`/`memberSince` (each a
  single real count/column already used elsewhere in this file, e.g. `getAchievements`'s own
  internal `hostedCount` query, just now also returned instead of staying internal), and a
  `vibeBreakdown` — real per-`interest_tag` counts across the caller's own past approved
  `gathering_interest` rows, same source table `getEarnedProfileStats`'s `favoriteVibe` already
  reads, just kept as a full breakdown instead of collapsed to the single top tag.
- New `src/screens/InsightsScreen.js` + `Insights` route (`RootNavigator.js`), reachable from
  a new "📊 Your Insights" row on `ProfileScreen.js`, same `timelineLink` style as the Timeline
  and Memory Vault rows added directly above it. Shows: a stat grid (gatherings attended/
  hosted, communities joined, friends made), favorite vibe/usually-active (same earned-stats
  cards already on Profile), a "what you've been up to" bar breakdown per category using the
  existing `categoryStyleFor()` icons/colors, and the full achievements grid — unlike
  Profile's grid (earned-only), this one also renders locked achievements at reduced opacity
  so there's an honest "N/total" count, since every achievement's earn condition is already a
  real, non-fabricated threshold (`getAchievements()`'s own existing convention).
- **Not done yet**: no manual run-through in a simulator/device. Next session should check a
  new-user account (all-zero/empty state, no vibe breakdown, no achievements) and an
  established account with real history render correctly.

## Outstanding: Emergency Contacts (closes remainder of roadmap #15)

As covered in the audit correction above, the date safety check-in flow itself already
existed (`date_checkins`, `services/dateSafety.js`, `DateCheckInModal.js`) — this pass only
needed to add a persistent emergency contact and wire it in. Applied to production
(`enmosvippabmuqslzrox`) and verified live via the Supabase Management API (table + RLS
policy confirmed to exist, matching `date_checkins`' own owner-scoped policy shape exactly).
Verified via a full `npx expo export --platform ios` (1830 modules, two more than the prior
1828 baseline), not yet a simulator/device run.

- New `emergency_contacts` table (`20260807_emergency_contacts.sql`): `id`, `user_id`, `name`,
  `phone`, `relationship` (nullable), `created_at`. One RLS policy, `for all using (auth.uid()
  = user_id)` — same shape as `date_checkins`' existing "Users manage their own check-ins"
  policy, this codebase's established pattern for a personal-safety table with no need for a
  separate WITH CHECK clause.
- New `src/services/emergencyContacts.js` (`getMyEmergencyContacts`/`addEmergencyContact`/
  `deleteEmergencyContact`) + `src/screens/EmergencyContactsScreen.js` (add/list/remove),
  reachable from a new "🛡️ Emergency Contacts" row in `SettingsScreen.js`'s existing Safety
  section, alongside Blocked Users/Verify Identity.
- **The check-in flow itself now uses the saved contact**: `DateCheckInModal.js` gained a
  `shareWithContact()` helper — when a contact is saved, "Set Up Check-In & Share Plans",
  "📍 Share My Location Now", and the live-tracking share link now all open the device's own
  SMS composer pre-addressed to that contact (`Linking.openURL('sms:...')`, checked with
  `Linking.canOpenURL` first) instead of the generic OS share sheet requiring the user to pick
  a recipient fresh each time. Falls back to the original `Share.share()` behavior if no
  contact is saved or `sms:` can't be opened (e.g. a device with no SMS capability), so nothing
  regresses for a user who hasn't set one up. When no contact exists, the modal shows an inline
  "add one →" link straight to the new Settings screen. `DateCheckInModal` gained an optional
  `navigation` prop for this (wired from its one real caller, `ChatScreen.js`); the link simply
  doesn't render if it's omitted, so nothing breaks for a hypothetical caller that doesn't pass
  one.
- **Deliberately not built**: any automatic/backend-triggered alert to the emergency contact
  (e.g. auto-texting them if the user doesn't check in by the scheduled time). This app has no
  SMS/email-sending infrastructure at all — grepped for `twilio`/`resend`/`sendgrid`/`smtp` in
  both `src/` and `supabase/`, zero hits; the only outbound-delivery mechanism that exists is
  Expo push notifications to devices already running this app, which an emergency contact who
  isn't a Nearby user can't receive. Building real automatic delivery needs a new third-party
  integration (its own API key, account, cost) and is a materially different, more sensitive
  feature — same treatment as the Stripe billing gap elsewhere in this file, not something to
  fake by silently only-notifying-if-the-contact-happens-to-have-the-app.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check:
  adding/removing a contact, that the SMS composer actually opens pre-addressed and pre-filled
  on a real device (the `sms:` deep link can't be verified from this sandboxed environment),
  and that the share-sheet fallback still works with zero contacts saved.

## Outstanding: Unified Map (closes roadmap #10, partially — see below)

Closed as far as this codebase's own privacy/data conventions honestly allow. Verified via a
full `npx expo export --platform ios` (1830 modules — unchanged from the prior baseline, since
this pass only edited existing files, no new ones). Not yet a simulator/device run.

- **Businesses layer**: new `getNearbyBusinesses()` in `services/brandOffers.js` — every
  active `brand_partners` row with real coordinates, not just ones currently running an offer
  (previously the map only ever showed a business indirectly, via a deal pin). No new RPC:
  `brand_partners`' existing RLS (`Anyone can view active partners`, `using (active = true)`)
  already makes every active business's row, including its real lat/lng, fully public — same
  "legitimate public business location" justification `GatheringsMapView.js`'s own existing
  comment already gives for deal pins. Distance filtering is a plain client-side approximation
  (equirectangular, not full haversine — plenty accurate at the 50-mile radius this uses) since,
  unlike gatherings/offers, there's no private coordinate here that needs to stay server-side.
  `GatheringsMapView.js` gained a `businesses`/`onSelectBusiness` prop pair (both optional,
  default empty/no-op, so `GatheringsScreen.js`'s existing use of the same component is
  unaffected), rendering a 🏪 pin that opens the `BusinessProfileScreen` built earlier this
  session. Wired into `DiscoverHubScreen.js`'s map view, shown alongside deals under the same
  Perks/All filter scope.
- **Live activity layer**: gatherings whose `scheduled_at` falls in the same "happening now"
  window Home's own `getHomeDashboard()` already uses ([-30min, +2h] of now) now render with a
  red pin and a "🔴 LIVE NOW" callout badge instead of their normal category color. Reuses the
  same signal, not a new one — inherits that function's one known limitation (the underlying
  `getNearbyGatherings()` query itself excludes anything with `scheduled_at` already in the
  past, so in practice this can only ever flag a gathering about to start within 30 minutes,
  never one that's been running for up to 2 hours — a pre-existing gap in Home's own
  `happeningNow`, not something newly introduced here; left as-is rather than changing a
  query several other features already depend on, out of scope for this pass).
- **People were deliberately not added, and this is a hard privacy constraint, not just an
  unbuilt feature.** Checked `services/proximity.js` directly: this app never gives the client
  another person's coordinates, not even fuzzed — "crossed paths" is computed entirely
  server-side by comparing coarse rounded-location buckets via the `report-presence` Edge
  Function, and `profiles` itself has no lat/lng column at all (already confirmed in the
  Gathering Hub section above, re-confirmed here). There is no real coordinate anywhere in this
  codebase to honestly plot for an individual person. Same reasoning the Gathering Hub section
  already used to reject a GPS-based "Live Mode."
- **Communities were deliberately not added either — no fabrication, just no real data.**
  Checked `services/communities.js`: communities have no location field anywhere in the schema.
  They're topic-based, not place-based, so there's no real coordinate to plot — inventing one
  (e.g. centroid of members' fuzzed areas) would mean fabricating a signal this app has
  otherwise been careful never to invent.
- **Not done yet**: no manual run-through in a simulator/device. Next session should check the
  businesses layer renders alongside deals without visual overlap/clutter in a dense area, the
  live-now badge (may need to manually create a test gathering scheduled a few minutes out to
  actually observe it, given the window-timing limitation above), and that tapping a business
  pin correctly opens its `BusinessProfileScreen`.

## Outstanding: Empty-state audit (closes the roadmap doc's closing suggestion)

Grepped every one of the 67 files in `src/screens/` for existing empty-state handling
(`empty`/`.length === 0`/"nothing found"/"no ... yet"/"none yet" patterns) to separate real
gaps from screens that already had something. Verified via a full `npx expo export --platform
ios` (1830 modules, unchanged — one file edited, no new files). Not yet a simulator/device run.

- **Result: most major user-facing screens already had a real empty state** — Home ("Quiet
  night nearby"), Discover, Gatherings, Matches, Inbox, Notices, Communities, Friends,
  Activity, Timeline, Places (already flagged in this file as the one known example), Brand
  Offers/Perks, Discovery — all genuine, pre-existing, not fabricated for this pass. The
  original audit line above assumed "most are unaudited" without actually checking; that
  assumption was wrong, same class of miss as the Safety section's correction above.
- **Two real, silent gaps found and fixed**, both in `CommunityDetailScreen.js` (built earlier
  this session, in the Community Leaders + Calendar pass): the "Leaders & Members" and
  "Upcoming Gatherings" sections were each guarded by `.length > 0` with no `else` — a brand
  new or quiet community would show neither section at all, with nothing telling the viewer
  why. Both now render their header plus a real, honest one-line message ("No members to show
  yet." / "Nothing on the calendar yet — be the first to plan something.") when empty, instead
  of silently vanishing.
- **Deliberately left alone**: many other screens (`GatheringDetailScreen.js`'s "Who's Going",
  `BusinessProfileScreen.js`'s perks/photos/reviews sections, etc.) also render nothing when
  their underlying data is empty — but this is this codebase's own established, repeated
  convention (e.g. `getHostLovedTags()`'s doc comment: "correctly renders as nothing for a new
  host with no feedback yet"), not an oversight. Adding a generic "nothing here yet" banner to
  every one of those would go against a pattern the codebase has consistently and intentionally
  chosen elsewhere. Only touched the two cases above, where the missing section had a
  persistent, expected header a user would otherwise wonder had disappeared.
- **Not exhaustively covered**: admin-only screens (`AdminReportsScreen.js`, etc.), one-off
  relationship tools (`RehearsalRoomScreen.js`, `StressTestScreen.js`, etc.), and pure forms
  (`CreateGatheringScreen.js`, `EditGatheringScreen.js`, onboarding) were intentionally not
  audited — they're either low-traffic, admin-facing, or have no empty-list concept to begin
  with, not "major screens" in the roadmap doc's sense.

## Outstanding: Business Profile (public-facing screen, closes roadmap #9)

Closed against the confirmed real gap from the audit above: no public-facing business profile
existed anywhere — every tap target naming a business (offer cards, gathering "Community Perk"
badges, `BusinessHostBadge`) was either static text or routed straight to a private chat. Core
build is done and committed; **not yet manually tested in a running app** — verified via
`@babel/core` compile of every touched file and a full `npx expo export --platform ios` (1824
modules, one more than the prior clean 1823-module baseline), not a simulator/device run.

- New `src/screens/BusinessProfileScreen.js` + `BusinessProfile` route (`RootNavigator.js`,
  `headerTransparent` matching `GatheringDetail`/`CommunityDetail`'s convention), reachable from
  five places that previously dead-ended or had no path at all: `BrandOffersScreen.js`'s
  logo/partner-name block (was plain text), `GatheringDetailScreen.js`'s Community Perk card's
  "at {partner}" line (was plain text), `BusinessHostBadge.js` (gained an optional `navigation`
  prop — wraps itself in a `TouchableOpacity` only when passed one, so any caller that omits it
  keeps the old static badge; wired from both its actual callers, `GatheringsScreen.js` and
  `CommunitiesScreen.js`), `CommunityDetailScreen.js` (added a "View Business Profile →" link
  next to the existing follow-business button, for communities backed by a business), and
  `ActivityScreen.js`'s business-update notice rows (were a plain, non-tappable `View`;
  `getFollowedBusinessUpdates()`'s select gained `partner_id` since it wasn't being fetched
  before, so there was nothing to navigate with).
- Real data only, no fabricated fields:
  - **Header**: `brand_partners.name`/`logo_url`/`description`/`address` (all pre-existing
    columns), plus a real follower count pulled from `get_business_dashboard_stats` — only
    `total_followers` is used from that RPC's response; its redemption-count/repeat-redeemer
    fields are the owner's own business-performance metrics and were deliberately left off a
    page any regular user can browse to, even though the RPC itself has no ownership check
    (grants execute to `authenticated`, not scoped to the caller — confirmed live via the
    Supabase Management API, `pg_get_functiondef`).
  - **Follow/Message**: reuses `isFollowingBusiness`/`followBusiness`/`unfollowBusiness` and
    routes Message to the existing `BusinessConversation` screen — no new mechanism.
  - **"What People Say"**: new `getBusinessLovedTags()`/`getBusinessReputation()` in
    `services/gatherings.js`, the exact same honest-aggregate pattern `getHostLovedTags()`/
    `get_host_reputation` already established for individual hosts (welcoming %, would-attend-
    again %, categorical "what people loved" tags from `gathering_feedback.great_because`) —
    just keyed on `gatherings.hosting_partner_id` instead of `host_id`, since a business isn't a
    `profiles` row and the existing per-host RPCs can't take a partner id. Computed client-side
    rather than as a new RPC (`gathering_feedback` is already publicly SELECTable, same
    justification the original per-host comment gives). Renders nothing until a business has at
    least one review — same "no feedback yet" convention as the individual-host version.
  - **Perks**: new `getBusinessActiveOffers()` in `services/brandOffers.js` — standing
    (non-gathering-tied) active offers for that partner, with real scarcity counts
    (`getRedemptionCounts`) and a working redeem button (`redeemOffer()`, same function
    `BrandOffersScreen` uses) — not a read-only preview.
  - **Upcoming Gatherings**: new `getBusinessPublicGatherings()`, deliberately filtered to
    `is_public: true` — a business's private/women-only gatherings (if any exist) don't leak
    onto a page anyone can browse to, unlike the owner-only `getMyBusinessGatherings()` (left
    untouched) which correctly shows everything to the owner.
  - **Photos**: no photo-gallery field exists on `brand_partners` (only `logo_url` — confirmed
    live via `information_schema.columns`), so rather than fabricate one, this pulls real
    `cover_photo_path` images from the business's own upcoming gatherings (via the existing
    `getSignedGatheringPhotoUrl()`, same signed-URL pattern already used everywhere else cover
    photos are shown) — genuine sourced content, not an invented upload feature.
- **Deliberately not built**: `get_business_top_members` (a real, pre-existing RPC already used
  by the owner's dashboard) returns named individuals' `display_name` + attendance counts —
  fine for an owner's own dashboard, not something to surface to arbitrary browsing users, so it
  was excluded from this public screen even though the RPC itself has no ownership gate. A true
  per-customer CRM view, and actually locking down the owner-facing business RPCs to check
  `managed_partner_id` server-side (several — `get_business_dashboard_stats`, `_growth`,
  `_top_members`, `_visit_frequency`, `_insights` — currently trust the caller-supplied
  `partner_id_param` with no ownership check, grants execute to any `authenticated` user), are
  both separate, more sensitive changes — not attempted here, flagged for a future security pass
  since it's a real gap between "no client currently calls this except the owner's own screen"
  and "actually enforced." **Both closed later this same session — see the section immediately
  below.**
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through all five entry points, confirm follow/unfollow and redeem actually round-trip, and
  check both a business with no reviews yet (section should render nothing) and one with real
  `gathering_feedback` data.

## Outstanding: Business RPC ownership check (security fix) + CRM member drill-in (closes #12 partial gap)

Closed the security gap flagged in the section above, then built on top of the now-locked-down
functions to close the rest of roadmap #12 (Business Community CRM). Applied to production
(`enmosvippabmuqslzrox`) and verified live via the Supabase Management API — both the
`profiles.managed_partner_id = auth.uid()`'s row ownership predicate and `auth.uid()` itself
resolving correctly from `set_config('request.jwt.claims', ...)` were confirmed directly (the
underlying tables have zero real follower/redemption/attendee rows yet in production, so the
functions' actual outputs read as zero for both an owner and non-owner right now — the ownership
*predicate* itself was verified independently since the data can't yet distinguish the two).
Frontend changes verified via `@babel/core` compile and a full `npx expo export --platform ios`
(1824 modules, same count as the Business Profile pass — no new files this time, edits only).

- **Security fix** (`20260807_business_rpc_ownership_check.sql`): `get_business_dashboard_stats`,
  `get_business_growth`, `get_business_top_members`, `get_business_visit_frequency`, and
  `get_business_insights` were all SECURITY DEFINER functions granted to any `authenticated`
  user with no check that the caller actually owned `partner_id_param` — `BusinessDashboardScreen.js`
  only ever calling them with the caller's own `managed_partner_id` was a UI convention, not real
  access control. `get_business_top_members` in particular returns named individuals'
  `display_name` + attendance count, so this was a real PII leak: any logged-in user who knew or
  guessed a `partner_id` could pull another business's follower/redemption counts and top-
  attendee list. Each function now checks `exists (select 1 from profiles where id = auth.uid()
  and managed_partner_id = partner_id_param)` up front and returns empty/zero/null instead of
  raising, matching this codebase's existing RLS convention of "just don't show it" rather than
  leaking existence via an error message.
- Since `get_business_dashboard_stats`'s `total_followers` was the one piece of that data
  legitimately shown on the public `BusinessProfileScreen` (added earlier this session), a new,
  deliberately narrow `get_business_follower_count(partner_id)` was added alongside — public-safe,
  no ownership check, returns only a count, no revenue/attendee data. `getBusinessFollowerCount()`
  in `services/brandOffers.js` now calls that instead.
- **CRM member drill-in** (closes the rest of #12): new `get_business_member_gathering_history()`
  RPC (same ownership check, owner-only) plus `getBusinessMemberGatheringHistory()` in
  `services/brandOffers.js`. `BusinessDashboardScreen.js`'s "Most Engaged" list rows are now
  tappable — expanding a member shows their real per-gathering visit history at this business
  (title + date, sourced from the same `gathering_interest`/`gatherings` join the leaderboard
  itself already uses) and a "💬 Message" link that opens the existing inbox conversation UI
  (`openConversation()`, reused as-is) pre-targeted at that member, including members with no
  prior conversation — real targeted outreach, not just the existing mass-broadcast "Post Update
  to Followers." This was the specific gap the earlier audit called out: "no per-customer CRM
  record, no drill-down... outreach is limited to one broadcast."
- **Deliberately not built**: a persistent CRM record (notes/tags/contact history stored against
  a member beyond what's derivable from real attendance data), and per-customer analytics beyond
  visit history (e.g. lifetime redemption value) — both would need new schema, and nothing here
  needed one; this stays within "real data, better surfaced," the same bar as everything else in
  this file.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: expand a top-member row (visit history renders, or an empty state if the RPC legitimately
  returns nothing), tap Message on a member with no prior conversation and confirm it opens a
  blank thread correctly, and confirm a non-owner account calling these RPCs directly (e.g. via
  a manually crafted request) genuinely gets zero/empty back now.

## Outstanding: Community Leaders + Calendar (closes roadmap #7)

Closed the confirmed real gap from the audit: no members list, no leader/admin concept
surfaced anywhere, and "Upcoming Gatherings" was a flat list with no calendar view. Applied to
production and verified via `@babel/core` compile + a full `npx expo export --platform ios`
(1825 modules, one more than the prior 1824 — the new `CommunityCalendar.js` component).

- **Leaders**: `community_members.role` already distinguished `'creator'` from `'member'`, but
  nothing let a creator designate a leader, and there was no UPDATE policy or RPC on
  `community_members` at all. New `set_community_member_role()` SECURITY DEFINER RPC
  (`20260807_community_leaders.sql`) — checks the caller is the community's own creator, that
  the target member exists and isn't the creator, then updates their role to `'leader'` or back
  to `'member'`. `CommunityDetailScreen.js` gained a real "Leaders & Members" section
  (`getCommunityMembers()`, new in `services/communities.js`) with avatars, role badges, and — 
  creator view only — a "Make Leader"/"Remove Leader" toggle per member. RLS on
  `community_members` only shows the full roster for public communities or to the creator (a
  regular member of a private community only sees their own row) — that's an existing, real
  privacy constraint from the schema, left as-is; the new members list just renders whatever RLS
  actually returns rather than working around it.
- **Calendar**: new `src/components/CommunityCalendar.js` — a real month grid (prev/next month
  nav, dots on days with an actual `scheduled_at` gathering, tap a day to filter), not a
  relabeled list. `CommunityDetailScreen.js` gained a List/Calendar toggle above "Upcoming
  Gatherings"; List mode is unchanged from before, Calendar mode shows the grid and filters the
  list below to the tapped date.
- **Caught and fixed my own mistake while applying this**: the new `set_community_member_role`
  RPC (and, on review, the two new RPCs from the section above —
  `get_business_follower_count`/`get_business_member_gathering_history`) were only revoked
  `from public`, not `from public, anon` — this file's own "Known conventions" section has
  always said to revoke from both. Postgres/Supabase's default-privileges setup grants new
  functions execute directly to the `anon` role (not just via the `PUBLIC` pseudo-role), so
  `revoke ... from public` alone left all three callable by a fully unauthenticated caller.
  Caught by re-checking `has_function_privilege('anon', ...)` after applying instead of assuming
  the revoke worked; fixed live via a follow-up `revoke ... from anon` and corrected in both
  migration files so a fresh apply gets it right the first time. None of the three leaked data to
  an anon caller in practice (each still checks `auth.uid()`-based ownership internally, and an
  anon session has no matching row), but it violated defense-in-depth and this file's own stated
  rule, so worth being explicit about here rather than quietly folding the fix in.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: promote/demote a member as the creator (and confirm a non-creator genuinely can't,
  even by calling the RPC directly), toggle List↔Calendar, tap a day with a dot and confirm the
  list below filters correctly, and check a private community as a non-creator member (should
  only see your own row in the members list — confirm that reads as reasonable, not broken).

## Outstanding: Discover mini-app (unified search/filter/map/list + recommendations)

Closed against a user-pasted external roadmap doc (Aug 7 2026) that prioritized "Discover" as
the single biggest remaining screen — a search/filter/People/Gatherings/Communities/Places/
Perks/map-list-card/AI-recommendations mini-app. Before building, checked that doc against the
actual repo state and found most of its other "build next"/"phase 2/3/5" items (Gathering
Detail, Gathering Hub, Inbox, Profile/"You", Community screens, Rewards/billing, even Timeline/
Memory Vault) already built and committed — the doc was stale. Discover was correctly identified
as the one real gap: `DiscoverHubScreen.js` was a thin 2-card router (Meet People → `Nearby`,
Gatherings → `Gatherings`) plus a stories carousel, not a browsable/searchable surface. **Core
build is done and committed; not yet manually tested in a running app** — same caveat as every
other entry in this file: verified via `@babel/core` compile of both touched files and a full
`npx expo export --platform ios` (1823 modules, same count as prior clean passes), not a
simulator/device run.

- `DiscoverHubScreen.js` rebuilt in place (same route, no navigation changes needed) into a real
  unified surface over the four already-listable/searchable content types — **not** including
  People. People were deliberately kept as their own entry card, not folded into unified text
  search: this is a proximity dating app, and searching nearby people by name is a stalking
  vector nothing else in this codebase has ever built; Browse/Crossed Paths on the dedicated
  `Nearby` screen stays the only way to find people.
- **Search**: one text box filters `getNearbyGatherings('wide')` (title/description),
  `getPublicCommunities()` (name/description), and `getActiveOffers()` (title/business name/
  description) client-side against already-fetched data — no new queries for those three. Places
  is the exception: Google Places is a metered external API, so it's only queried (debounced
  350ms) when the Places filter is active, or when a search of 2+ characters is typed with
  location granted. `searchNearbyPlaces()` in `services/places.js` gained an optional `keyword`
  param passed straight through to Google's Nearby Search `keyword=` parameter — a real,
  pre-existing Google API capability, not a new fabricated signal.
- **Filters**: a type chip row (All / Gatherings / Communities / Places / Perks) scopes which
  sections render; Places additionally gets its own category chips (coffee/restaurants/parks/
  hubs, same `PLACE_CATEGORIES` as `PlacesScreen.js`) since Google's Nearby Search requires a
  `type`. Communities already-joined by the caller are excluded (checked via `getMyCommunities()`
  against `getPublicCommunities()`), matching `CommunitiesScreen.js`'s own existing convention.
- **Map/List views**: list is default; map (shown only when the type filter is All/Gatherings/
  Perks, since Communities/Places have no map story) reuses `GatheringsMapView.js` completely
  unmodified — gatherings via their existing fuzzed coordinates, perks via `brand_offers`' own
  real lat/lng (same `mapDeals` pattern already used by `GatheringsScreen.js`). **Card view was
  not built** — `DiscoveryScreen.js` already owns a dedicated swipe-card interaction for people,
  and a generic "everything" card view has no single natural gesture across four differently-
  shaped content types; scoped out rather than built shallow.
- **"Recommended for you"**: reuses `getGatheringFitReasons()` (the existing shared scorer
  already powering Home's `bestPick` and `GatheringDetailScreen`) against the same
  already-fetched gathering list — real interest/distance/attendance/beginner-friendly signals,
  score ≥ 5 threshold, top 3, exact same convention as Home. This **is** the "AI recommendations"
  line item from the roadmap doc — a real signal-based scorer, not a new LLM call. No genuine
  natural-language "AI Concierge" was built or attempted; that would be this codebase's first
  actual LLM integration and needs its own explicit review (cost, latency, prompt-injection
  surface via user-generated gathering titles/descriptions), not a silent addition here.
- Existing working functionality preserved during the rebuild: the "Tonight" / "This Weekend"
  quick-shortcut cards (→ `Gatherings` with `initialDateFilter`) and the Gathering Memories /
  Public Stories Near You sections are all still present, unchanged in behavior.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through: unified search across all four types, the type filter chips, list↔map toggle, Places
  category chips with real location, and confirm the Recommended section's reasons render
  correctly, on both iOS and Android.

## Outstanding: Create Flow (guided multi-step wizard)

Closed against the same Aug 7 2026 external roadmap doc as Discover — its vision for Create was
What do you want to do? → Choose activity → Date & time → Location → Public/private → Invite
friends → Preview → Publish (8-10 screens). What existed before this pass: `CreateHubScreen.js`
(a simple link hub, already covers "what do you want to do") → single-screen
`CreateGatheringScreen.js` with every field crammed onto one form, no preview, no invite step.
**Core build is done and committed; not yet manually tested in a running app** — same standing
caveat as every other entry here: verified via `@babel/core` compile and a full
`npx expo export --platform ios` (1823 modules, clean), not a simulator/device run.

- Found a real, pre-existing, unrelated bug while reading this screen for this exact gap:
  `CreateGatheringScreen.js` line 35 had `uuseEffect(() => {...})` — a typo'd `useEffect` call.
  `uuseEffect` is not a defined identifier, so this threw a `ReferenceError` on every render —
  **the entire "Host a Gathering" flow was crashing in production** before this fix, unrelated
  to the wizard work itself. Fixed as a one-character-prefix deletion.
- `CreateGatheringScreen.js` rebuilt into a real 4-step paginated wizard (single screen, local
  `step` state + a dot/label progress row, not 8 separate nav routes — a guided flow needs a
  guided *sequence*, not necessarily 8 distinct screens/routes, and this avoids adding 7 new
  routes for what's fundamentally one form's worth of state):
  1. **What** — title, description, category chips (unchanged fields, moved here)
  2. **When** — date/time picker, repeat cadence (unchanged fields, moved here)
  3. **Where & Who** — location picker, public/private, map visibility (private-only), women-only
     (unchanged fields, moved here)
  4. **Preview** — new: a real read-only summary card (category icon/color, formatted date +
     repeat cadence, location status, public/private + map-visibility copy, women-only flag)
     rendered from the same state that's about to be submitted — nothing invented, no
     placeholder numbers. Publish button here calls the same `createGathering()` as before.
  Per-step validation gates `Next` (title required on step 1, future date required on step 2),
  matching the original form's validation, just moved to the step where each field lives.
- **"Invite friends" was deliberately not built as a step.** While scoping this, found that
  `notifications.js`'s `case 'gathering_invite':` (push-tap routing) is dead code — nothing
  anywhere in the codebase, client or migrations, ever sends a notification of that type. There
  is no `notifications` table, no gathering-invite table, and no trigger/edge-function wiring
  for it; `supabase/functions/send-push` exists but nothing calls it for this. Building a real
  "invite a specific friend to this gathering" feature needs new schema + RLS + a real delivery
  path (push and/or in-app), which is a distinct, fully-scoped feature in its own right — not
  something to fake with a friend-picker UI that doesn't actually notify anyone. Treat as its
  own future gap, same category as the AI Concierge and unified Map Experience noted above.
- **Not done yet**: no manual run-through in a simulator/device. Next session should click
  through all 4 steps including Back navigation, the location picker round-trip (step 3 →
  `SelectGatheringLocation` → back, confirming step state survives), and Publish, on both iOS
  and Android.

## Outstanding: Gathering Hub ("What happens after you tap Join?" redesign)

Closed against a third user-supplied vision doc (forwarded email, Jul 30 2026) describing a
live, day-of "Gathering Hub" experience that replaces the old `Alert.alert("You're In!")`
dead end. Core build is done and committed; **not yet manually tested in a running app** —
same caveat as the Gathering Detail Screen entry below. Verified: every touched file compiles
via `@babel/core`, a full `npx expo export --platform ios` (1823 modules) built clean, and the
new schema/RPCs were applied to production (`enmosvippabmuqslzrox`) and exercised directly
against the live database via `set_config('request.jwt.claims', ...)`.

- New `src/screens/GatheringHubScreen.js` + `GatheringHub` route (`RootNavigator.js`), distinct
  from `GatheringDetailScreen` for the same reason Detail was split from the list last pass:
  Detail's job is persuading you to join; Hub is the live experience for people already in.
  Joining a public (auto-approve) gathering from Detail now does
  `navigation.replace('GatheringHub', { gatheringId, justJoined: true })` instead of just
  reloading in place — Hub shows a 2.2-second "You're In! 🎉" banner (`setTimeout`, no new
  screen/route needed for it) before revealing the full hub. Host-approval gatherings still land
  on Detail's pending panel, since there's nothing live to enter until approved. Already-approved
  visitors to Detail now get an "Open Gathering Hub →" button (promoted to primary CTA; "Say
  Hello" demoted to a secondary link under it). Also wired from `GatheringsScreen`'s attending
  tab (replaces the old per-card "Group Chat" button, since Hub's own Group Chat entry covers
  that) and hosting tab (added alongside the existing Group Chat button, so hosts can check
  who's on their way/checked in without losing direct chat access).
- **Who You'll Meet**: up to 5 fellow approved attendees, each showing *every* true honest fact
  that applies (stacked, not just the first match — matches the vision doc's own example, where
  Sarah gets both a shared-interest line and "First time here" at once): real shared-interest
  overlap (`profiles.interests` intersection, same pattern as `compatibility.js`/
  `ChatScreen.js`'s existing shared-interest suggestions), the existing
  `getFirstTimerAttendeeIds()` flag, and for the host specifically "Organizer" plus a real
  `getHostStats()` "Hosted N gatherings" line (same RPC already shown on Detail). Falls back to
  "Going to {title}" only when nothing else applies. The vision doc's "Lives nearby" line for
  non-host attendees was **not** built — checked live, `profiles` has no lat/lng/location column
  at all, so there is no real per-attendee proximity signal to draw from.
- **Ice Breakers**: static, category-keyed conversation starters
  (`src/constants/gatheringHubContent.js`) — deliberately not a real AI/LLM call, same
  no-new-API-cost tradeoff already made for Home's `getHomeInsight()`. Tapping one deep-links to
  `GatheringChat` with a new `draftText` route param that prefills the message input (small
  addition to `GatheringChatScreen.js`) rather than sending on the user's behalf.
- **Checklist ("Before You Go")**: real weather via the existing `getSocialForecast()` RPC
  (reusing `getGatheringById`'s already-fetched `get_gathering_distances` fuzzed coordinates —
  no extra query) plus static, category-keyed prep tips (same constants file). The vision doc's
  "parking available" line was **not** built — no real parking-availability signal exists
  anywhere in this codebase, and a generic tip can't honestly claim it without becoming a
  fabricated per-venue fact.
- **Meet-Up Point**: a real single-pin map using the gathering's actual `precise_lat/lng` —
  previously never exposed to the client at all (`SAFE_GATHERING_FIELDS` deliberately excludes
  it; the app has only ever shown fuzzed coordinates, per `GatheringsMapView.js`'s own comment).
  New SECURITY DEFINER RPC `get_gathering_meetup_point()` (in
  `20260807_gathering_hub.sql`) returns the exact coordinates only to the host or an approved
  attendee of that specific gathering — a narrow, honest-need exception to the fuzzing rule,
  not a change to it. Verified live: an approved attendee gets real coordinates back, an
  unrelated user gets an empty result set.
- **"I'm On My Way" / "Who's Here"**: two new nullable timestamp columns on
  `gathering_interest` (`on_my_way_at`, `checked_in_at`), set via two new SECURITY DEFINER RPCs
  (`set_gathering_on_my_way`, `check_in_to_gathering` — no self-UPDATE RLS policy was opened,
  matching this codebase's existing avoidance of broad client UPDATE access on a table that also
  holds `status`/`match_id`). **These are self-reported taps, not GPS verification** — tapping
  "I'm On My Way" just records a timestamp and shows fellow attendees a count. Checking in
  switches the checked-in user's own view into a minimal "during the gathering" mode (Have fun 🎉
  / Who's Here count / Say Hi / Questions / Photos), matching the vision doc's "put the phone
  away" framing.
  **Deliberately not built**: the vision doc's Uber-style "Live Mode" (continuous location
  sharing, an actual ETA countdown, GPS-verified arrivals). This codebase has no directions/ETA
  API integrated anywhere, and continuous location sharing between attendees who haven't met
  yet is a materially different privacy posture than the fuzzed-coordinates-only approach used
  everywhere else in the app. Treat real GPS-based ETA/arrival tracking as a distinct future
  feature requiring its own explicit review, same category as the "verified visits" billing
  metric noted below — not something to bolt on here.
- **Post-gathering "what's next"**: `GatheringFeedbackModal` now has a second step after
  submitting feedback — "Anything you'd like to do next?" with Coffee / Dinner / Another walk
  chips (reusing the exact category tags `getQuickPrompts()` already maps those same labels to
  in `timeContext.js`, so they prefill `CreateGathering` the same way Home's quick-action chips
  do) plus "Join next week" (browses `Gatherings`). Requires a new `navigation` prop, now passed
  from both its call sites (`HomeScreen.js`, `GatheringHubScreen.js`); skips straight to closing
  if no `navigation` prop is given, so nothing breaks for any caller that doesn't pass one. The
  vision doc's exact rating copy ("Did tonight make your day better?" / Absolutely / Yes) was
  **not** substituted in — the modal's existing "How was it?" four-option scale (loved it/good/
  okay/not for me, from an earlier pass) is a different, already-human-framed question, and
  changing its wording wasn't attempted since the wording doesn't feed `get_host_reputation`
  (that RPC reads `felt_welcoming`/`would_attend_again` from the separate inline
  `GatheringFeedbackPrompt` widget, not `satisfaction_rating`) — no functional coupling, just an
  intentionally unmodified pre-existing question left as the user finds it. Revisit only if the
  literal copy actually matters to whoever's reading this.
- Two real, pre-existing bugs found and fixed while building this (unrelated to the feature,
  same pattern as the duplicate-import fix from the Gathering Detail pass):
  - `SelectGatheringLocationScreen.js` had a leftover `Alert.alert('DEBUG', ...)` firing on
    every render — was popping a debug alert every single time a host tried to set a custom
    gathering location.
  - `GatheringFeedbackPrompt.js` (the inline 👍/👎 prompt on past attending gathering cards) was
    calling `submitGatheringFeedback(gatheringId, feltWelcoming, wouldAttendAgain)` with two
    positional booleans, but the function's actual signature takes a single options object
    (`{ feltWelcoming, wouldAttendAgain, ... }`). Destructuring a bare `true` off that silently
    produced `{feltWelcoming: null, wouldAttendAgain: null}` — every submission through this
    specific prompt (not the richer `GatheringFeedbackModal`) was recording empty feedback.
- **Not done yet**: same as Gathering Detail — no manual run-through in a simulator/device.
  Next session should click through: join a public gathering from Detail (banner → full hub),
  tap an ice breaker (chat prefill), tap "I'm On My Way" then "check in" (minimal mode), and
  the post-feedback "what's next" chips, on both iOS and Android.

## Outstanding: Gathering Detail Screen ("Can I see myself here?" redesign)

Closed against a second user-supplied vision doc — this one about what happens after tapping
into a single gathering. Core build is done and committed; **not yet manually tested in a
running app** (no simulator/device session run this pass), so treat as "should work, verify
before considering this fully closed."

- The vision doc assumed an immersive full-screen "you tapped in" experience. That screen
  **did not exist at all** before this pass — gatherings only ever expanded in place inside
  the `GatheringsScreen.js` FlatList rows (still true, left alone). Confirmed with the user
  that the right move was a real dedicated screen, not a bigger expand-card, since several
  vision-doc pieces (a true full-bleed hero, a distinct post-join state) can't work as an
  in-list expansion.
- New `src/screens/GatheringDetailScreen.js` + `GatheringDetail` route (`RootNavigator.js`),
  reusing the same `headerTransparent` full-bleed pattern already established by
  `Gatherings`/`CommunityDetail`. Wired from every existing entry point that names a specific
  gathering: the title/host row on all three `GatheringsScreen` tabs (nearby/attending/hosting),
  all three map-view marker taps (previously just `Alert.alert` summaries — replaced with real
  navigation, net simplification), and Home's `bestPick` card (previously navigated to the
  generic `Gatherings` list with **no gathering id at all** — now deep-links to the specific
  gathering).
- Sections, each backed by real data, no invented numbers (same convention as the Home
  redesign's `bestPick`/`weeklyRecap`):
  - **Hero**: true full-bleed `cover_photo_path` image; a category-colored/icon fallback block
    (not a stock photo) when a gathering has none.
  - **"Why this fits you"**: `getGatheringFitReasons()`, a new shared pure function in
    `services/gatherings.js`. This *replaces* the reason-scoring logic that used to live only
    inline inside `homeDashboard.js`'s `bestPick` block — Home's best pick now calls the same
    function, so the two surfaces can't drift. Net behavior change on Home: `bestPick` reasons
    can now also include "Beginner friendly" (real flag, wasn't scored before); first-timer
    count is intentionally *not* computed for Home's pick (would mean an extra query per
    candidate gathering just to rank one) — only the detail screen, for its single gathering,
    computes that.
  - **Who's Going**: real avatars/names, plus an honest first-timer count via new
    `getFirstTimerAttendeeIds()` — someone who has zero other *past* approved gatherings
    anywhere, derived from `gathering_interest` (which is already publicly readable for
    approved rows), not a new RPC. Vision doc's "N people coming alone" was **not** built —
    no real signal exists for it (no "attending together" concept in the schema) and this
    codebase's convention is to skip rather than fabricate.
  - **The Vibe**: `energy_level`/`conversation_level`/`group_size_feel` now render as an actual
    read-only 5-dot fill (matching `EditGatheringScreen`'s edit-mode picker's low/high labels —
    "Chill ↔ High energy" etc.) instead of the plain "Energy 3/5" text badge that's still used
    in the in-place list-card expansion.
  - **Timeline**: `timeline_steps` now render with a connector-dot visual instead of plain text
    lines (again, only on the new screen — the list-card version is untouched).
  - **Community Perk**: expanded `GatheringOfferBadge`'s single-line badge into a full card
    (title, business name, description) using the same `getGatheringOffer()` /
    `gathering_id`-scoped `brand_offers` row that already existed.
  - **Meet the Organizer**: `getHostStats()`/`getHostReputation()` (existing RPCs, previously
    only ever rendered on `ViewProfileScreen`) now also shown inline on the detail screen. Added
    **"What people loved"**: a new `getHostLovedTags()` in `services/gatherings.js`, aggregating
    the real `great_because` tag array across a host's past `gathering_feedback` rows (that
    table is publicly SELECTable per its RLS, so no new RPC needed) into e.g. "The people · Great
    conversations · The host". This is the honest equivalent of the vision doc's "what people
    loved" quotes — there is **no free-text field anywhere** in `gathering_feedback` (confirmed
    against the live schema), so literal testimonial quotes were not built; this is real
    aggregate categorical data standing in for them, most useful for a host with an established
    track record and correctly renders as nothing for a new host with no feedback yet.
  - **Questions**: reused `GatheringQnA` as-is.
  - **Join CTA**: big button, honest copy — "JOIN GATHERING" for `is_public` gatherings (real
    auto-approve), "REQUEST TO JOIN" for host-approval gatherings (was "I'm Interested" for
    both cases in the list-card flow, which is still true there — untouched, still valid).
    `GatheringIntentModal` gained a `confirmLabel` prop (default unchanged) so the two screens
    can each show honest, context-correct copy without duplicating the modal.
  - **Post-join state**: no more `Alert.alert("You're In!")` — the detail screen re-fetches
    after joining and renders a real in-screen "You're in! 🎉" panel with a "Say Hello" button
    that deep-links straight into `GatheringChat` for that specific gathering (the old Alert's
    "Send a Message" button went to the generic `Matches` screen, not the gathering's own
    chat — that gap is now closed, only on this new screen). Host viewers see a "you're hosting
    this" banner instead of a join button; pending (awaiting host approval) viewers see a
    plain status panel. No leave/cancel-request action was added — out of scope, doesn't exist
    in the list-card flow either.
  - Skipped per the "don't fabricate" decision: star-rating widgets (reputation is real
    percentage text, not a 0–5 star signal the schema doesn't have) and the vision doc's
    specific "you'll probably enjoy coffee afterwards, 6 attendees usually continue here" —
    no continuation/attendance-linking data exists to back a claim that specific.
- While verifying files before this build, found and fixed a real, already-committed bug
  unrelated to this feature: `RootNavigator.js` had a duplicate `import OnboardingQuestionsScreen`
  (two lines, same specifier) — invalid ES module syntax that would have failed to bundle at
  all. Introduced by commit `58478501`, whose own message claimed to *remove* a duplicate route
  but the diff shows it *added* this one — looks like a mismerge from an interrupted session.
  Fixed as a one-line deletion since it blocked the whole app, not just this feature.
- **Not done yet**: no manual run-through in a simulator/device this pass. What *was* verified:
  every touched file compiles via `@babel/core`, a full production Metro export
  (`npx expo export --platform ios`, 1821 modules) built clean with no resolution errors, and
  every new/changed Supabase query shape (the `getGatheringById` joins, `getFirstTimerAttendeeIds`,
  `getHostLovedTags`) was run directly against the live production schema to confirm the
  columns/foreign keys/RLS assumptions are real, not just plausible-looking. What's still
  unverified is purely visual/UX: next session should launch the app and click through —
  tap-in from all three `GatheringsScreen` tabs, the Home best-pick card, and both a public
  and a host-approval gathering's join flow — to confirm the layout and the post-join panel
  actually look right, not just that the code runs.

## Outstanding: Billing / Monetization (contract + invoice generation + scheduling now live, Stripe still not started)

The brand-matching business model (businesses offer targeted, quantity-limited discounts;
redemptions are tracked; a "spread"/commission is the intended revenue model) now has real
per-partner billing math running end-to-end on a schedule, but no money actually moves yet:

- The WHEN design decision is resolved: billing is monthly/batched, not per-redemption
  real-time. `supabase/migrations/20260806_partner_contracts_billing.sql` adds
  `partner_contracts` (per-partner `billing_model`: per_redemption/flat_monthly/hybrid/custom,
  with rates, contract dates, `max_monthly_spend` cap, `auto_renew`) and
  `generate_monthly_invoices()`, a SECURITY DEFINER function. It locks that partner's unbilled
  `offer_redemptions` rows (`FOR UPDATE`, following the codebase's race-condition convention),
  sums them per the contract's billing model, writes a row to `business_invoices` (status
  `draft`), and stamps each redemption with `invoice_id` so it's never double-billed. `custom`
  contracts insert with `amount_due = 0` (not `null` — the column is `NOT NULL`) for finance
  to correct by hand while still in `draft`.
  **Applied to production** (`enmosvippabmuqslzrox`) and verified against the live schema —
  `business_invoices` already had matching `period_start`/`period_end`/`redemption_count`/
  `amount_due` columns from an earlier session.
- `20260806_schedule_monthly_invoices.sql` schedules it via `pg_cron` (already installed and
  in use for 8 other jobs, e.g. `send-match-reminders`) as job `generate-monthly-invoices`,
  `0 6 1 * *` (06:00 UTC on the 1st, billing the just-closed prior month, the function's
  default period). Runs as `postgres`, which owns the function, so the function's own
  `revoke all` (correctly there to stop client-side calls) doesn't block the cron invocation.
  **Also applied and verified live** (`cron.job` id 9).
- `getEstimatedAmountOwed()` in `src/services/brandOffers.js` now calls
  `get_partner_billing_estimate()` (same math as the invoice generator, run against the
  current open month) instead of the old flat $3/redemption placeholder. Returns
  `{ redemptionCount, estimatedAmount, billingModel, includedUnits, billableCount }`;
  `billingModel` is `null` when the partner has no active contract yet.
  `BusinessDashboardScreen.js` shows this in the insights tab, gated on `billingModel` being
  present and not `'custom'`, and calls out how many of the included allotment have been used.
- `partner_contracts.included_units` (added in `20260807_billing_included_units.sql`, default
  0) lets `per_redemption`/`hybrid` contracts include N free redemptions before the per-unit
  rate applies — e.g. "100 included, $0.75 each after" — instead of billing from redemption
  #1. Both billing functions compute `billable_count = greatest(count - included_units, 0)`
  and multiply that by `redemption_fee`, not the raw count. `flat_monthly`/`custom` ignore it.
- Fixed a real bug in both billing functions (`20260807_billing_contract_window_bound.sql`,
  applied and verified live): the redemption lookup was bounded only by the invoicing
  period, not by the contract's own `contract_start`/`contract_end`. A contract starting
  mid-month would have swept in — and permanently stamped `invoice_id` on — redemptions
  from before it existed; one ending mid-month would do the same for redemptions after it
  lapsed. Now both clip the window with `greatest(period_start, contract_start)` /
  `least(period_end, coalesce(contract_end, period_end))` before aggregating. Didn't show
  up in the Coastal Coffee verification below since that contract is open-ended and
  predates all its redemptions — re-verified $20.00/0-redemptions unaffected after the fix.
- One test contract exists: partner **Coastal Coffee** (`67dd3d6d-f36b-4b20-8a80-ac980baecc30`),
  contract `787d5b41-...`, `hybrid` billing, `$20/month` + `$1/redemption`, `included_units: 0`,
  open-ended, `auto_renew: true`. Verified end-to-end (simulating the real caller via
  `set_config('request.jwt.claims', ...)` since the Management API has no user session) —
  returns `$20.00` with 0 redemptions so far this month, as expected.
- No other `partner_contracts` rows exist, and there's deliberately no self-serve UI to
  create one (finance/ops decision, written via the SQL editor/service role or a future admin
  tool). Nothing will actually get invoiced for other partners until a contract is created by
  hand.
- Pricing philosophy note (from a strategy discussion, not yet decided as final policy):
  billing by raw redemption count is what's actually instrumented today; a "verified visits"
  metric (join gathering + GPS/check-in + dwell time or QR scan) was floated as a better
  long-term metric but requires building attendance/check-in verification that doesn't exist
  yet — treat that as a distinct future feature, not a pricing tweak.
- Still missing before this is real billing: no Stripe integration at all (no account
  connection, no webhook handler, no actual charging, no dispute/refund handling). Invoices
  will sit in `draft` with nothing downstream until that's built.
- A Supabase Management API access token lives in `.claude/mcp.json` (gitignored) — that's
  what made direct schema inspection and migration application against the live project
  possible from inside a Claude Code session; project ref is `enmosvippabmuqslzrox`
  (see `src/services/supabase.js`).

## Recently completed, for context (do not re-build)

- Home screen "dream redesign" gaps, closed against a user-supplied vision doc (checked
  feature-by-feature against actual code first — several items in the doc were already partly
  built under different names, e.g. "Continue Your Story" ≈ existing "Continue Your Community"):
  - **Happening Now**: `getHomeDashboard()` in `homeDashboard.js` now also returns
    `happeningNow` — gatherings from the same already-fetched `nearbyGatherings` list whose
    `scheduled_at` falls in [-30min, +2h] around now (no end-time field exists on gatherings,
    so "in progress" is approximated). Rendered as a horizontal chip row using
    `categoryStyleFor()` for icons, no extra query.
  - **Time-of-day quick actions**: `getQuickPrompts()` (already existed in `timeContext.js`,
    previously only surfaced one layer deep inside `StartSomethingModal`) is now also rendered
    directly on Home as a visible chip row under a period-aware header (`Good Morning` /
    `This Afternoon` / `Tonight` / `This Weekend`). Tapping a chip either deep-links straight to
    `CreateGathering` with a prefilled title/category, or — for the one prompt with sub-options
    (`Dinner` → Pizza/Mexican/etc.) — opens `StartSomethingModal` pre-set to that category via
    a new `initialCategory` prop, reusing the modal's existing decision tree instead of
    duplicating it. `StartSomethingModal`'s `SUB_OPTIONS` map is now exported so Home can check
    membership without hardcoding which labels have sub-menus.
  - **One AI sentence**: deliberately **not** a real LLM call — `getHomeInsight()` in
    `homeDashboard.js` is a pure, no-I/O function that picks one honest sentence from signals
    the dashboard already computed (friends making plans → best pick exists → good weather
    forecast → things happening now), in that priority order, returning `null` if none apply.
    This was an explicit tradeoff discussed with the user: no new Edge Function, no API key,
    no per-request cost, and it matches this file's existing "no invented numbers" convention
    (see `getHomeDashboard()`'s own comments on `bestPick`/`weeklyRecap`/`sinceAway`) rather than
    introducing a genuinely novel-but-untethered-from-reality text generator.
  - **"You have N opportunities" greeting line**: reuses the already-computed
    `gatheringsTodayCount`, not a new number — only shown when > 0, period-aware wording
    ("today" / "tonight" / "this weekend").
  - **Floating action button**: the "+ Start Something" button moved from an inline
    scroll-flow button to a real `position: 'absolute'` FAB pinned bottom-right over the
    ScrollView (matching the existing bottom-anchored-bar pattern already used in
    `DiscoveryScreen.js`), with extra `paddingBottom` added to the scroll content so the last
    card isn't hidden behind it.
  - Deliberately left alone: the "92% Match" hero-card framing and "unlocked because 8 members
    joined" perk copy from the original vision doc were **not** built — both would require
    fabricating numbers the codebase has no real signal for, which conflicts with the
    established convention throughout `homeDashboard.js` of never inventing a metric.
- Gathering detail redesign: three schema pieces (`20260807_gathering_detail_vibe_and_photo.sql`,
  `20260807_gathering_questions.sql`, `20260807_gathering_intents.sql`, all applied and
  verified live) plus full frontend wiring, built in one pass after a codespace restart
  interrupted the session partway through (schema files existed but were unapplied and
  completely unwired — this closed that gap):
  - `gatherings` gained `energy_level`/`conversation_level`/`group_size_feel` (1-5, nullable),
    `beginner_friendly` (default `true`), `timeline_steps` (jsonb array, max 8, `{time, label}`),
    and `cover_photo_path` (private `gathering-photos` storage bucket, host-only upload,
    `${gatheringId}/cover-*.jpg` path convention matching the `profile-photos`/`stories`
    RLS-by-folder pattern). Editable via `EditGatheringScreen.js` (1-5 tap-to-select scale
    pickers, a beginner-friendly `Switch`, an add/remove timeline step list, a cover photo
    picker reusing the `photos.js` base64-upload pattern — `fetch().blob()` silently produces
    0-byte files on iOS for local file URIs, so this stays on `FileSystem.readAsStringAsync`
    + a hand-rolled base64 decoder like the other upload paths). Displayed on gathering cards
    in `GatheringsScreen.js` (cover photo always shown when present; vibe/timeline behind a
    new "Details & questions" expand toggle on nearby cards, folded into the existing expand
    section on attending cards, always-visible on hosting cards).
  - `gathering_questions`: public Q&A, anyone can ask, only the host can answer (`GatheringQnA.js`,
    a shared component mounted with `isHost` toggled per tab — `nearby`/`attending` pass `false`,
    `hosting` passes `true` unconditionally since that list is already scoped to the caller's
    own gatherings). Both ask and answer run through `checkTextModeration` first, matching the
    rest of the codebase's text-input conventions.
  - `gathering_intents`: the private pre-join "what are you hoping for tonight?" signal —
    deliberately **never surfaced to the host**, not even in aggregate (no such RPC exists;
    don't add one without a separate explicit review, per the migration's own comment).
    `GatheringIntentModal.js` intercepts both "I'm Interested" entry points (the nearby-tab
    button and the map-view marker alert) before the existing `handleExpressInterest` fires,
    and pre-fills a user's previous answer via `getMyGatheringIntent` so re-opening it isn't
    a blank slate. Saving the intent never blocks joining — failures are swallowed with a
    console log, same as the existing post-gathering feedback modal's philosophy.
- Full security audit: RLS on every table, all Edge Functions, all storage buckets, 38+
  functions found with unintended PUBLIC/anon execute access (fixed), several race conditions
  in rate-limiting triggers fixed with `SELECT ... FOR UPDATE`.
- Navigation restructure: Profile → "You", Places (Google Places-powered), real Trending,
  Inbox split into Requests/Invitations/Reminders, two-step quick-create flow.
- Stories redesign: gathering-linked stories, differentiated expiry, host + fellow-attendee
  visibility on both the table and storage bucket RLS.
- Full onboarding redesign: landing screen, preference questions, immediate recommendations,
  post-gathering feedback loop, "first mission" + real scheduled follow-up reminder, earned
  profile stats.
- Brand-matching vision: quantity-limited offers (`redemption_limit`), interest targeting
  (`target_interest_tag`), location scoping (`brand_partners.latitude/longitude`, 50-mile
  radius via `get_nearby_offer_ids`), real shared-interest suggestions for both 1-on-1
  matches (`ChatScreen.js`) and group gatherings (`GatheringChatScreen.js`), scarcity count
  display, business-side redemption visibility.

## Known conventions in this codebase

- `trusted_update` pattern: privileged profile columns (is_premium, managed_partner_id,
  *_created_today/date counters, etc.) are protected by `prevent_self_premium_edit()` trigger;
  legitimate server-side writes must call
  `perform set_config('app.trusted_update', 'true', true)` first.
- Rate-limit triggers use `SELECT ... FOR UPDATE` on the profiles row to avoid race conditions.
- New Postgres functions default to PUBLIC execute access — always explicitly
  `revoke ... from public, anon` unless intentionally public.
- Direct SELECT on `offer_redemptions` is scoped to each user's own rows only (RLS) — always
  go through a SECURITY DEFINER RPC (e.g., `get_offer_redemption_counts`,
  `count_redemptions_since`) to get true aggregate counts.
