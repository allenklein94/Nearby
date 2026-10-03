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
| 9 | Sports & Fitness membership (the item-168 split); final lists in item 171 | item 171, LOCKED |
| 10 | New category **Personal Training** (Sports & Fitness) | item 171, LOCKED |
| 11 | Wording: baseball, softball, hockey, sports club, athletic club -> Sports; crossfit -> Gyms + Fitness; dance fitness, zumba -> Fitness | item 171, LOCKED |
| 12 | New gathering format value **league** (format vocabulary + CHECK, not a category; it does not exist today) | item 171, LOCKED |
| 13 | Wording: scenic area / scenic spot / viewpoint / overlook -> Scenic Views; water activities -> Water Sports; nature center / nature preserve -> Parks + Wildlife | item 172, LOCKED |
| 14 | Move **Boating** and **Water Sports** from Activities & Recreation to Outdoors & Nature (Activities & Recreation drops to 11) | item 172, LOCKED |

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

## Item 171: Sports & Fitness coverage

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

**Owner decision (2026-10-03, LOCKED), supersedes the proposals above where they differ:** Personal Training is a real
canonical category (a service businesses explicitly sell, like Massage). Baseball, Softball and Hockey are NOT
categories: they are wordings of Sports (the generic Sports category represents individual sports), as are sports
club / athletic club. CrossFit -> Gyms + Fitness; dance fitness and zumba -> Fitness (there is no Dance Fitness
category). Leagues = a new format value `league`, never a category. Climbing and Skating ALSO move to Sports & Fitness.
Kids Sports stays in Family & Kids; Group Activities is not a category. No new hierarchy level; no special ranking,
routing, eligibility or matching for any of these. Personal Training is not added to the sport list (`SPORT_TAGS`), so
Create asks it no Casual / Competitive question.

**Final membership:**
- **Sports & Fitness (19):** Fitness, Gyms, Personal Training, Yoga, Pilates, Cycling, Running, Martial Arts, Climbing,
  Skating, Sports, Pickleball, Padel, Tennis, Basketball, Soccer, Volleyball, Golf, Swimming.
- **Activities & Recreation (11, after item 172):** Bowling, Walking, Adventure, Cars, Axe Throwing, Laser Tag,
  Go-Karts, Paintball, Trampoline Parks, Horseback Riding, Recreation Centers.

**Required before the migration runs:** the complete final mapping, including every business whose declaration is the
Activities & Recreation group alone (or that group plus no tag), since such a business today serves every tag of the
group and would stop covering the 18 tags that move. Nothing about a business's classification or routing changes
silently: the owner sees that list first.

## Item 172: Outdoors & Nature coverage

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Beaches, Parks, Hiking, Trails, Camping, Fishing, Kayaking, Paddleboarding, Surfing, Snorkeling, Diving, Wildlife, Gardens | subcategories of Outdoors & Nature | covered |
| Scenic Areas | subcategory Scenic Views (no "scenic area" wording) | wording -> Scenic Views |
| **Nature Centers** | nothing | wording -> Parks + Wildlife (smallest fix; a category only if owner wants it) |
| Water Activities | subcategory Water Sports (Activities & Recreation), no "water activities" wording | wording -> Water Sports |
| Boating | subcategory, Activities & Recreation | move to Outdoors & Nature (proposed) |
| Glamping | subcategory, Stay & Getaway (Travel & Getaways after item 168) | leave: it is a place to stay; one group per tag |

Outdoors & Nature also keeps Outdoors, Picnics and Gardening (not in the owner list; nothing removed).

**Weather sensitivity, what exists today:**
- **Gatherings:** every tag in Outdoors & Nature is outdoor automatically (`categoryEnvironment`). Weather is judged at
  each gathering's own start: indoor-worthy weather (storm, snow, heavy rain, >95F, <45F) sinks it, a good daylight
  window lifts it (+/-2 in typed asks, the Home weather card, Discover's / Gatherings' Outdoor view). Ranking only,
  never hidden. This is why moving Boating and Water Sports here matters: today they get no weather sensitivity at all.
- **Businesses:** sensitive only through what they DECLARED (`weather_setting` outdoor / weather dependent, or outdoor
  seating), never from their category (locked 2026-10-02). A kayak rental that never answered the weather question is
  treated as unknown.

Making it "stronger" would mean either raising the weather weight (a ranking change, outside this taxonomy pass) or
inferring weather from a business's category (reverses the 2026-10-02 rule). Neither is proposed here.

**Owner decision (2026-10-03, LOCKED):** Boating and Water Sports move to Outdoors & Nature (they are inherently
weather-sensitive, and this switches on the existing gathering weather behavior with no special case). Nature Centers =
wording of Parks + Wildlife, not a category. Glamping stays in Travel & Getaways (lodging; one group per tag). Scenic
Areas and Water Activities wordings as proposed. **Weather behavior unchanged:** Outdoors & Nature gatherings are
weather-sensitive at their own start time, reorder only, never hidden; businesses only through what they declared,
never from their category (2026-10-02 rule intact); no weight increase in this pass. Possible later, not built: put
the weather question up front at signup for outdoor categories.

**Outdoors & Nature (19):** Hiking, Outdoors, Camping, Fishing, Kayaking, Parks, Beaches, Trails, Paddleboarding,
Wildlife, Gardens, Scenic Views, Picnics, Surfing, Snorkeling, Diving, Gardening, Boating, Water Sports.
