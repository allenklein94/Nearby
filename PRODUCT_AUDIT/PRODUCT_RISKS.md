# Product Risks — Nearby

*Basis: findings across all other audit files, synthesized by risk category. Each item states
what was directly observed and, separately, what would need checking to fully confirm severity
— consistent with this package's "don't invent, flag UNCLEAR" instruction.*

## Safety risks

- **The "Do Something Together" 13-button `Alert.alert` may make core relationship-safety
  content (Emergency Kit's sibling tools) unreliable on Android** — see `UX_GAPS.md`. If a
  couple relies on `RelationshipConstitution`/`StressTest` for real conflict-navigation and
  can't reliably open the menu, that's a safety-adjacent product failure, not just a UX
  annoyance.
- **No automated third-party alerting exists for the date-safety check-in flow** — per
  `CLAUDE.md` (independently corroborated: no `twilio`/`resend`/`sendgrid`/`smtp` anywhere in
  this repo), if a user doesn't check in by their scheduled time, nothing automatically texts
  or emails their emergency contact — the app can only push-notify the *user's own* device, and
  can only ever *offer* to open the device's own SMS composer pre-addressed to a saved contact.
  A genuinely at-risk user depends entirely on their own phone still being usable to trigger
  that share. This is a real, structural limitation of the feature's promise ("safety
  check-in"), not a bug — worth the product owner being explicit about with users.
- **`is_blocked()`'s historical RLS-recursion-shaped bug** (a blocked user could see/message
  their blocker, per `CLAUDE.md`) is described as fixed but was not independently re-verified
  live in this pass. Blocking is core safety infrastructure — this is worth a fresh live check,
  not just trusting the changelog.
- **Admin screens (`AdminReportsScreen`, `AdminBusinessRequestsScreen`, `AdminVerificationScreen`)
  show no client-side role check of their own** — access relies entirely on Settings hiding the
  entry point plus (presumably) RLS. This is architecturally consistent with the rest of the
  app's "RLS is the real gate" tables, but wasn't independently re-verified for these three
  specific screens in this pass.

## Privacy risks

- **`gatherings`/`communities` RLS is deliberately wide open** ("Anyone can view gatherings"
  `using (true)`, per `CLAUDE.md`) — visibility scoping (`friends`/`community`/`invite_only`)
  is enforced entirely by which rows the *app* chooses to fetch, not by the database. A user
  with any direct Supabase client access (the anon key is necessarily public in a mobile app)
  could query `gatherings` directly and see every `invite_only`/`friends`-scoped gathering's
  full details, bypassing the visibility model entirely. This is a repeated, explicit design
  choice across this schema, not an oversight — but it means the actual privacy guarantee for
  gathering visibility is "obscurity via normal app usage," not "enforced." Worth the product
  owner deciding explicitly whether that's the intended risk posture for something as sensitive
  as an `invite_only` gathering's location/attendee list.
- **Several business-facing RPCs previously had no ownership check** (`get_business_top_members`
  et al., per `CLAUDE.md` — reportedly returned another business's named-individual attendee
  data to any authenticated caller who guessed a `partner_id`) — reportedly fixed, not
  independently re-verified live in this pass. A real PII-adjacent exposure if the fix doesn't
  hold or regresses.
- **The base schema's own privacy model is otherwise genuinely strong**: no client anywhere
  receives another person's precise coordinates; `profiles` has no lat/lng column at all. This
  is a real structural strength, cited explicitly so this risk section isn't read as
  all-negative.

## Spam/abuse risks

- **Business-partnership approve/deny asymmetry**: per `SCREEN_INVENTORY.md`,
  `AdminBusinessRequestsScreen`'s Approve action calls a real RPC
  (`approve_business_partner_request`) but Deny is a plain client-side `.update()` — worth
  checking whether the deny path has the same server-side integrity guarantees as approve, or
  whether a malicious/bugged client could manipulate a denied request's state directly.
  UNCLEAR without reading that RPC/RLS directly.
- **No proof-of-redemption mechanism was found for business perks** (`USER_FLOWS.md` flow I) —
  if redemption is purely client-triggered with no staff-facing confirmation step, there's a
  plausible (unverified) path for a user to claim a redemption without actually visiting the
  business, undermining the entire premise businesses are paying for.
- **Content moderation is consistently applied via `checkTextModeration`** across nearly every
  free-text field observed in the screen inventory (memory vault, constitution, gathering
  Q&A, chat, etc.) — a real, positive, repeated pattern, cited for balance.

## Growth problems

