# Item 168: V1 category pass, prep for owner review (2026-10-11)

**Status: PROPOSED. Nothing is migrated.** This is the "before migrating" package the spec requires
(`V1_TAXONOMY_SPEC_2026-10-03.md`, rows 1-48, items 168-186): (1) a complete old -> new mapping of every group and tag,
(2) the businesses whose group-only declarations would stop covering a moved tag, (3) an affected-surface checklist,
(4) the decisions the owner must make before the migration is written. The pass is structural only: no ranking,
routing, eligibility, matching, privacy or business-demand change.

**Files (all in `PRODUCT_AUDIT/item168_prep/`):**
- `mapping.json`: the machine-readable mapping (20 group rows, 265 tag rows, need lists, customer-only split). The single
  source for everything below; the tables here are generated from it.
- `approved_wordings.json`: the 275 approved wordings (phrase -> tags) from items 169-185, exactly as the spec words them.
- `crosscheck.js`: `node PRODUCT_AUDIT/item168_prep/crosscheck.js` runs 32 consistency checks (mapping vs the live table,
  vs the app's `CATEGORY_GROUPS`, vs every count in the spec, vs the impact SQL, vs live synonyms). **32/32 PASS.**
- `sql/`: the read-only queries behind every figure (re-runnable with the Management API); `evidence/`: their results
  as of 2026-10-11.

## 1. Decisions needed from the owner

Each has a recommendation; the mapping already follows the recommendation, so approving it as-is needs no rework.

| # | Question | Recommendation | Why |
|---|---|---|---|
| D1 | Stored key of the new group | `sports_fitness` | Matches the label; keys are permanent so choose once. |
| D2 | Which key survives the Travel + Stay merge | Keep `travel_experiences` (label becomes "Travel & Getaways"); `stay_getaway` stops existing | 0 stored rows hold `stay_getaway` anywhere (evidence/05); `travel_experiences` keeps the older ids. |
| D3 | `NEED_GROUP_KEYS` does two jobs today: need detection AND the "something fun" exclusion (`openEndedAsk.js`). Rows 19/26/32/36/39/43 take pets, home, auto, stay, education and business groups out of it for needs. If nothing else changes, an open-ended "something fun" ask would start offering plumbers, oil changes and hotels. | Split it: need detection becomes per-tag as decided; a separately named "not something fun" list keeps today's groups (home, auto, business, health, pets, education) plus the lodging tags at tag level, so open-ended results stay as today. | The spec says these groups leave the list "for the open-ended rule in the pass" but never says what replaces it; keeping behavior identical is the structural-only rule. |
| D4 | `health_personal_care` is the only group no item converted to per-tag needs | Leave it a whole need group (unchanged) | No item decided otherwise; changing it would be a need-behavior change outside this pass. |
| D5 | Discover's rail. Today the "Activities" chip shows gyms, yoga and tennis; after the split those sit in Sports & Fitness, which would land under "More" | Add a primary chip "Sports & Fitness" right after "Activities" (8 primary chips) | Otherwise the most-used fitness categories lose a tap-one entry point. Display-only (`discoverCategoryRail.js`). |
| D6 | Group-based code paths that today reach the moved tags (list in section 4B) | Add `sports_fitness` (and `outdoors_nature` where Boating / Water Sports mattered) beside every `activities_recreation` so each path reaches exactly the tags it reaches today. Any narrowing (e.g. "play sports" -> Sports & Fitness only) is a later, separate decision. | Structural-only rule. |

## 2. Groups: old -> new (19 after)

| Old key | Old label | New key | New label | Change | Items |
|---|---|---|---|---|---|
| food_drink | Food & Drink | food_drink | Food & Drink | unchanged (+2 tags) | 169 |
| activities_recreation | Activities & Recreation | activities_recreation | Activities & Recreation | split: 18 tags to sports_fitness, 2 to outdoors_nature, +7 new (11 after) | 168, 170-172 |
| (none) | | **sports_fitness** | **Sports & Fitness** | NEW group (19 tags) | 168, 171 |
| entertainment_nightlife | Entertainment & Nightlife | same | same | unchanged | 173 |
| dating_social | Dating & Social | same | same | membership unchanged; 7 tags become customer-only | 185 |
| arts_culture_learning | Arts, Culture & Learning | arts_culture_learning | **Arts, Culture & Events** | label only; stored key kept | 168, 174 |
| shopping | Shopping | same | same | +5 tags | 175 |
| wellness_beauty | Wellness & Beauty | same | same | unchanged | 176 |
| family_kids | Family & Kids | same | same | unchanged (Kids Sports stays here) | 177 |
| outdoors_nature | Outdoors & Nature | same | same | +Boating, Water Sports (19 after) | 172 |
| pets | Pets | same | same | Pet Friendly Places retired, +Pet Sitting | 178 |
| home_local_services | Home & Local Services | same | same | +4 tags | 180 |
| auto_transportation | Auto & Transportation | same | same | +4 tags | 181 |
| business_networking | Business & Networking | same | same | unchanged | 184 |
| community_volunteering | Community & Volunteering | same | same | unchanged | 183 |
| travel_experiences | Travel & Experiences | travel_experiences | **Travel & Getaways** | absorbs stay_getaway (17 after) | 168, 179 |
| stay_getaway | Stay & Getaway | -> travel_experiences | | **key stops existing**; Pet Friendly Stays retired | 168, 178, 179 |
| health_personal_care | Health & Personal Care | same | same | unchanged | 168 |
| education_classes | Education & Classes | same | same | unchanged | 182 |
| attractions_things_to_see | Attractions & Things to See | same | same | unchanged | 168 |

## 3. Tags: everything that changes (182 of 241 live tags are untouched)

Tag names and ids never change in a move; only `group_key` does.

**Moved to Sports & Fitness (18):** Basketball, Climbing, Cycling, Fitness, Golf, Gyms, Martial Arts, Padel,
Pickleball, Pilates, Running, Skating, Soccer, Sports, Swimming, Tennis, Volleyball, Yoga.
**Moved to Outdoors & Nature (2):** Boating, Water Sports.
**Moved by the merge, stay_getaway -> travel_experiences (10):** Family Resorts, Glamping, Hotels, Resorts, Road Trip,
Romantic Getaways, Spa Resorts, Staycation, Vacation Rentals, Weekend Getaway.
**Group renamed, tag unchanged (20):** every Arts, Culture & Learning tag.

**New (24):**

| Group | New tags | Item |
|---|---|---|
| food_drink | Tea, Distilleries | 169 |
| activities_recreation | Axe Throwing, Laser Tag, Go-Karts, Paintball, Trampoline Parks, Horseback Riding, Recreation Centers | 170 |
| sports_fitness | Personal Training | 171 |
| shopping | Grocery, Sporting Goods, Toys, Bookstores, Beauty Supply | 175 |
| pets | Pet Sitting | 178 |
| home_local_services | House Painting, Storage, Contractors, Home Security | 180 |
| auto_transportation | Auto Parts, Dealerships, Gas Stations, Transportation Services | 181 |

Keys for the new tags are in `evidence/16_new_tag_keys.json` (snake_case of the name, e.g. `go_karts`).

**Retired (2, both with 0 uses anywhere, keep-existing retirement):** Pet Friendly Places, Pet Friendly Stays (item 178).

**Customer-only (7, item 185):** Dating, Date Night, First Date, Double Date, Couples, Group Hangouts, Make New Friends.
Business-selectable Dating & Social tags: Speed Dating, Singles Events, Social Clubs.

**Not created (by decision):** Locksmith (flagged for review only, item 180), Baseball, Softball, Hockey, Cruises,
Dance Fitness, Department Stores, Kids Classes (wordings or nothing).

**Other values:** gathering format `league` (vocabulary + CHECK, item 171); max 5 secondary categories per business (row 47).

**Need tags after the pass (51):** today's 10 plus Grocery, Nails, the 6 lodging tags (Hotels, Resorts, Vacation Rentals,
Spa Resorts, Family Resorts, Glamping), 6 pet service tags, 14 home service tags, 13 auto service tags (full list:
`mapping.json` -> `need.NEED_TAG_KEYS_after`). Camping, Massage and Spa Day stay wants.

