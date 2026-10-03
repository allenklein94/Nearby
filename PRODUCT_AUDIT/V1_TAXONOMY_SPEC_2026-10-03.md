# V1 taxonomy spec (owner items 168+, started 2026-10-03)

> Nearby's taxonomy exists to understand and connect consumer intent, real-world activities, gatherings, people,
> places, and businesses. It is not intended to function as a static directory of categories. (item 167)

This file collects the V1 taxonomy decisions as they arrive. **Nothing here is migrated yet.** When the full V1 spec is
complete, everything below lands in ONE migration pass (item 168), preceded by a complete old -> new mapping and an
affected-surface checklist for the owner's review. The pass is structural only: no ranking, routing, eligibility,
matching, privacy or business-demand change.

## Pending changes for the single migration pass

| # | Change | Source |
|---|---|---|
| 1 | Split Activities & Recreation -> new **Sports & Fitness** (gym / racquet / team / fitness tags) + remaining Activities & Recreation | item 168 |
| 2 | Merge Travel & Experiences + Stay & Getaway -> **Travel & Getaways** | item 168 |
| 3 | Rename Arts, Culture & Learning -> **Arts, Culture & Events** (display label; keep the stored key if safe) | item 168 |
| 4 | Keep Health & Personal Care and Attractions & Things to See as their own groups | item 168 |
| 5 | Food & Drink coverage gap: **Tea** (+ wording: tea, tea house, tea room, bubble tea...) | item 169 |
| 6 | Food & Drink coverage gap: **Distilleries** (+ wording: distillery, craft spirits...) | item 169 |
| 7 | New canonical categories under Activities & Recreation (the part that stays after the item-168 split): **Axe Throwing, Laser Tag, Go-Karts, Paintball, Trampoline Parks, Horseback Riding, Recreation Centers** (+ their own wording) | item 170, LOCKED |
| 8 | Wording: "adventure park", "ropes course", "zipline" -> existing **Adventure** (synonyms, not categories) | item 170, LOCKED |
| 9 | Sports & Fitness membership (the item-168 split), from the owner's list; see item 171 | item 171, proposed |
| 10 | New categories **Baseball, Softball, Hockey, Personal Training** (Sports & Fitness) | item 171, proposed |
| 11 | Wording: crossfit -> Gyms + Fitness; dance fitness / zumba -> Fitness; sports club / athletic club -> Sports | item 171, proposed |
| 12 | New gathering format value **league** (format vocabulary + CHECK, not a category) | item 171, proposed |

Result: 19 canonical groups.

## Item 169: Food & Drink coverage (coverage spec, not a hierarchy)

Every entry must be represented by the existing flat structure: group -> subcategory (tag) -> cuisine, plus synonyms,
attributes and dietary options. No Restaurants / Coffee & Cafés / Drinks / Other storage level and, for now, no
display-only sections.

| Owner entry | Represented as | Status |
|---|---|---|
| American, Italian, Mexican, Chinese, Japanese, Thai, Indian, Mediterranean, Seafood, BBQ | declared cuisine (`CUISINE_OPTIONS`) | covered |
| Fast Casual, Fine Dining | subcategory | covered |
| Vegetarian, Vegan | business-declared dietary option (item 88) | covered |
| Coffee | subcategory | covered |
| Café | synonym -> Coffee | covered |
| Bakery Café | Bakeries + Coffee | covered |
| Dessert Café | Dessert & Ice Cream + Coffee | covered |
| Brunch Café | Brunch + Coffee | covered |
| Bars, Cocktails, Lounges | synonyms -> Bars & Lounges | covered |
| Breweries, Wineries, Happy Hour | subcategory | covered |
| Bakeries, Food Trucks | subcategory | covered |
| Dessert, Ice Cream | synonyms of the one subcategory Dessert & Ice Cream | covered |
| Markets | subcategory under Shopping (one group per tag) | covered |
| Catering, Private Dining | attributes `catering`, `private_dining` (item 80) | covered |
| **Tea** | no subcategory, no synonym | **gap -> pending #5** |
| **Distilleries** | no subcategory, no synonym | **gap -> pending #6** |
| **Pizza, Burgers, Steakhouse** | item 77: no food-specialty subcategory; not a cuisine (not in `CUISINE_PHRASES`) | **missing representation, kept by decision** |

**Pizza / Burgers / Steakhouse, exactly what is missing:** they have no tag, cuisine or attribute, so they are only
findable as LITERAL search text (a gathering/community/offer whose own words contain "pizza"). A typed ask "pizza
tonight" gets no category from the deterministic rules (the AI classifier, when it runs, may still suggest a food tag). Start Something's Pizza / Burgers chips are only title quick-starts, not categories. Making them
structurally findable needs an item-77 decision (a specialty axis), which the owner has declined for V1.

## Item 170: Activities & Recreation coverage (coverage spec, not a hierarchy)

Same rule as item 169: existing flat layers first, one group per tag, nothing migrated now. This list has no sports,
so it is unaffected by the item-168 Sports & Fitness split (it describes the remaining Activities & Recreation).

