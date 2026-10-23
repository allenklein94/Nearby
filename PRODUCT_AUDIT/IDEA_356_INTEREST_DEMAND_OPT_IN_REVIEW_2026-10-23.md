# Idea 356: gathering-interest demand becomes opt-in — migration + consent review (2026-10-23)

Owner decision (2026-10-23): Option A. Keep the anonymous gathering-interest demand row for businesses; make sharing opt-in.
Status: REVIEWED, NOT IMPLEMENTED (owner asked for this review before the change).

## What exists today (read from code + prod, read-only)
- Column `profiles.share_interest_in_demand boolean not null default true` + `interested_demand_disclosure_ack_at` (20270117).
- Reader: ONLY `get_partner_demand_signals` (current body 20270317), filter `coalesce(p.share_interest_in_demand, true)`.
  Row kind `gathering_interest`: distinct people, Interested marked in the last 14 days, upcoming public/everyone/discoverable,
  non-women-only, non-community gatherings, business's own categories (`business_offered_tags`) + its 3x3 area buckets, excludes
  the business's own gatherings; floor 5; max 2 rows; category + count only, never merged with request counts.
- Business copy (`ui.bizHelp...interestHeadline`): "{count} people nearby are interested in {category} gatherings" +
  "Anonymous · last {days} days" + Post availability. Already says gatherings, never "looking for" a business (owner's wording rule: MET).
- Client defaults assume ON: `services/gatherings.js` `getInterestedDemandPrefs` (`?? true`, and `share: true` when signed out),
  `SettingsScreen.js` (`useState(true)`, `?? true`).
- First-Interested disclosure on GatheringDetail ("Your interest may be included in anonymous local demand trends…", Got it /
  Change in Settings) shows only when `share && !acknowledged`.
- Prod: 4 profiles, all `true` by DEFAULT, none acknowledged the disclosure; 0 Interested marks ever, so no business has seen the row.
- `docs/privacy.html` does not mention this use at all (a disclosure gap independent of the default).

## Consent implications
- No affirmative opt-in exists today: the boolean cannot tell a default from a choice, and nobody ever saw the disclosure.
  So "existing users without an affirmative opt-in stay excluded" = set every existing row to false.
- Tightening only (less data used, nothing deleted, no Interested mark touched): no change notice needed (all 8 accounts are the
  owner's, same basis as the 2026-10-23 privacy-notice decision). Future opt-ins are affirmative by construction.
- Recommend recording WHEN someone opted in (`interest_demand_opted_in_at`, set server-side on false->true, cleared on true->false):
  an auditable affirmative choice, not just a flag.
- Business impact: the row will rarely reach 5 opted-in people; accepted by the owner (feature kept, privacy first).

## Plan (one migration + small client change, no new strings)
1. Migration `20270340_interest_demand_opt_in.sql`: `alter column share_interest_in_demand set default false`;
   `update profiles set share_interest_in_demand = false` (with `app.trusted_update` if the column is guarded); add
   `interest_demand_opted_in_at timestamptz` + trigger stamping it on false->true / clearing on true->false; re-create
   `get_partner_demand_signals` with `coalesce(p.share_interest_in_demand, false)` (same signature, no overload).
2. Client: `?? true` -> `?? false` (gatherings.js, signed-out `share: false`; Settings `useState(false)`, `?? false`).
   The first-Interested disclosure then never shows to someone who hasn't opted in (it reads `share`); keep it (no new strings).
   Settings helper text stays accurate ("…Turning this off removes you from those counts.").
3. Privacy Policy: one sentence in `docs/privacy.html` disclosing the opt-in anonymous aggregate (>= 5 people, category + count, no identities).
4. Tests: journey `coreLoop` actors set `share_interest_in_demand = true` explicitly; journey `interestedPrivacy` gains "default
   account = not counted" + "opted in = counted at >= 5"; `businessPrivacyBoundary.test.js` note; new guard that no reader uses
   `coalesce(..., true)`. Then prod journeys (rolled back), from-scratch replay, grants parity, Jest.
5. Native review: none (no new strings).
