# Nearby — Project Instructions

Nearby is a proximity-based dating/social discovery app (React Native/Expo, Supabase backend).
Supabase project ref: `enmosvippabmuqslzrox`. A Management API access token lives in
`.claude/mcp.json` (gitignored) — used via direct `curl` against
`https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query` for schema
inspection/migration application, since the Supabase MCP server itself has not been reliably
available via ToolSearch in past sessions.

## Read this first — how this file is organized (2026-09-17, trimmed 2026-09-18)

This file once grew to 30k lines / 2.46MB of per-session build logs and stalled sessions on
compaction. The full historical record now lives, unedited, in **`CLAUDE_HISTORY.md`**
(reverse-chronological; grep by date or "Item NNN"). Open it only when you need the reasoning or
verification trail behind an already-shipped feature — not "just in case."

**Standing rule:** keep this file to a few hundred lines. When a plan/phase finishes:
(1) append its full verbose account to the *top* of `CLAUDE_HISTORY.md`, (2) leave only a short
status line under "Active / unfinished work", (3) fold any new locked convention into "Standing
Conventions" as one bullet, not a narrative.

## Active / unfinished work

Nothing in progress. Everything through **Item 148** (business notification mute groups in `send-push`, web dead-button fix; 147 business email-notification fallback in `send-push`, inert until Resend secrets are set; 146 budget in the Plan read layer, `plans.budget_min`; 145 standalone gatherings + business requests in the Plan read layer, `get_plan_id_for_resource`; 144 dating match + friend connection get a Plan, `get_plan_id_for_match`; 143 participants can open group Plan detail via `get_plan_id_for_group_plan`; 142 plan detail screen on the read layer; 141 universal Plan read layer, `get_plan_overview`; 140 skippable onboarding occasions step; 139 Friends/Dating notification split; 138 onboarding notification prefs; 137 animation audit) (2026-09-18) is done and archived in
`CLAUDE_HISTORY.md` (top section, "Full Active / unfinished work archive" — grep by "Item NNN").
Recent arc for orientation: Items 61-111 Occasions/"Plan for Someone" (wizard, group voting,
surprise mode, packages, recall, guest invites); Items 112-126 the Nearby Motion System
(`src/motion/`, motion language, Reduce Motion, tone per context, anticipation, Nearby Pick,
restrained list animation).

**Standing open item (device-only verification):** no simulator/device tooling has ever been
available, so all UI/animation/push work is unit-tested (Jest 600/600) and transform-checked but
never exercised on a real device. First session with device access should spot-check: motion
components with Reduce Motion on/off, pull-to-refresh, the N loader, tab/mode/filter transitions,
push tap routing, calendar export, and view-shot share cards.

Known disclosed gaps (not built, no ask yet): pre-filter of surprise-excluded person in
BusinessRequestDetail invite pickers (server enforces it); Cuisine as a browse filter; gathering-
destined occasion co-organizers; push for `plan_messages`; anon `is_match_participant` grant
error on `business_requests` reads (fails closed).

**State-machine audit (2026-09-19, `PRODUCT_AUDIT/STATE_MACHINE_AUDIT_2026-09-19.md`): gaps 1-4 (migration `20261210_reservation_plan_lifecycle`) 6 (`20261211_all_declined_outcome`) and 5 (`20261212_parent_plan_status_from_children`) FIXED and live: all audit gaps closed.** A cancelled primary reservation ends the request + Plan (+ fulfilled group
plan; the request does not reopen); completing one sets the Plan `completed`; the host can cancel a group plan in any non-terminal
state, cascading downstream and notifying participants; the occasion "Planned" badge follows the Plan's live status. Gap 6 is a derived
outcome (`utils/requestOutcome.js`, no stored status): the decline that leaves no live offer sends one `business_request_all_declined`
push and the detail screen shows a wider-radius banner; a last *withdrawal* shows the banner but sends no push. Gap 5: a trigger recomputes an `occasion` parent plan's status from its child plans (match plans deliberately excluded --
long-lived containers; group_occasion already follows its group plan). Cancellation reason analytics (`20261213_cancellation_events`): every root cancel (reservation, request, gathering, occasion group plan)
is recorded automatically in `cancellation_events` (cascades not double-counted); the reason is OPTIONAL, asked after the cancel via
`CancellationReasonSheet` -> `set_cancellation_reason` (never gates a cancel); the business owner sees aggregates in the dashboard's
"Cancelled Reservations" (`get_partner_cancellation_patterns`), owner-visible insight only, never auto-reweights matching. `cancel_community` and legacy `cancel_group_plan` record too (`20261214`); `stopRecurringSeries` only sets a flag, deliberately not
recorded. Nothing else open from this audit. Not exercised on real data (prod has no reservations).

