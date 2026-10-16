# Item 121 follow-up device checklist: Dating discovery consent, cards and counts (2026-10-16)

Rule (owner, approved): a person appears in Dating discovery cards and Dating counts ONLY if their own "What are you looking
for?" answer is Dating or Both. Shared attendance, interests, proximity and past interactions are never consent. Server-side:
`dating_candidates_visible_to_me` (migration 20270314, LIVE); client second layer `utils/datingCountConsent.js`.
Proven without a device: journey `datingConsent` (6/6 on prod, rolled back; 379/379 journeys on a from-scratch replay), Jest.

Record: device, OS, date, accounts used, result per check. Needs 3 verified accounts: A (viewer, Dating), B (Dating or Both),
C (Friends only, or no answer); A, B and C attended the same past gathering.

1. A > Discover > People > Dating (Crossed Paths): B is a card, C is not.
2. A > Dating > Browse (same area): B is a card, C is not.
3. A's Home: "You crossed paths with {name}" never names C; "N people nearby to meet" / "N new people nearby" never count C.
4. A > Activity: no crossed-paths row for C.
5. C switches to Both in Settings: after a refresh C appears in 1-4. B switches to Friends only: B disappears from 1-4.
6. Friends: C (Friends discovery on) still appears in A's Friends discovery exactly as before; Friends counts unchanged.
7. A block either way removes B from every Dating card and count.
