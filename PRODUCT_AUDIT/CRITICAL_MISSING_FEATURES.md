# Critical Missing Features / Gaps — Ranked

*Basis ONLY on what was directly observed in this codebase across the other audit files, plus
live production re-verification where noted — nothing here is inferred from a roadmap doc,
comment, or discussion. **Refreshed 2026-08-09.** Every item from the 2026-08-08 original is
carried forward with a real classification (FIXED / STILL PRESENT / PARTIALLY FIXED / NO LONGER
APPLICABLE); items marked FIXED are dropped from the ranked list below and moved to the
"Resolved since the last audit" section at the bottom, per this refresh's own instructions —
`AUDIT_CHANGELOG.md` has the full item-by-item classification table. P0 = actively broken or
blocking today · P1 = important, real product/business impact · P2 = valuable later, not
urgent.*

## Headline: 6 of the original 6 P0s are now FIXED

Every item the last audit ranked P0 is resolved as of this refresh — 4 with live re-verification
against production, not just a static code read. This is a real, substantial change from the
last audit's state, not a re-labeling exercise. See "Resolved since the last audit" below for
the receipts on each.

## P0 — none remaining at this severity

No item currently rises to "actively broken or blocking today." The closest candidate — the
schema-reproducibility regression found during this very refresh (a duplicate-effect migration
left un-archived, which would have broken a from-scratch project rebuild) — was found and fixed
within this same refresh pass and is documented as resolved, not left open; see
`DATABASE_AND_DATA_MODEL.md`.

## P1 — important, real product/business impact

1. **No payment processor is integrated for business billing — STILL PRESENT, unchanged.**
   Real usage-based invoice math runs on a schedule and writes real `draft` invoices, and now
   only counts *confirmed* redemptions (an improvement) — but no money has ever moved and none
   can, today. *Why it matters*: unchanged from the last audit — this is the entire business-
   side revenue model, fully engineered on the accounting side and completely absent on the
   collection side. No Stripe or other payment-rail code was found anywhere in `src/` or
   `supabase/` this refresh either.
2. **Hardcoded backend URLs/keys — PARTIALLY FIXED, and the real scope is far larger than
   previously known.** The last audit's 3 cited call sites (`LoginScreen.js`,
   `RehearsalRoomScreen.js`, `ProfileScreen.js`) are genuinely fixed — all 3 now call the new
   `functionUrl(name)` helper. **But this refresh found the identical pattern still live in 12
   more places**: `src/services/aiConcierge.js:55`, `textModeration.js:11`, `photos.js:122`,
   `proximity.js:60`, `presenceStatus.js:10`, `dataExport.js:10`, `account.js:15`,
   `extraPhotos.js:144`, `createAssistant.js:16`, `src/screens/ChatScreen.js:515,670,800` (3
   separate call sites), `src/components/CompatibilityReportModal.js:39`. *Why it matters*: the
   fix was scoped to the literal 3 examples the last audit named, not to the underlying pattern
   — every future Edge Function rename or project migration now has 15 inline call sites to hunt
   down, not 3. Genuinely new finding this refresh, not previously known.
3. **Whether a business can unilaterally host its own gathering — now confirmed a definite NO,
   not merely UNCLEAR.** The last audit flagged this as ambiguous. Direct code reading this
   refresh resolves it: `createGathering()` always sets `host_id` from the caller's own
   session — a business can only ever be attached to a gathering via `hosting_partner_id`,
   which itself is now confirmed protected against self-edit (see `DATABASE_AND_DATA_MODEL.md`)
   and can only be set through the consumer-initiated partnership-request flow. *Why it
   matters*: unchanged from the last audit's framing — this caps how much value a business can
   get from the platform without a consumer host first, now confirmed rather than assumed.
4. **Business self-serve onboarding is still not fully self-serve — PARTIALLY FIXED.** The
   dashboard's own profile-editing gap is FIXED (see below), but *becoming* a partner in the
   first place (`managed_partner_id` first being set) is still admin-gated
   (`approve_business_partner_request`), not a true self-claim flow. *Why it matters*: reduced
   in severity from the last audit (editing now works) but the original bottleneck — scaling
   the number of active partners without manual intervention — is only half-closed.
5. **The proactive "return" push notification still doesn't exist — the other half of the last
   audit's item 10, PARTIALLY FIXED overall.** `Insights`/`Momentum`/`Rewards` all now have a
   real outbound CTA (the dead-end half is fixed — see below), but no grep hit for anything
   resembling a streak/tier-proximity *push* trigger was found in `supabase/functions/` or the
   migrations. *Why it matters*: per `PRODUCT_FLYWHEEL.md`, this remains the sharpest fall-out
   point in the entire loop — the retention signal is now partially activated (an in-app CTA
   exists) but still never proactively surfaces outside the app.

## P2 — valuable later, not urgent

6. **Search across gatherings/communities/perks is still a client-side filter, not a real
   backend index — STILL PRESENT, unchanged.** Fine at today's data volume; a real ceiling once
   any metro area has hundreds of active gatherings.
7. **`GatheringsScreen.js` (1421 lines) and `ChatScreen.js` (1442 lines) remain large,
   single-file mega-screens — STILL PRESENT.** `BusinessDashboardScreen.js` (1202 lines) now
   also crosses the same threshold, not previously called out by name — a new observation, not a
   new problem in kind.