- **The referral/growth mechanism (`InviteFriendsScreen.js`) and the gathering/community invite
  mechanism (`social_invites`) are unrelated systems that share a casual name** — this is a
  UX-clarity risk (see `UX_GAPS.md`) but also a growth risk: a user trying to "invite a friend
  to the app" and a user trying to "invite a friend to my gathering" are doing conceptually
  different things, and the app doesn't obviously funnel one into the other (e.g. inviting a
  non-app friend to a specific gathering, if that's even possible, wasn't confirmed in this pass).
- **The single biggest differentiator (the relationship-longevity suite) is nearly invisible**
  (see `UX_GAPS.md`) — if this toolset is meant to be a retention/differentiation lever per
  `PRODUCT_OVERVIEW.md`'s theory of the product, its current discoverability actively undercuts
  that strategy. A feature that exists in code contributes nothing to growth or retention if
  users can't find it.

## Retention problems

- **Three real, well-built personal-stat screens (`Insights`, `Momentum`, `Rewards`) are dead
  ends** with no CTA to act on what they show — these are exactly the kind of screen that
  should be driving a return visit ("you're 2 away from Silver — go redeem something") and
  currently isn't.
- **`FeaturesOverviewScreen`'s lack of deep links** means the app's own "here's everything we
  offer" moment doesn't convert into actual usage of anything it describes.

## Marketplace problems (business ↔ consumer matching)

- **Business self-onboarding is incomplete**: `profiles.managed_partner_id` linkage has no
  confirmed self-serve claiming flow in this pass, and the dashboard can't edit the business's
  own profile yet. A real bottleneck to scaling the number of active local businesses without
  manual intervention per new partner.
- **Whether a business can host its own gathering unilaterally, vs. only ever being invited to
  sponsor a consumer's gathering, is UNCLEAR** (see `USER_FLOWS.md` flow K) — this materially
  affects how much supply-side effort a business needs from a consumer host to get any value
  from the platform.

## Business adoption problems

- **No payment processor exists at all** — `business_invoices` rows accumulate in `draft`
  status forever; there is no way for Nearby to actually collect money from a business today.
  This is the single largest business-model gap in the entire codebase (see
  `CRITICAL_MISSING_FEATURES.md`).
- **The dashboard's incomplete self-editing** (see above) is a real friction point for business
  adoption specifically — an owner who can't fix a typo in their own description without
  emailing support is a worse first-week experience than most competing local-business tools.

## Monetization problems

- **Two entirely separate monetization systems with no shared infrastructure**: consumer
  Premium (RevenueCat, live and real) and business billing (contract math, real, but
  disconnected from any payment rail). The app has proven it can monetize consumers but not yet
  businesses, despite the business side having the more architecturally sophisticated billing
  model (per-redemption/flat/hybrid contracts) — the harder problem is solved, the easier one
  (actually charging a card) isn't.
- **Redemption-based billing depends on redemption data being trustworthy** — see the
  proof-of-redemption gap above; if redemptions can be gamed, the billing math built on top of
  them inherits that risk.

## Scalability concerns

- **The single largest technical/scalability risk found in this audit**: per
  `DATABASE_AND_DATA_MODEL.md`, roughly 45 of ~53 real production tables have **no
  corresponding `CREATE TABLE` anywhere in this git repository** — they were created directly
  in the live Supabase project outside of version control. There is no way to spin up a fresh
  staging/dev database from source control, no code-reviewable history for most of the schema,
  and no disaster-recovery story beyond "restore the one production database." This is a
  foundational risk independent of any single feature.
- **Search is a client-side filter over already-fetched lists**, not a real backend search
  index (`USER_FLOWS.md` flow B) — this will not scale gracefully as the number of gatherings/
  communities/perks in a metro area grows; it works today because the data volume is small
  (per `CLAUDE.md`'s own repeated notes that production has very little real data yet — single
  digits of communities/offers at the time of several sessions).
- **`GatheringsScreen.js`/`ChatScreen.js` being 1400+-line single files** is a maintainability
  risk that compounds scalability risk — large, hard-to-reason-about files are exactly where
  bugs like the `ChatScreen` production-debug-overlay issue hide (see `IMPLEMENTATION_NOTES.md`).

## UX risks

Substantially covered in `UX_GAPS.md` — summarized here for completeness: production debug
code visible to real users, a broken empty state, a non-functional recommendation flow, silent
message-send failures across 4 chat surfaces, and the systemic relationship-tools
discoverability gap (with its associated Android `Alert.alert` reliability risk) are the
concrete, evidence-backed items; everything else in this section is either a direct consequence
of those or a reasoned inference clearly marked as such.