**Progressive personalization (2026-09-19, requirement: onboarding sets up the engine; explicit > behavior early, blended later).**
The five signal classes already existed as `signalSourceMaturity.js` (explicit/contextual never dampened; behavioral/social/
transactional scaled by account maturity). New: a private behavioral signal (`behavior_events`, `20261215`: open/create/join per
canonical category; owner-only RLS, RPC-only writes, 1h dedupe, 90-day window, Settings "Clear my activity history", never read by
businesses, guarded by `behaviorPrivacyGuard.test.js`) and `src/constants/blendedRanking.js` (explicit 5 pts > behavior max 4,
behavior x maturity). `usePersonalization()` feeds Gatherings Nearby + For You (`rankByBlend`/`forYouBlend`) and Discover
(`behaviorNudge` on `fit.score`). Home already used the maturity model. No "save" feature exists, so saves are not tracked (build the
surface first). Social/transaction signals are unchanged (already in the resolver / positive-experience signals). Not device-tested.

**Onboarding flow reshaped (2026-09-19, requirement: onboarding leads naturally into the product).** Welcome -> "What do you want Nearby
to help you do?" (6 goals, multi-select, `constants/onboardingGoals.js`) -> "What are you into?" (groups, then favorites) -> "What are you
looking for?" (Dating / Friends / Both / Skip) -> relevant preferences (comfort; every step skippable, with Back) -> Location -> "What should
Nearby keep you posted about?" -> account -> "You're ready ... Let's see what's happening nearby ->". Goals and looking-for are stored in the
existing `onboarding_motivations` (looking-for as the tokens 'Go on dates' / 'Make new friends' that People sub-mode and Friend Discovery
already read; no schema change). The celebrations step now shows only for people who picked "Plan celebrations". Home now reflects the goals: a "What you're here to do" shortcut
row above Quick Picks (`goalShortcuts` in `onboardingGoals.js`, `useMyGoals`), one chip per picked goal to an existing screen (Discover people/things,
MakeAPlan, Places, CelebrateSomething, BrandOffers); nothing renders for anyone with no saved goals. Goals are editable in Settings ("What you're here to do", saves per tap via `motivationsWithGoals`, keeps looking-for tokens); Home refetches on focus. Not device-tested.

