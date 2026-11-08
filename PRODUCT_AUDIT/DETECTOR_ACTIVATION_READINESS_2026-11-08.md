# Shared-device + shared-text detectors: activation readiness (2026-11-08)

**Status: PREPARED, NOT ON. Both detectors stay disabled and store nothing. Staged on `post-tier1/detector-activation-readiness` (stacked on 0406's branch); no migration here, no number set, not merged, not deployed, not in build 87.** Turning either on needs the owner's separate approval, per detector, per run.

## What was built

- `scripts/trust-safety/detector-switch.js`: status (read-only), `on --detector=device|text`, `off --detector=device|text|all`. **This replaces the "separate activation migration" 0376 and 0378 describe:** a numbered migration would sit in the deploy chain and could be deployed along with the others by mistake. A guard test fails if any migration sets a detector number.
- `on` refuses until every gate holds, each read from the thing itself: migration deployed, secret present, no client or service-role access, retention job scheduled, the published Privacy Policy carries the disclosure, approval code bound to the numbers and the migration's exact text. It commits the numbers, then backfills once in a separate transaction.
- `off` is instant. Cases stay for an admin; stored keys age out.
- Journey `detectorActivationReadiness`: runs the switch's own statements through the scenario matrix below.

## Exactly what each one reads and stores

| | Shared device (0376) | Shared text (0378) |
|---|---|---|
| Reads | the Expo push token the app already registers | a published bio; the description of a PUBLIC, visible gathering. Never messages, friends-only or invite-only text |
| Stores | HMAC of the token, account id, first + last seen | HMAC of the normalized text, account id, source, gathering id, first + last seen |
| Never stores | the token, device model, OS, IP, location, ad id | the text, an excerpt, its length or language |
| Kept | 90 days after last registered (12 months for a suspended account's keys; 90 days under 0406 for an unresolved one) | 30 days after last posted |
| Deleting the account | sightings go, except the two kept-key cases above | sightings go |
| Sent elsewhere | nothing | nothing |
| Does | one private admin case. Never restricts, scores or notifies | same |

## False positives: what can be said today

**No real false-positive rate can be measured.** Production has about 10 accounts, all the owner's. These are the ordinary situations tested, at the proposed numbers:

| Situation | Result |
|---|---|
| Couple sharing a phone (2) | nothing |
| 3 accounts on one phone (the owner's iPhone today) | nothing |
| Household of 4 with no other signal | nothing (many-accounts needs an independent case too) |
| Family member of a suspended person on the same phone | **one case about them. A real false positive, by design:** the case says it isn't proof, nobody is told or restricted |
| Short bio (< 80 chars or < 12 distinct words) | ignored |
| One host repeating a description on 6 gatherings | nothing |
| Friends-only description | never read |
| 4 accounts with the same long bio | nothing |
| 5 co-organisers with the same long bio | **one case. The known false positive;** the only remedy is closing it or `exclude_shared_text` |
| Same text with different capitals + punctuation | still a copy (so simple edits don't hide it) |

## Findings

1. **The published Privacy Policy forbids the device detector today.** Line 38 says the token is "used solely to deliver notifications". The switch refuses while that sentence is there. The policy must change first, and that's a real change for anyone who agreed to the old wording.
2. **Secrets are readable by the `postgres` and `supabase_read_only_user` roles** (checked on the local stack). Anyone holding those can test a guessed number or token against stored keys, and rotating a secret orphans every key. They are not reachable from a client or the service role. Needs the owner's secret review (already a recorded gate); 0406 raises the stakes by keeping more number keys.
3. **Shared text misses some languages.** The word gate counts space-separated words, so Chinese, Japanese and Thai bios will rarely reach 12 words: a false negative, not a false positive. Not fixed (no new detection work ordered).
4. **The device check takes a global lock on every token write**, which includes every app launch that re-registers. Fine at today's volume; measure before real scale.
5. **The 4-account and 5-account numbers are your recorded preferences, not validated.** The 5 is provisional by your own note.
6. **Token behaviour is unverified on real devices:** whether a reinstall or restore changes the token decides how often this fires or misses. Only real phones show that.

## Recommendation

Turn on only after external users exist, and in this order: policy published -> secret review -> `device` -> `text` a little later, so a surprise is attributable. Review after 30 days: how many cases, and how many closed "No action needed". If most close that way, raise the number or switch that detector off. Don't turn on before launch for its own sake: with only the owner's accounts there's nothing to detect.

## Owner decisions (2026-11-08)

1. **Numbers kept as provisional testing thresholds, not evidence of accuracy:** 4 accounts (shared device), the existing suspended-reuse rule, 5 accounts (shared text). They open review cases only, never an automatic restriction.
2. **Production activation stays disabled until privacy review and validation are complete.** Line 38's "solely" must be corrected and reviewed before any expanded use of the token; the switch refuses until then.

Still open: the policy wording above is a draft for counsel, NOT published ("To help protect people from repeat abuse, we may compare a protected, one-way form of your notification token, your public bio and your public gathering descriptions with those on other accounts. We don't keep the token or text in this form, and a match only prompts a private review by our team. We keep this for up to 90 days (token) and 30 days (text)."). The 30-day review in the recommendation stands unless changed.

## Not verified

No production run; no real push token; no real phone; prod journeys, grants vs prod and the prod aborted rollback remain deploy gates for 0376 and 0378.
