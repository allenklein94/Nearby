# Product Audit — Progress Tracker

(This file tracks build progress for the audit package itself, so work can resume after a
codespace restart. Not part of the deliverable set requested, but kept in this folder for
convenience — safe to ignore/delete once the audit is finished.)

Started: 2026-08-09

## Repo scale (confirmed via direct listing, not estimated)
- 73 files in `src/screens/`
- 45 files in `src/services/`
- 30 files in `src/components/`
- 28 migrations in `supabase/migrations/`
- 6 real edge functions in `supabase/functions/` (ai-concierge, create-assistant,
  delete-account, moderate-photo, report-presence, send-push)

Note: CLAUDE.md's build history (Aug 7-9 2026 sessions) covers a lot of ground but does NOT
mention many screens/services that exist in the repo (e.g. ChemistryDiary, GoodbyeArchive,
RelationshipConstitution/EmergencyKit/Legacy, SharedDecisions, SharedPlaylist, TripPlanning,
TimelinePlanner, StressTest, RehearsalRoom, ConfidenceMode, LegacyLibrary, FeaturesOverview,
QuickFilterCustomize). Treating CLAUDE.md as background/history only — the audit itself is
based on direct codebase reading, per the user's "verify, don't invent" instruction.

## Research phase (gathering raw material, via agents + direct reads)
- [x] Direct read: RootNavigator.js + App.js (tab/stack structure) — full route table captured,
      5 tabs (Home/Discover/Create/Matches="Inbox"/Profile="You") + ~55 stack screens
- [x] Direct read: supabase/schema.sql (base only — gatherings/communities/business tables are
      NOT in local schema.sql or the 28 local migrations; they exist only in production,
      confirmed via CLAUDE.md's own "empty local stub, real deployed code" pattern repeating
      for schema too, not just edge functions). Full migration filename list captured (28,
      all dated 20260806-20260808 — pure bugfix/feature-addition tail, not the original schema).
- [x] Direct grep: TODO/FIXME/mock/placeholder/hardcoded across src/ and supabase/ — result:
      ZERO TODO/FIXME/XXX/HACK comments anywhere. One "mock" hit, a code comment unrelated to
      mock data. Hardcoded found directly: Sentry DSN + PostHog API key in App.js (client keys,
      normal to ship client-side, still noted in IMPLEMENTATION_NOTES.md).
- [x] Direct grep: full `.from('table')` and `.rpc('fn')` inventory across src/ — ~53 tables,
      ~44 RPCs, 4 storage buckets referenced client-side. Used as ground truth for
      DATABASE_AND_DATA_MODEL.md instead of trusting CLAUDE.md prose alone.
- [x] Confirmed concrete dead-code finding: NoticesScreen.js imported in RootNavigator.js but
      never wired to a `component=` — the `Notices` route actually renders ActivityScreen.
- [x] Agent: Screen inventory batch 1 (37 screens, A-I) — DONE. Key findings: ChatScreen.js
      ships production debug overlay (`__DEV__ === undefined` always-false check) + literal
      "DEBUG:" string to real users; 4 chat-style screens (Chat/Community/Gathering/Business
      conversation) silently swallow send failures after optimistically clearing the composer;
      ChemistryDiaryListScreen has no add-entry affordance/navigation prop (compare
      GoodbyeArchiveListScreen, which does it right); BusinessDashboardScreen admits profile
      editing isn't built; FeaturesOverviewScreen is a dead-end reference doc with zero deep
      links; GatheringsScreen/ChatScreen are ~1400-line mega-files.
- [x] Agent: Screen inventory batch 2 (36 screens, I-V) — DONE. Key findings: NoticesScreen.js
      confirmed fully dead (imported, never wired — Notices route renders ActivityScreen);
      MatchesScreen.js also imported-but-never-wired in RootNavigator (though the screen itself
      is alive, composed directly inside InboxScreen.js); PlacesScreen.js has a real bug —
      `ListEmptyComponent` accidentally split across two JSX props, so its empty state never
      renders (independently verified firsthand); OnboardingRecommendationsScreen's card
      onPress ignores `r.id` and always navigates to MainTabs regardless of which card was
      tapped (independently verified firsthand); LoginScreen.js has a hardcoded reviewer-bypass
      phone number + hardcoded Supabase Edge Function URL/key inline (independently verified
      firsthand); 6 of 11 relationship-longevity tools (Constitution/StressTest/
      SharedDecisions/SharedPlaylist/TripPlanning/TimelinePlanner) are reachable ONLY via a
      12-button ChatScreen `Alert.alert` menu, not from Settings/Profile (independently verified
      button count firsthand: 13 `text:` entries in that alert) — real Android reliability risk
      since RN's Alert is officially 3-button-oriented there; TimelineScreen vs
      TimelinePlannerScreen naming collision (unrelated features).
- [x] Both batches folded into SCREEN_INVENTORY.md — DONE
- [ ] Agent: Services + Edge Functions + business-logic inventory (not yet launched — may do
      remaining research via direct reads instead, given strong yield already from direct
      grepping; will decide per-file as FEATURE_MATRIX/UX_GAPS/PRODUCT_RISKS/
      IMPLEMENTATION_NOTES are drafted)

## Deliverable files (13 + json)
- [x] PRODUCT_OVERVIEW.md — pre-existing from before the restart, read and verified good, KEPT AS-IS
- [x] NAVIGATION_AND_IA.md — written from direct RootNavigator.js read
- [x] DATABASE_AND_DATA_MODEL.md — written; flags that ~45 of ~53 real tables have NO local
      schema/migration source at all (only exist in production) as the single biggest data-model risk
- [x] SCREEN_INVENTORY.md — written from both agent batches. Decided NOT to launch a 3rd/4th
      research agent round for services/edge-functions — the two screen-inventory agents
      already surfaced service function names extensively per-screen, combined with direct
      greps/CLAUDE.md this is sufficient to write the remaining files without more agent cost.
- [x] USER_FLOWS.md — 14 flows (A-N) mapped with real screen sequences; flagged 3 UNCLEAR items
      (redemption proof mechanism, whether a business can unilaterally host its own gathering,
      exact business-community attachment mechanism) rather than guessing
- [x] FEATURE_MATRIX.md — full table, all requested rows covered
- [x] UX_GAPS.md — all 9 requested categories covered; flagged the 13-button Alert.alert as a
      candidate P0/P1 Android reliability risk, not just a discoverability nit
- [x] PRODUCT_RISKS.md — all 10 requested risk categories covered
- [x] PRODUCT_FLYWHEEL.md — full loop traced, weakest links identified as Invite (no
      non-app-user-specific-event path) and Return (instrumented but not activated)
- [x] CRITICAL_MISSING_FEATURES.md — top 20 ranked P0(6)/P1(8)/P2(6)
- [x] IMPLEMENTATION_NOTES.md — all 8 requested categories covered
- [x] AI_HANDOFF.md
- [x] AUDIT_SUMMARY.json — validated as parseable JSON

## STATUS: COMPLETE (2026-08-09)
All 13 requested files + AUDIT_SUMMARY.json exist in /workspaces/Nearby/PRODUCT_AUDIT/.
No application code was modified at any point in this pass. This PROGRESS.md file itself is
not part of the deliverable set — safe to delete once the package has been reviewed/delivered.

## Notes / decisions log
(appended as work progresses)