**Onboarding wiring audit (2026-09-19, `PRODUCT_AUDIT/ONBOARDING_WIRING_MATRIX_2026-09-19.md`):** matrix of every onboarding input vs its consumers. Fixed two orphans (the UI-only location options; comfort level now also ranks the Gatherings feed). Follow-up: picked interest groups are saved as `profiles.interest_groups` (`20261216`) = a weak broad signal (2 pts vs a declared tag's 5), never expanded into tags; editable in Settings; ranks Gatherings/For You/Discover/Home recommendations only.

**"Demand near you" (2026-09-19, first business-signal-loop increment; migration `20261217_partner_demand_signals`, live):** one card at the top of the business dashboard (also in the web export) from `get_partner_demand_signals` -- EXPLICIT demand only (`business_requests` + `intent_submissions`; never behavior/impressions/raw text), a signal returns only when >= 5 DISTINCT people back it (person counted once across requests+searches), owner-only, only the business's own categories, geography = Match Radar's rules (requester radius / 3x3 `wide_area`), 14-day window. Category rows add a party-size bucket and budget range only when each independently clears the floor; occasion rows come from requests. Each row's action reuses an existing flow (category -> Post availability, occasion -> Create package). Below the floor the card says it is still gathering activity. `intent_submissions.party_size` added (written from `classifyResult.partySize`). Verified live with disposable rolled-back data (threshold, owner check, radius, business_partner searches excluded, dedupe). Guards: `demandSignals*.test.js`. Known gap, disclosed: the older "Match Radar" / "What They're Planning" sections still show counts under 5 (no privacy floor) -- not changed here. Not device-tested.

**Full from-scratch Docker replay (2026-09-19):** all 209 migrations (through `20261215_behavior_events`) applied cleanly to an empty
`supabase/postgres:15.1.0.147` public schema with `ON_ERROR_STOP`; every function touched this session has exactly one overload, both new
tables/the parent-plan trigger exist, and the public function count matches production (364 = 364).

## Backlog (v2 candidates — not started, do not build without a direct ask)

Deliberately out of scope for "Group planning for an Occasion" (archived in CLAUDE_HISTORY.md) per the user's own
explicit v1 guardrail — the killer loop is Remember → Plan → Invite → Find something → Connect
business → Do it, and these would each turn it into a "giant event-management platform" the user
specifically said not to build yet:

- Complex RSVP systems (beyond the current plain invited/joined/declined on
  `occasion_group_plan_participants`)
- Elaborate invitations (custom invite text/design, themed invite cards, etc.)
- Gift registries
- Seating charts
- Massive event pages (a dedicated rich event-detail surface beyond `GroupOccasionPlanScreen`'s
  current lean voting view)
- Complicated calendars (recurring sub-events, multi-day itineraries, etc. — beyond the single
  `scheduled_date` the occasion already has)

**Pending user action (not a build item):** connect Resend so the business email fallback (Item 147/148) actually sends.
Needs the user: verify a sending domain in Resend, create a Sending-access API key, then set Edge secrets `RESEND_API_KEY`,
`EMAIL_FROM` (verified domain), optional `BUSINESS_WEB_URL` via `supabase secrets set --project-ref enmosvippabmuqslzrox`
(user runs it themselves; never paste the key in chat). As of 2026-09-19 none are set; the feature is inert and the dashboard
card says so. Verify by listing secret NAMES only via the Management API `/secrets`, then the user adds an address in the
dashboard card and confirms the 6-digit code (the only real end-to-end test).

## Standing Conventions (Locked)

These are the load-bearing rules distilled from thousands of lines of prior build history. Full
original reasoning/citations for any of these: `CLAUDE_HISTORY.md`.

- **No invented numbers, no fabricated signals, ever.** Every metric/count/reason shown anywhere
  in the app must trace to a real query result. An absent signal renders as an honest empty
  state, never a guessed placeholder.
- **The Nearby Motion Language (locked 2026-09-18, `src/constants/motionLanguage.js`).** A fixed
  6-glyph vocabulary for animation/loading/celebration moments: N (NearbyMark) = system
  intelligence (loading/searching/finding/matching/recommending); ✨ = discovery/recommendation
  (a transition beat, not a standalone icon); ❤️ = romantic connection (a dating match); 🤝 =
  platonic connection (a friend match, an organizer relationship — this app's own pre-existing
  handshake motif, kept distinct from ❤️); 🎉 = celebration (occasion/plan/milestone); ✓ =
  completion (plan/reservation/request confirmed); 🔒 = privacy/surprise. Never reach for 🎉 as a
  generic "something good happened" glyph for a connection moment — that's what ❤️/🤝 are for.
- **Animation discipline (locked 2026-09-18).** Animations must reinforce meaning, hierarchy,
  state changes, or feedback — never "because we can." Every animated/celebratory moment must be
  short, subtle, interruptible, never gate or slow down a real button/action, and call
  `src/hooks/useReduceMotion.js`, collapsing to its final/settled visual state (content and
  meaning intact, motion only removed) when it returns true.
  Item 127 (2026-09-18) enforces this at the shared level: `src/motion/motionPolicy.js` holds the one
  Reduce Motion store and, installed at app start (`App.js`), turns every `Animated.spring` into an
  instant timing and every `Animated.loop` into a no-op while it's on; the stack navigator swaps to
  a plain fade. Prefer `Animated.timing` fades for new work; branch on `useReduceMotion()` only where
  the reduced state is different content (skip a morph/particle burst, drop a slide offset).
  Item 128: motion must work in both light and dark -- draw only with `useTheme()` tokens (never a
  hardcoded hex; `#fff` only over a fixed dark overlay/brand-coral surface), and any new token a
  motion piece reads gets a light+dark value guarded by `src/motion/motionThemeContrast.test.js`.
  Item 129: haptics accompany only IMPORTANT state changes, via the named beats in
  `src/motion/haptics.js` (`playHaptic`): match/friendAccepted = subtle light impact, success (plan/
  reservation confirmed, plan created, surprise revealed) = success notification. Never per-tap;
  independent of Reduce Motion; never call expo-haptics directly from a motion component.
  Item 130: haptics are for USER-INITIATED moments only. Motion components take an opt-in
  `haptic` prop (default false); pass it only when the animation is the direct result of the user's
  own tap. Arrival-driven states (realtime update, refocus discovery, a push) get the animation but
  no haptic, and `services/notifications.js` never touches expo-haptics -- a background push keeps
  normal OS notification behavior. Guarded by `src/motion/hapticsRespect.test.js`.
  Item 131: every transition is authored against the motion budget in `src/motion/motionBudget.js` --
  tiny 50-150ms (button/icon), small 150-300 (filters/tabs/cards), medium 300-500 (plan confirm, match),
  special 500-900 (occasion celebration, surprise reveal). Measured trigger -> settled state; holds
  and ambient loading loops are exempt. Sequence timings are `SEQUENCES` tokens shared by the
  components and `motionBudget.test.js`; nothing may exceed 900ms. New sequences add a token + test.
  Items 132/133 (loading language, two meanings): `NLoader` (N + brand sweep) = "Nearby is thinking/
  finding/matching" -- use `<NLoader fullScreen={false} size="compact|inline" kind=... | caption=... />`
  for search, recommendations, availability, discovery (kinds in `loadingLanguage.js`; captions narrate
  real work, never counts/percentages). `SkeletonFeed` (`src/motion/`) = "a known feed's content is
  loading" -- use for large lists of the user's own content (matches, friends, plans, timeline,
  activity, gatherings/people feeds, load-more footers) so the screen feels fast and doesn't jump.
  Plain `ActivityIndicator` stays only for in-flight feedback inside a button/footer control.
  Item 134: an empty state that carries a real next-step action uses `<FadeInState opportunity>` --
  the N appears, then the invitation + action settle in (medium tier). Only with a real tappable
  action (guarded by `emptyInvitation.test.js`); errors and private/admin/chat empties stay plain fades.
  Item 135: intent searches narrate their REAL phases (`runIntentSearch(text, { onPhase })`;
  `intentPhaseCaption()`: Understanding your request… -> Finding activities…/Finding communities…/
  Checking availability…), then `FoundLine` ("Here's what we found.") as results land. Phases are
  reported as the work actually moves, never on a timer -- no artificial delay for theater.
