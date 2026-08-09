# UX Gaps — Nearby

*Basis: `SCREEN_INVENTORY.md` and `USER_FLOWS.md`, both refreshed against the current repo.
**Refreshed 2026-08-09.** Every item from the 2026-08-08 original is either carried forward
(confirmed still present), marked resolved, or replaced — see `AUDIT_CHANGELOG.md` for the full
diff.*

## Broken flows — all four from the last audit are now FIXED

- ~~`ChatScreen.js` ships a production debug overlay~~ — **FIXED.** Zero `__DEV__`/`DEBUG:`
  references remain.
- ~~`PlacesScreen.js`'s empty state never renders~~ — **FIXED.** `ListEmptyComponent` is now one
  correctly-joined prop.
- ~~`OnboardingRecommendationsScreen.js`'s recommendation cards are non-functional~~ — **FIXED.**
  Every card now deep-links to its own tapped gathering.
- ~~4 different chat-style screens silently drop a message on send failure~~ — **FIXED**, via a
  new shared `useChatComposer` hook across all 4.

No new broken-flow-class bug was found this refresh.

## Dead ends — two of three from the last audit are now FIXED

- ~~`InsightsScreen.js`, `MomentumScreen.js`, `RewardsScreen.js` have zero outbound CTA~~ —
  **FIXED.** All three now have a real `navigation.navigate()` action (`Gatherings` for
  Insights/Momentum, `BrandOffers` for Rewards). This fix has no corresponding `CLAUDE.md`
  changelog entry found — real, confirmed by direct code read, but undocumented provenance
  among the 21 commits since the last audit.
- **`FeaturesOverviewScreen.js` still has zero tap-to-navigate — STILL PRESENT, unchanged.**
  25+ real features listed, none tappable.
- **`ChemistryDiaryListScreen.js` still has no "+ Add Entry" button — STILL PRESENT,
  unchanged.** Compare its correctly-built sibling `GoodbyeArchiveListScreen.js`, which has
  both a button and a `navigation` prop.

## Missing CTAs

**`GatheringDetailScreen`'s pending host-approval state still has no visible "withdraw my
request" action — STILL PRESENT, unchanged.** Only an *approved* attendee can leave via
`leave_gathering()`.

## Duplicate functionality — unchanged

- **Two near-identically-named business-partnership flows** (`BusinessPartnerApplyScreen`
  "Partner With Us" vs. `RequestBusinessPartnerScreen` "Request a Business Partner") — unchanged.
- **Two "invite" systems that share only a word** (`social_invites` vs. the app-referral code
  system) — unchanged, though `social_invites` gained a real non-app-user share-link path this
  session, narrowing the functional gap between them somewhat even though the naming overlap
  itself is unchanged.
- **Two independent, duplicated "is this user a business owner" checks** — unchanged.

## Confusing terminology — unchanged

`TimelineScreen` vs. `TimelinePlannerScreen`; the `Matches` route labeled "Inbox"; `Create` tab
vs. "Host a Gathering" header copy; `GatheringDetail` vs. `GatheringHub`. None of these were
touched this refresh — all confirmed still present, all still cosmetic/naming rather than
functional.

## Screens that do too much — unchanged, one new observation

- **`GatheringsScreen.js` (1421 lines, unchanged) and `ChatScreen.js` (1442 lines, grew from the
  last audit's implied ~1400)** remain large single-file screens.
- **New observation this refresh, not a new problem**: `BusinessDashboardScreen.js` has grown to
  1202 lines (three separate new feature stacks — self-edit, CRM notes, AI assistant — all
  landed in the same file this session) and now crosses the same "mega-screen" threshold the
  last audit only named for the other two. Directly verified none of that growth broke the
  screen's pre-existing functionality (Community Perks, partnership-request handling,
  gathering-attach-reward all confirmed still wired and working via a clean `npx expo export`).
- **`SettingsScreen.js`** — unchanged, still the largest navigational hub, though it's now
  slightly *less* overloaded than before: the 6+ flat relationship-tool rows are consolidated
  into one "❤️ Relationship" row (see "Features that exist but aren't discoverable" below).

## Screens that don't do enough — one of three from the last audit is now FIXED

- ~~`BusinessDashboardScreen.js`'s "Business" tab admits editing isn't built~~ — **FIXED.** A
  real "✏️ Edit Profile" modal + ownership-checked RPC now exists; the old "isn't available yet"
  string no longer appears anywhere in the file.
- **`OnboardingLocationScreen.js` still collects a choice that's discarded** — **STILL PRESENT,
  unchanged.**
- **`EditGatheringScreen.js` still can't touch location, visibility, or recurrence** — **STILL
  PRESENT by explicit design, unchanged.**

## Features that exist but aren't discoverable — the single largest gap from the last audit is now resolved

**The last audit's biggest systemic UX finding — 6 of 11 relationship-longevity screens
reachable only through one `Alert.alert()` inside `ChatScreen.js` — is resolved, on both of its
two dimensions.**

1. **Reliability**: the last audit flagged the underlying menu as a 13-button native
   `Alert.alert()`, an API documented as unreliable past 3 buttons on Android, and recommended a
   device test before trusting it further. That device test turns out to be moot — the menu was
   **already** a real `ActionSheetModal.js` component by the time the last audit's own snapshot
   was taken (the fix and the audit landed in the same commit), so the reliability risk the
   audit worried about was never actually live in the version it was auditing. Confirmed via
   direct code read: an explicit comment in `ChatScreen.js` cites the same Android-`Alert.alert`
   reasoning.
2. **Discoverability**: a new `RelationshipHubScreen.js`, reached from a single "❤️
   Relationship" row on `SettingsScreen.js` (replacing the previous 6+ flat rows), now gives all
   11 tools — the 6 previously Chat-menu-only plus their 5 already-listed siblings — a real,
   non-buried entry point, organized into "With Someone" (match-scoped) and "On Your Own"
   (personal) sections. A parity gap in the underlying match-tools picker
   (`RelationshipToolsScreen.js` was missing 2 of `ChatScreen.js`'s own 8 menu items) was also
   closed.

This closes the single largest UX gap identified in the last audit.

## Features referenced in UI but not implemented

- Unchanged — none found at the level this audit could check, same as the last audit.

## Features implemented but not surfaced

- The relationship-longevity cluster is **no longer in this category** — see above.
- **`NoticesScreen.js` is no longer "implemented but not surfaced" — it's deleted outright.**
  The last audit found it complete, working, and orphaned; it's now removed from the repo
  entirely, closing the gap the cleanest way possible (rather than adding a route to dead
  content, the dead content itself is gone).

## New this refresh, not previously flagged

- **The hardcoded-backend-URL pattern is far more widespread than the last audit's 3-file
  sample** — 12 additional files carry the identical pattern (see
  `IMPLEMENTATION_NOTES.md`/`CRITICAL_MISSING_FEATURES.md`). Not a broken flow, but a real
  maintainability gap larger than previously documented.
- **Two low-severity dead-code items** not previously flagged: `src/components/ActivityBell.js`
  (zero importers anywhere) and a stray duplicate directory
  (`src/services/src/services/textModeration.js`).
- **`AdminBusinessRequestsScreen`'s Approve/Deny asymmetry** was flagged as UNCLEAR-severity in
  the last audit's risk file; this refresh confirms it directly (Approve uses a real RPC, Deny
  is a plain client `.update()`) — same finding, now confirmed rather than inferred.