## 4. Affected surfaces

### 4A. Stored data (live, 2026-10-11)

| What | Finding |
|---|---|
| Rows storing a group key (every registered group column) | 1 row, `brand_partners.category = food_drink` (Coastal Coffee). **No stored `stay_getaway`, `activities_recreation`, `arts_culture_learning` or `travel_experiences`.** |
| Rows storing a moved tag name | `gatherings.interest_tag = 'Sports'` (2), `communities.interest_tag = 'Fitness'` (1), `profiles.interests` (Hiking 2, Travel 2; neither moves). Tag names don't change, so no rewrite. |
| Businesses / applications | 1 active business (Coastal Coffee, group-only Food & Drink), 1 approved test application with no group. |
| **Group-only declarations that would stop covering a tag** | **None in live data.** Coastal Coffee only GAINS Tea and Distilleries (it serves its whole group). The query (`sql/14_business_impact.sql`) was proven against fixtures (`sql/15`, `evidence/15`): a group-only Activities business would stop serving the 18 moved sports tags and Boating / Water Sports and start serving the 7 new ones; a group-only Stay & Getaway business is renamed to Travel & Getaways and stops serving Pet Friendly Stays. Re-run it right before migrating in case real businesses have signed up. |
| Search history (`intent_submissions`, `intent_outcomes`) | Historical "as asked" logs: left as is. Category trends re-bucket moved tags into their new group, including past weeks (computed at read time from `category_tags`). |