- **Preference wiring (2026-09-18, requirement; plan in `PRODUCT_AUDIT/PREFERENCE_WIRING_AUDIT_2026-09-18.md`).**
  Capture a preference once (onboarding where appropriate, progressive otherwise), store it once, and
  feed every consumer from that one value -- one canonical category/interest vocabulary (`PLACE_CATEGORIES`
  / `CATEGORY_GROUPS`), no per-feature category lists, no captured-but-unused fields.
- **Location is asked once, used everywhere (2026-09-18).** Device position comes only from `src/services/userLocation.js` (`getUserLocation`/`requireUserLocation`): permission checked once, fixes shared/cached, fallback to last-known then stored position; the app never asks the user where they are. Direct expo-location permission/position calls are allow-listed in `locationCentralGuard.test.js` with a stated reason each.
- **Notification area (2026-09-18).** Location-targeted pushes read `push_target_areas` (fresh presence, else the coarse ~0.7 mi `notification_areas` row, 48h TTL) -- never raw presence alone. The row is written only via `set_my_notification_area` from the central location provider's fresh fixes (`services/notificationArea.js`, throttled), is not presence, and is read by nothing user-facing. Any new location-targeted push trigger must join `push_target_areas`.
- **Animation consistency (Item 137, audit 2026-09-18).** All motion goes through `src/motion/`:
  durations are `MOTION_BUDGET`/`SEQUENCES`/`AMBIENT` tokens (no literal `duration: N`), native modals use
  `modalAnimation()`, list refresh uses `PullToRefresh`, layout changes use `animateLayout()` (small tier,
  snaps under Reduce Motion), pure confirmations use `showSuccessToast` not `Alert`. Guarded by
  `src/motion/consistencyAudit.test.js`. Left deliberately: chat "load older" footer spinners (footer
  control), StoryViewer's functional progress timer, PhotoLightbox/swipe-card physics springs.
