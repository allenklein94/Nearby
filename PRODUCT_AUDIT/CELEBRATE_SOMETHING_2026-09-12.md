# Item 61 — "Celebrate Something" life-events planning layer

User's ask, verbatim shape: a new Create-tab entry, "🎉 Celebrate Something", walking through:
occasion (Birthday/Anniversary/Graduation/Baby shower/Engagement/Housewarming/Promotion-new job/
Farewell/Milestone/Other) → who is this for (Me/Friend/Family/Someone else) → what would you like
to do (Dinner/Party/Surprise/Activity/Night out/Weekend trip/Custom) → when → who should be
involved (Friends/Family/Existing groups/Invite specific people).

## Architecture decision (made, not asked — strong existing precedent)

This is a client-side orchestrating wizard that collects structured answers, then routes into an
EXISTING creation/request screen with full prefill — no new "occasion plan" entity, no parallel
data model. Matches every recent big feature's own discipline: Item 52 ("wire the client first"),
Item 53 (reuse the request/offer/reservation chain), Item 16 (reuse CreateGathering with
`quickStartRecurring`), Item 28 Surprise Me (reuse `resolveIntent`/`assembleExperience`).

## Real pre-existing infrastructure found and reused (not rebuilt)

- `OCCASION_OPTIONS` (`businessAttributes.js`) — the real WHY-signal vocabulary already powering
  `business_requests.occasion`, `brand_partners.priority_occasions`, and `occasionBonus()`
  scoring. Extended with 7 new keys (graduation, baby_shower, engagement, housewarming, promotion,
  farewell, milestone) rather than inventing a second, wizard-only vocabulary.
- A whole separate, ALREADY-LIVE "Occasions" personal calendar system (Phase H, Sep 14 2026):
  `occasions` table + `get_upcoming_occasions()` RPC + `OccasionsScreen.js` CRUD UI + a real Home
  nudge (`occasionNudge`) that already routes to `CreateGathering` with a bare `quickStartTitle` —
  this wizard is the natural, previously-anticipated extension of that exact nudge (its own
  delete-confirmation copy literally says "Nearby will no longer suggest planning something around
  it," implying planning-from-an-occasion was always the intended endpoint). `occasions.occasion_type`
  extended with 5 of the same new values (baby_shower/engagement/housewarming/promotion/farewell;
  graduation/milestone already existed) so the wizard's own optional "save to my calendar" step
  can write into the same real table.
- `WHEN_PRESETS`/`dateForPreset()` (`utils/whenPresets.js`) — the shared, already-reused (by
  `CreateGatheringScreen`/`MakeAPlanScreen`) deterministic date-preset mechanism. Reused as-is for
  the wizard's own "When?" step — no new date logic, no AI date inference (standing rule).
- `AskBusinessScreen`'s existing prefill contract (`prefillText`/`prefillCategory`/
  `prefillOccasion`/`prefillDateWindow`/`prefillPickedDateISO`) — used verbatim for the
  Dinner/Night out/Activity destinations.
- `CreateGatheringScreen`'s existing `quickStartTitle`/`quickStartCategory`/`initialVisibility`/
  `initialCommunityId` prefill contract — used verbatim for the Party/Surprise/Weekend trip
  destinations. Gained one small, consistent addition: `quickStartWhenPreset`/`quickStartWhenISO`
  (mirrors `quickStartTitle`'s own pattern) so the wizard's "When?" answer actually lands on the
  gathering's own date, not just its title — that gap didn't exist before this item.

## Real gap found and deliberately NOT used

`TripPlanningScreen.js` looked like the obvious destination for "Weekend trip" but is actually a
private shared idea-board (`trip_ideas`, keyed to one `match_id`) for a romantic couple only — not
a general trip-creation flow, and it can't hold a real RSVP/attendee list a family/friend
celebration needs. "Weekend trip" routes to `CreateGathering` instead (same as Party), which is
the only real thing in this schema that can hold an actual multi-person, real-RSVP plan.

## Occasion vocabulary — DB migration

`supabase/migrations/20261016_celebrate_occasion_vocabulary_expansion.sql`. Widens 3 real CHECK
constraints (`business_requests_occasion_check`, `brand_partners_priority_occasions_check`,
`occasions_occasion_type_check`), verified live via disposable rolled-back transactions against
production (real row updates/inserts for each new value, a bogus value still rejected) before
applying for real, then re-confirmed applied via `pg_get_constraintdef()`. Deliberately did NOT
widen `business_availability_bundle_occasion_check` — scoped intentionally to only the 5 occasions
with a real `experienceTemplates.js` template; no template exists yet for the new life-event
types, disclosed as a real, not-yet-built follow-up.

Status: DB layer DONE. Client wizard + edge function prompt updates IN PROGRESS.