### 4B. Database objects to change in the migration

- `category_tags`: move 30 rows' `group_key` through the canonical path (`admin_preview_category_change` +
  `admin_*_category_tag`), insert 24, retire 2, set the customer-only marker on 7 (new column, opposite of `business_only`).
- CHECKs naming group keys: `brand_partners_category_check`, `business_partner_requests_category_check` (add
  `sports_fitness`; drop `stay_getaway` after the row update, which touches 0 rows today).
- Functions with hard-coded group keys: `category_major_keys()`, `update_business_profile(...)` (new key in, old out).
  `create_plan_addon_request` names `arts_culture_learning`, which is kept: no change. Check
  `pg_get_function_identity_arguments` so no second overload appears.
- Customer-only enforcement (beside `_reject_business_only_consumer_tag`): signup, dashboard edit, serve.
- Gathering `format` CHECK: add `league`.
- `category_synonyms`: insert the approved wordings through the canonical synonym path. 231 are unmapped today, 19
  already land where approved, **25 change today's landing on purpose** (e.g. "movie theater" Theater -> Movies,
  "bed and breakfast" Breakfast -> Hotels, "craft spirits" Crafts -> Distilleries, "pet hotel" Hotels -> Pet Boarding;
  full list `evidence/13_resolves_today.json`). No wording clashes with a live synonym or a different canonical name
  (7 overlaps all point at the same tag; `evidence/12`).
- Behavior-preservation test in the same transaction: every one of today's 241 tags still resolves, every need tag
  exists, server search keys equal the app's.

### 4C. App code (non-test) that names a changed group

