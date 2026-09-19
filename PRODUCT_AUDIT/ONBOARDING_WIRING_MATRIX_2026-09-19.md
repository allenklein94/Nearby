# Onboarding -> product wiring audit (2026-09-19)

Rule: if a user gives Nearby information, something must use it. ✓ = a real reader traced in code/SQL; — = not applicable
(no honest use, deliberately not wired); ✗ = gap. "Live" = column existence/constraints checked against production
(no CHECK blocks the values); behavior itself is unit-tested only -- no device, so nothing here was exercised on real data.

| Onboarding input | Stored in | Profile | Matching (people) | Discover | Gatherings / Create | Home | Plans / Occasions | Business | Notifications |
|---|---|---|---|---|---|---|---|---|---|
| Goals (6) | `onboarding_motivations` (labels); editable in Settings | ✓ Settings | — | — | — | ✓ shortcut row | — | — | — |
| Looking for (Dating/Friends/Both) | same array, tokens `Go on dates`/`Make new friends` | — | ✓ People sub-mode start, Friend Discovery opt-in (`open_to_friend_discovery`) | ✓ People sub-mode | — | — | — | — | ✓ `notify_dating`/`notify_social` are separate, user-chosen |
| Interests (groups -> tags) | `interests` (+ `monthly_interests`) | ✓ | ✓ shared-interest scoring | ✓ fit score | ✓ feed rank, category picker, Start options | ✓ recs, "Because you're into" | — (a plan/occasion is about a person/date, not a category) | ✓ opt-in shared interests on a request (`shareableInterestsFor`, never-share list) | ✓ push predicate `interests @> tag` |
| Comfort level | `social_comfort_level` | — | — | — | ✓ **new**: Gatherings Nearby ranking (1-pt lift) | ✓ recs bonus | — | — | — |
| Location permission | OS permission; position via `userLocation.js` | — | ✓ proximity | ✓ | ✓ | ✓ | ✓ | ✓ business/supply radius | ✓ `push_target_areas` |
| Notification prefs (6) | `notify_*` columns | ✓ Settings | — | — | — | — | — | — | ✓ push triggers read each column (`notify_proximity` in the sighting trigger, others in the `notify_*` functions) |
| Name / birthdate | `display_name`, `birthdate` | ✓ | ✓ age filters | ✓ | — | — | ✓ birthday nudges, connected birthdays | ✓ celebrate | ✓ planning nudges |
| Photo | storage + `photo_url` | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Celebrations step (only if goal picked) | not stored; routes to `Occasions` with a preset | — | — | — | — | — | ✓ | — | — |

## Orphans found and fixed
1. **Location step's three options ("Near me / Around my city / I'm traveling") were UI-only**: `handleSelect(key)` ignored the
   key; nothing stored or read it. Replaced with one honest ask ("Use my location" / "Not now"); "Not now" continues with no dead end.
2. **`social_comfort_level` only shaped Home recommendations.** Now also lifts fitting gatherings in the Gatherings Nearby feed
   (`comfortFits` in `constants/socialComfort.js`, shared with Home; small lift, never hides, 'open' and unset group size neutral).

## Gaps disclosed, not fixed
- **"What are you into?" groups with no tags picked are discarded** (only tags persist to `interests`). Fix needs a decision:
  seeding every tag of a chosen group would over-commit the user.
- Goals other than the looking-for tokens only drive Home shortcuts (no ranking/notification use). Deliberate: a goal says what
  they want to *do*, and the signals that rank content are interests + behavior.
- Occasions/Plans and Reservations don't read `interests` (they're keyed to a person and date).
- Not verified on a device; live check limited to columns/constraints existing.
