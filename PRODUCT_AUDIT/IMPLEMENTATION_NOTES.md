# Implementation Notes — Nearby

*Basis: direct code reading across this audit's other files. Organized by the categories the
audit brief requested. Each item cites where it was found.*

## Duplicated

- **Two independent, duplicated `managed_partner_id` checks** — `ProfileScreen.js` and
  `SettingsScreen.js` each separately gate a "manage your business" entry point on the same
  profile field, rather than one owning the logic (`NAVIGATION_AND_IA.md`).
- **Two near-duplicate business-partnership request flows** with overlapping naming
  (`BusinessPartnerApplyScreen`/"Partner With Us" vs. `RequestBusinessPartnerScreen`/"Request a
  Business Partner") — functionally distinct and both needed, but implemented as two separate
  code paths rather than one flow with a branching first step.
- **The silent-send-failure pattern is copy-pasted (in behavior, not necessarily in literal
  code) across 4 separate chat screens** rather than centralized in one shared send-handling
  utility — meaning a future fix has to be applied 4 times, and indeed was apparently applied
  inconsistently already (all 4 currently have the same gap).

## Hardcoded

- **`App.js`**: Sentry DSN and PostHog API key are hardcoded string literals, not environment
  variables. Normal practice for these specific SDKs (both are public client-side keys by
  design), but worth noting there's no environment-config layer in this app at all — every
  hardcoded value found in this audit is a plain string in the source.
- **`LoginScreen.js`**: `REVIEWER_PHONE_DIGITS = '5555550199'`, a hardcoded Edge Function URL
  (`https://enmosvippabmuqslzrox.supabase.co/functions/v1/review-login`), and a hardcoded
  `Authorization: Bearer sb_publishable_...` key, all inline in component code rather than
  behind the shared `services/supabase` client (`SCREEN_INVENTORY.md`, independently verified).
- **`ProfileScreen.js`, `RehearsalRoomScreen.js`**: same pattern — direct `fetch()` calls to
  hardcoded Edge Function URLs for AI features, bypassing the `services/` layer convention used
  everywhere else.
- **`InviteFriendsScreen.js`**: a hardcoded App Store URL
  (`https://apps.apple.com/app/nearby-crossed-paths/id6792143175`) embedded in the share
  message string.
- **`LegalScreen.js`**: Privacy Policy/Terms URLs point at a personal GitHub Pages domain
  (`allenklein94.github.io/Nearby/...`) rather than a project-owned domain.
- **Project ref `enmosvippabmuqslzrox`** appears hardcoded across multiple files
  (`src/services/supabase.js` and the reviewer-bypass URL above) rather than being centralized
  in one config constant — not itself a security issue (it's a public project ref, protected by
  RLS/keys, not a secret), but a change-one-place-vs-many risk if the project is ever migrated.

## Fragile

- **`ChatScreen.js`'s `__DEV__ === undefined` check** is the clearest fragility example in the
  codebase — a conditional that was presumably meant to gate dev-only UI but structurally can
  never be true in any real React Native build, silently shipping debug UI to production
  (`SCREEN_INVENTORY.md`).
- **`PlacesScreen.js`'s malformed `ListEmptyComponent` prop** — a line-break/formatting
  mistake that silently disables an entire UI state with no error, no warning, no crash. This
  class of bug (a prop silently split into two meaningless props) is exactly the kind of thing
  that survives indefinitely because nothing fails loudly.
- **The 13-button `Alert.alert()` in `ChatScreen.js`** is fragile by construction — it depends
  on undocumented cross-platform behavior of a native API rather than a purpose-built menu
  component, for what's described elsewhere in this audit as the app's key differentiator
  feature set.
- **Silent `catch` blocks around message sends** (4 screens) — each one converts a real failure
  into complete silence rather than surfacing it, which is fragile in the specific sense that
  it hides exactly the failures a developer would most want visibility into (network issues,
  RLS rejections, moderation failures).

## Inconsistent

- **RLS posture varies by table with no naming/comment convention distinguishing "RLS is the
  real gate" tables (notices, messages, blocks-derived exclusions) from "app is the real gate,
  RLS is wide open" tables (gatherings, communities)** — a reader has to check each table
  individually with no structural hint which regime applies (`DATABASE_AND_DATA_MODEL.md`).
- **Admin action patterns are inconsistent**: `AdminVerificationScreen`'s approve path goes
  through a proper atomic SECURITY DEFINER RPC; `AdminBusinessRequestsScreen`'s Deny action is a
  plain client-side `.update()` while its Approve action uses an RPC — the same screen uses two
  different integrity models for its two buttons (`SCREEN_INVENTORY.md`).
- **Some AI/backend calls go through a `services/` wrapper (the codebase's dominant pattern);
  others (`LoginScreen`, `ProfileScreen`, `RehearsalRoomScreen`) call `fetch()` directly with
  inline URLs/keys** — no single convention is followed.
- **i18n key reuse**: `StressTestScreen.js` uses a `timeline.noThoughtsYet` key (borrowed from
  an unrelated feature's namespace) for its own empty state rather than a `stressTest.*` key
  (`SCREEN_INVENTORY.md`, batch 2 findings) — small, but suggests the i18n key namespace isn't
  strictly enforced.

## Unused

- **`NoticesScreen.js`** — a complete, working, Premium-gated "who noticed you" screen, fully
  orphaned (imported in `RootNavigator.js`, never wired to a route). Confirmed dead by direct
  grep, not inferred.
- **`MatchesScreen`'s import in `RootNavigator.js`** is technically unused (never assigned to a
  `component=` prop there) even though the underlying screen file is very much alive, composed
  directly inside `InboxScreen.js`. A different flavor of "unused" — the import binding is dead,
  the code is not.

## Potentially buggy

Everything already listed under "Broken flows" in `UX_GAPS.md`: the `ChatScreen` debug overlay,
`PlacesScreen`'s empty state, `OnboardingRecommendationsScreen`'s identical card `onPress`
handlers, and the 4-screen silent-send-failure pattern. Not repeated in full here — see that
file for exact locations and behavior.

## Difficult to scale

- **The missing local schema** (`DATABASE_AND_DATA_MODEL.md`) is the single biggest
  scale-blocking issue found — not because the current schema design is bad (it's largely
  well-considered where it is visible), but because there is no reviewable, reproducible
  history of it at all. Every future schema change inherits this risk.
- **Client-side search/filtering over already-fetched lists** (`DiscoverHubScreen.js`) will not
  hold up once any single metro area has meaningfully more gatherings/communities/perks than
  fit comfortably in one fetch.
- **`GatheringsScreen.js` (1421 lines) and `ChatScreen.js`** carry enough business logic in a
  single component that isolated testing, code review, and safe incremental change all get
  harder as these files continue to grow — exactly the kind of file where a bug like the debug
  overlay hides.

## Likely to cause future technical debt

- **The relationship-longevity tools' Chat-menu-only entry pattern** — if this pattern is
  repeated for the *next* new feature (i.e. "just add another item to the Alert menu") rather
  than fixed now, the reliability and discoverability problems compound linearly with each
  addition.
- **The duplicated `managed_partner_id` gating logic** (Profile + Settings) — every future
  change to "what does it mean to manage a business" now has two call sites to remember to update.
- **Hardcoded Edge Function URLs scattered across components** — every future Edge Function
  rename, project migration, or key rotation now has to hunt down these inline call sites in
  addition to the `services/` layer, rather than one place.
- **The 8/53 local-schema coverage gap** compounds every time a new feature is shipped directly
  to production without a matching local migration — the gap between "what git shows" and
  "what production actually is" only grows unless this practice changes going forward.