| File | What it does with the group | Needed change |
|---|---|---|
| `constants/gatheringCategories.js` | `CATEGORY_GROUPS` (client copy of the table), `NEED_GROUP_KEYS`, `NEED_TAG_KEYS` | mirror the mapping; D3 split |
| `constants/placeCategories.js` | place-category list + Google type per group (`activities_recreation: 'gym'`, `stay_getaway: 'lodging'`) | add `sports_fitness: 'gym'`; Activities gets a recreation type; merge stay into travel |
| `services/places.js` | Google type -> group (`gym`, `stadium` -> activities; `lodging`, `rv_park` -> stay) | `gym`/`stadium` -> sports_fitness; lodging -> travel_experiences |
| `constants/businessCategoryClassifier.js` | keyword -> group for business onboarding (gym, yoga, tennis... -> activities; hotel... -> stay) | split keywords to sports_fitness; stay keywords -> travel_experiences |
| `constants/gatheringCategoryStyles.js` | group icons | add sports_fitness icon; drop stay_getaway |
| `constants/discoverCategoryRail.js` | primary rail chips | D5 |
| `constants/intentRoutes.js` | `exercise`, `play_sports`, `group_activity` route to activities_recreation | D6: add sports_fitness |
| `services/surpriseMeLogic.js` | "active" mood pool = Activities tags; `THINGS_TO_DO_GROUPS` | D6 |
| `utils/openEndedAsk.js` | `DAYTIME_GROUPS` time tilt; D3 exclusion list | D6, D3 |
| `utils/planAsk.js` | `ACTIVITY_GROUPS` | D6 |
| `constants/skillLevel.js` | `ACTIVITY_GROUPS` decides when a skill level applies | D6 (otherwise yoga / climbing lose skill levels) |
| `constants/interestGraph.js` | group list incl. `stay_getaway` | drop / merge |
| `constants/onboardingInterests.js`, `planAddons.js`, `gatheringIndoorOutdoor.js`, `askFacets.js` | name kept keys (outdoors, arts) | no change; re-test |
| `i18n/askNoteView.js` | parses "Arts, Culture & Learning" (contains ", ") | update for the new label |

Tag-name references (1,431 tag/file pairs, `evidence/09`) don't change because names don't change; 37 files reference a
moved or customer-only tag and need only a re-run of their tests. `scripts/taxonomy/build-code-dependencies.js` +
`sync-code-dependencies.js` must be re-run after the pass.

### 4D. Edge functions (redeploy after editing)

`business-onboarding-assistant`, `screen-business-content`, `submit-business-application` each hold a `VALID_CATEGORIES`
list with `stay_getaway` and without `sports_fitness`. The onboarding assistant's prompt example ("a gym/fitness ... is
activities_recreation") must change to `sports_fitness`.

### 4E. Translations (11 languages)

1 new group label (Sports & Fitness), 2 changed labels (Arts, Culture & Events; Travel & Getaways), 1 removed
(`stay_getaway`), 24 new tag names, the `league` format label. All machine-authored -> they join the native-review
backlog.

### 4F. Business web export

`docs/business.html` embeds the group and tag lists (59 affected names): regenerate after the pass
(`NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business npx expo export -p web`, `scripts/taxonomy/check-signup-export.js`).

### 4G. Tests, journeys, live checks

35 test / journey / live-verify files name a changed group key (e.g. `categoryMapping.test.js`, `needGroups.test.js`,
`discoverCategoryRail.test.js`, `businessCategoryClassifier.test.js`, `onboardingInterestsMigration.test.js`,
`journeys/categoryTrends.journey.js`, 9 `scripts/live-verify/*.sql`). New regression tests the spec asks for: the four
grocery examples (item 175), every approved wording, the seed-parity test, customer-only enforcement, max 5 secondary,
`league` accepted.

### 4H. Rules the migration must keep (spec checklist)

- One primary + up to 5 secondary categories; secondary categories and attributes stay two separate lists (row 48).
- No new ranking, routing or business-demand weight for any new tag.
- Never-learned categories unchanged; Pharmacy stays business-only clinical.
- Ids and keys permanent: moves update `group_key` only; retirements keep the row.

## 5. Proposed order (one migration, one transaction)

1. Add `sports_fitness` to CHECKs, `category_major_keys()`, `update_business_profile`.
2. Insert the Sports & Fitness group; move the 20 Activities tags (canonical path).
3. Move the 10 Stay & Getaway tags; update any row storing `stay_getaway` (0 today); drop `stay_getaway` from CHECKs and functions.
4. Rename the two labels; insert the 24 new tags; retire the 2; set customer-only on 7.
5. Add format `league`; insert the approved wordings.
6. In-transaction assertions (section 4B last bullet), then commit. Dry run rolled back first.

Then in code: the section 4C-4G changes, one commit, tests + journeys, regenerate the web export, redeploy the three
functions, re-run the code-dependency inventory.

## 6. What this prep does not cover

- No migration written, nothing applied, no from-scratch replay.
- The approved wordings are only the phrases the spec spells out; where the spec writes "..." nothing extra was invented.
- Group-only impact is measured on today's live data (1 real business); re-run `sql/14` before migrating.