- **Product personality (Item 136, guiding thesis, logged 2026-09-18): Nearby is quietly working for
  you -- never "here's a database."** The interface should say, in effect: *tell us what you want, we'll
  figure out the rest.* Use as a tiebreaker for copy, motion and flow: prefer intent-first entry
  points over browse-and-filter, narrate real work calmly (Item 135), turn empty results into an
  invitation (Item 134), lead with a reason/outcome instead of a raw list or count, and keep motion
  restrained (Items 122/126/131). Avoid database voice ("0 results," "no data," raw field labels).
  Companion to the intent-engine north star (Item 112); no build item of its own -- apply it to
  whatever is being touched. Aesthetic target: modern + polished
  + alive + restrained — a premium social product, not a children's app; no confetti-everywhere.
- **Motion intensity varies by context (Item 122, locked 2026-09-18).** Occasion-creation moments
  (a plan being born, a birthday/anniversary pick, a community going live) can stay fully
  playful/celebratory. A real business TRANSACTION confirming (an offer accepted, a reservation
  locking in) must feel fast + trustworthy + professional instead — reassuring, not festive.
  `SuccessAnimation`'s `tone` prop (`"celebratory"` default vs. `"business"`) is the mechanism:
  business tone skips the ✨ discovery beat, settles in roughly half the time, and drops the
  springy scale-pop for a plain settle. Same content/meaning either way — only the intensity
  changes with context. Apply this same judgment to any future animated business-transaction
  moment (a payment confirming, an offer being made), not just the two call sites fixed here.