8. **`ChemistryDiaryListScreen.js` still has no "+ Add Entry" affordance — STILL PRESENT**,
   confirmed unchanged. Compare its correctly-built sibling `GoodbyeArchiveListScreen.js`.
9. **`FeaturesOverviewScreen.js` still has zero tap-to-navigate — STILL PRESENT**, confirmed
   unchanged.
10. **`AdminBusinessRequestsScreen`'s Approve/Deny asymmetry (RPC vs. raw client `.update()`) —
    STILL PRESENT**, confirmed unchanged.
11. **A pending host-approval gathering request still has no "withdraw" action — STILL
    PRESENT**, confirmed unchanged. Only an *approved* attendee can leave via `leave_gathering()`.
12. **Two newly-found, low-severity dead-code items — genuinely new this refresh**: a fully
    unreferenced component (`src/components/ActivityBell.js`, zero importers anywhere) and a
    stray duplicate nested directory (`src/services/src/services/textModeration.js`, functionally
    identical to the real file, sitting since before the last audit). Both trivial one-line
    fixes, no functional impact.

---

## Resolved since the last audit (was P0/P1/P2, now FIXED)

1. **`ChatScreen.js`'s production debug overlay — FIXED.** Zero `__DEV__`/`DEBUG:` references
   remain in the file. (Was P0 #1.)
2. **The 13-button `Alert.alert()` relationship-tools menu — FIXED, and turns out to have
   already been fixed *before* the last audit's own snapshot was taken.** `ChatScreen.js` uses a
   real `ActionSheetModal.js` component, not a native `Alert.alert`, with an explicit code
   comment citing the same Android-reliability reasoning the last audit independently raised.
   (Was P0 #2.)
3. **Schema reproducibility — FIXED, replay-verified against a truly empty database, with one
   regression found and fixed during this very refresh** (a duplicate-effect migration left
   un-archived — see `DATABASE_AND_DATA_MODEL.md`). (Was P0 #3.)
4. **`is_blocked()`'s historical safety bug — FIXED, and independently live-re-verified this
   refresh** (not just "reported fixed" as the last audit had to leave it) — both directions,
   using a real disposable block row. (Was P0 #4.)
5. **Business-facing RPC ownership checks — FIXED, and independently live-re-verified this
   refresh** for all 5 original functions plus 3 new-this-session ones. (Was P0 #5.)
6. **Silent send-failure across 4 chat-style screens — FIXED**, via a new shared
   `useChatComposer` hook, confirmed imported in all 4 target screens. (Was P0 #6.)
7. **No proof-of-redemption mechanism — FIXED.** A real 6-digit confirmation-code flow now
   exists, and billing math now only counts confirmed redemptions. (Was P1 #8.)
8. **Business self-serve profile editing — FIXED** (the *editing* half; *becoming* a partner is
   still admin-gated, see P1 #4 above). A real, previously-silent bug was found and fixed
   underneath it: the pre-existing address-edit path had zero UPDATE RLS policy and had never
   actually written anything for any real owner. (Was P1 #9, partial.)
9. **`Insights`/`Momentum`/`Rewards` dead-end screens — FIXED** (the in-app CTA half; the
   proactive-push half is still missing, see P1 #5 above). (Was P1 #10/#12.)
10. **No path to invite a non-app-user to a specific gathering — FIXED.** A real "Invite someone
    not on Nearby yet" share-link action now exists. (Was P1 #11.)
11. **No nudge to join the community behind a just-attended gathering — FIXED**, via the
    flywheel-trace leg-5 community card. (Was P1 #13.)
12. **`PlacesScreen.js`'s empty state — FIXED.** The malformed `ListEmptyComponent` prop is now
    one correctly-joined prop. (Was P2 #15.)
13. **`OnboardingRecommendationsScreen`'s identical-card-navigation bug — FIXED.** Every card
    now deep-links to its own specific gathering. (Was P2 #16.)
14. **`NoticesScreen.js` dead code + the dangling `MatchesScreen` import — BOTH FIXED.**
    `NoticesScreen.js` is deleted outright; the dangling import is removed. (Was P2 #17.)
15. **The 3 originally-cited hardcoded URLs — FIXED** (see P1 #2 above for the much larger
    remaining scope). (Was P2 #19, partial.)

## Genuinely new capability since the last audit (not a fix to a prior finding)

- A gathering can now seed a brand-new community from its own real, friended attendee list
  ("Start a Community from This Gathering") — closes a gap the flywheel-trace audit found and
  deliberately left unbuilt at the time.
- Persistent per-customer CRM notes/tags for business owners.
- A natural-language Business AI Assistant over a business owner's own real dashboard stats.
- Server-side (not just UI-side) enforcement that a non-invited stranger cannot join an
  `invite_only` gathering.
- A consolidated relationship-tools hub (`RelationshipHubScreen`), closing the discoverability
  half of what was previously P0 #2 above.
- Cold-start push-notification tap delivery — a previously-undocumented gap (any push tap from a
  fully-closed app was silently dropped) found and fixed this session, not carried over from the
  last audit.