| Owner entry | Represented as today | Status |
|---|---|---|
| Bowling | subcategory, Activities & Recreation | covered |
| Mini Golf, Escape Rooms | subcategories, **Entertainment & Nightlife** | covered (other group) |
| Arcades | subcategory Arcade, **Entertainment & Nightlife** (plural matches) | covered (other group) |
| Indoor Play | subcategory, **Family & Kids** | covered (other group) |
| Tours | subcategory, **Travel & Experiences** (Travel & Getaways after item 168) | covered (other group) |
| Classes, Workshops | subcategories, **Education & Classes**; also the `format` class / workshop (item 66) | covered (other group) |
| Group Activities | NOT a category: who-with = party type `groups` (item 43) + business attribute `group_friendly` (item 80) | covered by existing layers |
| Adventure Parks | nearest is the existing **Adventure** subcategory; no wording maps to it | **wording gap -> pending #8** |
| **Axe Throwing** | nothing (already the known unmapped example, item 128) | **new category -> pending #7 (LOCKED)** |
| **Laser Tag, Go-Karts, Paintball, Trampoline Parks, Horseback Riding** | nothing | **new category -> pending #7 (LOCKED)** |
| **Recreational Centers** | nothing (Gyms / Community Events are different things) | **new category -> pending #7 (LOCKED)** |

**Group Activities stays out of the category list on purpose:** a category would duplicate the group layer, and the
nearest tag, Group Hangouts, is in `NEVER_SHARE_WITH_BUSINESS`, so it must not become a business classification.

**Open question for the owner (placement, not decided):** Mini Golf, Escape Rooms, Arcades, Indoor Play, Tours,
Classes and Workshops already exist under other groups. One group per tag means listing them under Activities would be
a MOVE, which changes category routing for businesses that only declared the group (a group-only business serves its
whole group). Default is to leave them where they are; moving any of them must be decided explicitly and then joins
the item-168 old -> new mapping.

**Emerging activities** need no restructuring: a new leaf tag is one row through the canonical path, and business
signup wording surfaces candidates through the emerging-category loop (item 30). After V1, additions follow the
item-166 miss process (synonym first, new tag last).

**Owner decision (2026-10-03, LOCKED):** the seven are intentional V1 coverage, real canonical categories (distinct
activities people seek and businesses offer), not placeholders and not synonyms. They are added in the single item-168
migration through the normal category-change process, as ordinary leaf tags of Activities & Recreation: no new
hierarchy or storage level, no special ranking / routing / matching / business-demand behavior. A business that
declares one is routed and matched exactly like any other category. Existing categories are NOT moved into them to
populate them (existing mappings stand unless the final V1 mapping says otherwise; the placement question above is
answered: nothing moves). Adventure park / ropes course / zipline stay wordings of Adventure. Group Activities stays
out; Group Hangouts' never-shared-with-businesses rule is unchanged. Item 77 unchanged (no Pizza / Burgers /
Steakhouse). This does NOT reopen expansion: later activities follow item 166 (existing synonym / attribute / category
first, new category only when warranted).

**The migration pass must cover them in:** the old -> new mapping, the category table + client list
(`CATEGORY_GROUPS`) + seed-parity test, every category CHECK / registered column, translations
(`vocab.categories.tags.<key>` in 11 languages), the Discover rail / category view, routes, the static signup export,
the code-dependency inventory, and regression tests.

## Item 171: Sports & Fitness coverage (proposed, owner to confirm)

The owner's Fitness / Sports / Recreation headings are not stored (same rule as 169/170). This list also tells us what
the item-168 split moves.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Gyms, Yoga, Pilates, Cycling, Running, Martial Arts | subcategories (Activities & Recreation) | covered; move to Sports & Fitness |
| Pickleball, Tennis, Basketball, Soccer, Volleyball, Golf, Swimming | subcategories (Activities & Recreation) | covered; move to Sports & Fitness |
| **Personal Training** | nothing | new category (a service businesses sell, like Massage) |
| **CrossFit** | nothing | wording -> Gyms + Fitness (a brand name, so not its own category) |
| **Dance Fitness** | nothing (Dancing = Entertainment, Dance Classes = Education) | wording "dance fitness", "zumba" -> Fitness |
| **Baseball, Softball, Hockey** | nothing (only generic Sports) | new categories, same footing as Basketball / Soccer |
| Open Play, Tournaments | gathering format (item 66) | covered; not categories |
| **Leagues** | no format value | add format `league`; not a category |
| Training | format `class` + skill level (item 67) | covered; "training" alone stays unmapped (dog training = Pet Training) |
| **Sports Clubs** | nothing ("Social Clubs" is Dating & Social, different) | wording "sports club", "athletic club" -> Sports |

**Split membership (proposed):** Sports & Fitness = Fitness, Gyms, Personal Training, Yoga, Pilates, Cycling, Running,
Martial Arts, Sports, Pickleball, Padel, Tennis, Basketball, Soccer, Volleyball, Golf, Baseball, Softball, Hockey,
Swimming. Stay in Activities & Recreation: Bowling, Climbing, Walking, Skating, Water Sports, Boating, Adventure, Cars
and the seven from item 170. Kids Sports stays in Family & Kids. A move changes routing only for businesses that
declared the group alone (they serve every tag of their group); the migration's mapping must list them.

**Pickleball vs Padel: already separate canonical categories (item 75), kept.** Each has its own tag and key; they are
related siblings (with Tennis), which gives only a weak labeled lift ("Related to your interest in Pickleball"), never a
search match. "paddle" -> Pickleball; "paddle tennis" / "platform tennis" map to nothing; a canonical name can never be
taught as another tag's synonym (refused server-side). Both move to Sports & Fitness together.

New sports join the existing sport list (`SPORT_TAGS`), so Create asks Casual / Competitive for them like Basketball;
no other special behavior.