- **Anticipation treatments are scoped to real countdowns, not added to every date (Item 123,
  locked 2026-09-18).** Use `AnticipationText`/`anticipationTier()` (`src/motion/`,
  `src/utils/anticipationTier.js`) only where a real `days_until`-shaped countdown already exists
  and the date itself is genuinely the point (an occasion reminder) — never retrofit a countdown
  onto a surface built to show an exact date (a reminder list, a plan's own date line). Discrete
  tiers derived from a real day count, not a fabricated progress percentage.
- **Calendar = when, Nearby = what + who + where + how (Item 76, locked 2026-09-13; narrow
  export exception added by Item 121, 2026-09-18).** Nearby may read device calendar context
  (Item 75) to inform suggestions, plans, occasions, and Surprise Me, but must never become a
  calendar-management surface itself -- no new "Calendar" screen/tab, no general event
  creation/editing, no calendar-app-shaped view, no browsing/CRUD of existing events. The one
  disclosed exception: a single "Add to Calendar" export of one already-real, already-confirmed
  Nearby commitment (e.g. a confirmed reservation) via `expo-calendar`'s
  `createEventInCalendarAsync` -- the native OS compose UI, where the user themselves reviews and
  taps Save, never a silent background write via `createEventAsync`. This is a one-way EXPORT of a
  single fact, not management; any future calendar-adjacent work should still read and suggest,
  never manage or silently write.
- **No dead ends (Item 56, locked 2026-09-12).** No major surface's empty state may be
  unactionable "nothing here" copy alone — it must offer a concrete, tappable next step to a real
  existing destination (create/adjust-filters/invite/explore-elsewhere, whichever genuinely fits),
  never a fabricated one. Applies to any new empty state a future change introduces, not just the
  surfaces already audited under Items 25/26/56.
- **Coral (`colors.primary`) = action, not decoration.** Tappable-and-advances-the-user → coral.
  Informational → must not visually impersonate a button. Destructive → `colors.danger`, never
  coral. Progress/data-visualization (a fill bar, an achievement indicator) → coral is fine when
  clearly non-interactive. Secondary actions (Cancel, dismiss) → neutral/outlined; coral is
  reserved for a surface's *primary* action. This visual system is frozen — no further
  consistency sweeps expected unless new work introduces a genuinely new pattern.
- **No stranger discovery via intent, ever — hard privacy rule.** Any "find things for you"
  resolver-shaped feature (Home's intent box, Business Fulfillment matching, group-intent
  signals, etc.) may only ever surface real supply (gatherings/communities/businesses) or people
  the caller is already connected to (accepted friend or match) — never proximity/interest-based
  surfacing of an unconnected stranger. Businesses are deliberately exempt (they're discoverable
  supply by design, not a privacy concern the way a person is).
- **AI never infers or assigns a specific date/time from free text.** A user always picks
  date/time through deterministic UI (preset buttons + a picker). AI may suggest title/category/
  location/description for confirmation, never silently commit a date/time guess.
- **AI suggests, never silently commits.** Every AI-derived value anywhere in the app is shown
  back for the user's own explicit confirmation before it's saved — this holds for every
  AI-classification feature in this codebase, no exceptions.
- **Each actor only ever reports its own side's state.** A business says "I accept this Request"
  (→ becomes an Offer); a consumer says "I accept the Offer" (→ becomes a Commitment); Nearby's
  own SECURITY DEFINER RPCs compute the combined/derived state. No client ever directly flips
  another party's state.
- **Decline reasons feed a real, owner-visible insight surface — never automated re-weighting of
  the matching engine.** A business owner sees their own decline pattern and can manually tighten
  their own settings in response; nothing auto-adjusts matching behavior from decline history
  without its own separate, explicit authorization.
- **"Don't navigate for information, navigate for tasks"** (the Progressive Depth doctrine,
  locked Sep 15 2026 as a standing rule for all future UI work): a screen change should only ever
  happen when the user's actual task changes, or real information depth genuinely requires it —
  never merely because a filter, category, or already-visible data changed.
- **Feature-freeze convention**: don't start a new product surface or architectural change
  without a direct, explicit user request. This does not block bug fixes, security fixes, or
  stabilization work — those are always in scope. A direct request is always sufficient to
  proceed on something bigger; this has been explicitly invoked and overridden dozens of times
  since it was first declared (2026-08-15) and is really just describing normal operating mode.
- **Real external accounts / real money (Stripe, a real reservation/transportation provider,
  etc.) always need the user present for that decision** — never set up or connected
  autonomously, even if the schema/UI scaffolding around the seam is otherwise safe to build
  ahead of time.
- **Migration/verification discipline**: one migration file per schema change (never a
  duplicate hand-patch baked into a squashed baseline file in the same change — that exact
  mistake once broke this repo's own "rebuildable from an empty database" guarantee). Verify a
  schema change live against production with real disposable test data before considering it
  done; a full from-scratch Docker replay (`supabase/postgres:15.1.0.147`, drop/recreate an empty
  `public` schema, patch the two known image-version gaps — `auth.users.phone`,
  `storage.buckets.public` — onto the test container only, run the full `supabase/migrations/`
  folder in filename order via `psql -v ON_ERROR_STOP=1`) is the gold-standard extra proof this
  repo has historically done, but isn't mandatory for every small change — disclose plainly
  whether it was done, don't silently skip and claim parity.
- **`CREATE OR REPLACE FUNCTION` creates a second overload instead of replacing the original
  whenever the parameter list changes at all — even with an unchanged return type**, not only
  the already-documented RETURNS TABLE column-list case. Adding a new trailing default
  parameter to an existing function (discovered 2026-09-06 adding `update_business_profile`'s
  `subcategory_param`) leaves the old signature live and independently callable side by side
  with the new one, silently defeating the change for any caller still resolving to the old
  overload. Always re-check `pg_get_function_identity_arguments` for the function name right
  after any such migration; if more than one row comes back, `drop function` the old exact
  signature explicitly, and add that same explicit drop into the migration file itself before
  its `create or replace` so a from-scratch replay lands in the same single-overload state.
- **A new Postgres function defaults to PUBLIC execute access** — always explicitly
  `revoke ... from public, anon` unless it's genuinely meant to be public. Rate-limit/counter
  triggers use `SELECT ... FOR UPDATE` to avoid race conditions. Privileged `profiles` columns
  (`is_premium`, `managed_partner_id`, daily-counter columns, etc.) are guarded by a
  `prevent_self_premium_edit()`-style trigger; a legitimate server-side write to one of these
  must `perform set_config('app.trusted_update', 'true', true)` first.
- **Git workflow for this repo**: commit and push after each individual phase/increment as it
  lands, not batched at the end — this is this project's own long-standing, explicitly
  pre-authorized convention (not something to re-confirm each time), specifically so a
  mid-session restart never loses more than one increment's worth of work.
- **Migration filename ordering matters.** Migrations replay in filename lexical order,
  independent of when they were actually written — a new migration that depends on an earlier
  one must sort *after* it by filename, or a from-scratch replay will fail even though production
  (already migrated in real chronological order) looks fine. This has bitten this repo more than
  once; double-check filename ordering against real dependencies before naming a new migration.
- **Business web export (`docs/business/`).** Path A Expo web export of the business dashboard,
  served at `/Nearby/business/` via GitHub Pages. Regenerate (`NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business
  npx expo export -p web`, copy `dist/*` over `docs/business/`) and recommit whenever a
  business-facing screen changes — no CI builds it. Never put `experiments.baseUrl` back into
  `app.json` (it's global and breaks native iOS builds); it's injected by `app.config.js` only when
  that env var is set. Web-only surface: `App.web.js`, `BusinessWebNavigator.js`,
  `BusinessWebHomeScreen.js`, `PlatformDateTimeInput.js`; not verified in a real browser.

## Reference

- `CLAUDE_HISTORY.md` — the complete historical build log (pre-2026-09-17), unedited, reverse-
  chronological. Grep by date or feature name.
- `PRODUCT_AUDIT/` — standalone audit documents from past sessions, mostly historical snapshots.
  `PRODUCTION_ARCHITECTURE_2026-08-15.md` (system-wide architecture reference) and
  `SIGNAL_CONTRACT.md` (per-signal collection/matching/ranking contract) are the two most likely
  to still be useful as a reference rather than pure history.
- No automated test framework beyond Jest unit tests on pure functions
  (`jest.config.js`/`jest.babel.config.js`) — no simulator/device testing has ever been available
  in any session on this project.
