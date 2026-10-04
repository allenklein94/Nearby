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
| 15 | Wording: night market -> Markets; cinema / movie theater -> Movies; stand-up / standup -> Comedy; nightlife event -> Nightlife | item 173, LOCKED |
| 16 | Wording: gallery / galleries -> Art Galleries; exhibition -> Exhibits; art show / art fair -> Art; local event / local events -> Community Events; book event / book signing / author talk / book club -> Reading | item 174, LOCKED |
| 17 | New Shopping categories **Grocery, Sporting Goods, Toys, Bookstores, Beauty Supply** (+ their wording) | item 175, LOCKED |
| 18 | Shopping wordings (see item 175 table) | item 175, LOCKED |
| 19 | Need list after the Travel / Stay merge: `stay_getaway` leaves `NEED_GROUP_KEYS`; its stay tags join `NEED_TAG_KEYS` (see item 175 note) | item 175, LOCKED |
| 20 | Wording: facial / facials -> Skin Care; skincare -> Skin Care; beauty salon -> Salons | item 176, LOCKED |
| 21 | **Nails** joins `NEED_TAG_KEYS` | item 176, LOCKED |
| 22 | Wording: children's activities / kids activities -> Kids Activity; kids classes / educational activities -> Kids Education (exactly these four) | item 177, LOCKED |
| 23 | Pets wordings (item 178 table, plus pet food -> Pet Stores) | item 178, LOCKED |
| 24 | New category **Pet Sitting** (Pets) + wording pet sitter, cat sitter | item 178, LOCKED |
| 25 | Retire **Pet Friendly Places** and **Pet Friendly Stays** (keep-existing; 0 uses); pet-friendliness is the attribute only | item 178, LOCKED |
| 26 | `pets` leaves `NEED_GROUP_KEYS`; Veterinary, Pet Boarding, Dog Walking, Pet Sitting, Pet Training, Pet Stores join `NEED_TAG_KEYS` (Grooming already there); Pet Friendly Stays leaves the item-175 list | item 178, LOCKED |
| 27 | Travel & Getaways wordings (item 179 approved table) | item 179, LOCKED |
| 28 | Resolver bug fix: bed and breakfast / b&b -> Hotels, never Breakfast (regression test) | item 179, LOCKED |
| 29 | Keep Romantic Getaways, Family Resorts, Spa Resorts as canonical categories (not attribute + stay) | item 179, LOCKED |
| 30 | New categories **House Painting, Storage, Contractors, Home Security** (Home & Local Services) + their wording | item 180, LOCKED |
| 31 | Home services wordings + AC fix (ac repair / air conditioning / heating / furnace -> HVAC, never Repairs) | item 180, LOCKED |
| 32 | `home_local_services` leaves `NEED_GROUP_KEYS`; every service tag of the group (incl. the four new) joins `NEED_TAG_KEYS` | item 180, LOCKED |
| 33 | FLAG for the final mapping review: **Locksmith** (not canonical today; not created here) | item 180 |
| 34 | New categories **Auto Parts, Dealerships, Gas Stations, Transportation Services** + their wording | item 181, LOCKED |
| 35 | Auto wordings + used cars fix (used cars / new cars / buy a car -> Dealerships, never the Cars hobby tag) | item 181, LOCKED |
| 36 | `auto_transportation` leaves `NEED_GROUP_KEYS`; every service tag (incl. the four new) joins `NEED_TAG_KEYS`; the need check reads the RESOLVED TAG (`src/utils/needTagLevel.regression.test.js`) | item 181, LOCKED |
| 37 | Education & Classes wordings (item 182 table; bare "business class" and bare "training" stay unmapped) | item 182, LOCKED |
| 38 | Plural rule fixed in the ONE normalization (all four copies: client `key`, web signup `applyKey`, server `_category_phrase_key` + `_category_search_key`) so -es plurals (classes, beaches, boxes) resolve like their singular; no duplicate plural wordings (`src/constants/pluralNormalization.regression.test.js`) | item 182, **APPLIED 2026-10-03** (migration `20270279`) |
| 39 | `education_classes` is per-tag for needs; only **Tutoring** and **Certifications** are in `NEED_TAG_KEYS` | item 182, **APPLIED 2026-10-03** (need side; the group leaves `NEED_GROUP_KEYS` for the open-ended rule in the pass) |
| 40 | Community & Volunteering wordings (item 183 table) + faith wordings church / temple / mosque / synagogue -> Faith & Spirituality (search resolution only; land together with the search-log strip below) | item 183, LOCKED |
| 41 | -ies plurals in the one plural rule (ordinary English, -ie exception list) + Faith & Spirituality never learned | item 183, **APPLIED 2026-10-03** (migration `20270280`) |
| 42 | Business & Networking wordings (item 184 table; lawyer / printing / marketing, bare expo / startup stay unmapped) | item 184, LOCKED |
| 43 | `business_networking` per-tag needs (Coworking, Finance, Real Estate) + not-LinkedIn guard + Job Title out of the dating match % | item 184, **APPLIED 2026-10-03** (no migration; the group leaves `NEED_GROUP_KEYS` for the open-ended rule in the pass) |
| 44 | Dating & Social wordings (item 185 table) | item 185, LOCKED |
| 45 | **Customer-only marker** (opposite of `business_only`): Dating & Social business-selectable only for Speed Dating, Singles Events, Social Clubs; the rest customer-only, for primary AND secondary; signup (app + web), dashboard editing, server validation, routing (`business_served_tags`) and category views read the same flags | item 185, LOCKED |
| 46 | Concrete category beats a dating category ("first date coffee" = Coffee) | item 185, **APPLIED 2026-10-04** (no migration) |
| 47 | **Max 5 secondary categories per business** (a business-assignment product rule, not a property of any category): enforced in app + web signup, dashboard editing, `update_business_profile` / `enforce_category_tags_array` / signup edge function, and the migration; one primary; primary + secondary from the same canonical taxonomy; attributes unlimited | item 186, LOCKED |
| 48 | **Secondary categories and attributes stay two separate lists** (`categories` routes and places in category views; `attributes` only rank/explain, never route, never stand in for a category); checklist item: no surface, API or migration merges them | item 186, LOCKED |

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

## Item 173: Entertainment & Nightlife coverage

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Live Music, Concerts, Comedy, Movies, Theater, Dancing, Karaoke, Trivia, DJs, Festivals, Casinos | subcategories of Entertainment & Nightlife | covered |
| Clubs | subcategory Nightclubs; "nightclub", "night club", "dance club", "club night" already map to it | covered. Bare "club" stays unmapped on purpose (sports, tennis, social, book clubs) |
| Shows | gathering format `show` (item 66), with Theater / Performing Arts / Comedy as the category | covered; not a category |
| Nightlife Events | subcategory Nightlife | covered; add "nightlife event" wording for clarity |
| **Night Markets** | nothing ("market" alone is Markets, under Shopping) | wording "night market" -> Markets (the evening part is the gathering's own time); not a new category |
| Movies (wording) | "movie theater" today also hits Theater | wording "cinema", "movie theater" -> Movies, so the longer phrase wins |
| Comedy (wording) | "stand-up" not mapped | wording "stand-up", "standup" -> Comedy |

The group also keeps Music, Gaming, Performing Arts, Arcade, Mini Golf, Escape Rooms, Special Events, Street Events,
Board Games and D&D (nothing removed or moved).

**Tonight and Happening Now already exist, and are time, not taxonomy** (they apply to every group, nothing to
migrate): the Gatherings "Tonight" filter (later today from 6 PM, the same boundary as the "Tonight · 7 PM" line),
Discover's sections in order Now, Tonight, Because you like, Friends are into, Trending, This Weekend, Home's
Starting Soon (within 30 min) and the Right Now window (started up to 30 min ago or starting within 2 h). Typed
"tonight" / "right now" asks rank by the spontaneity scale (item 46). No category gets special time behavior.

**Owner decision (2026-10-03, LOCKED):** all four wordings approved; "movie theater" must resolve to Movies only (the
longer phrase wins over Theater; the migration adds a regression test for it). Bare "club" stays unmapped. Shows stays
the gathering format Show. Tonight, Happening Now, Starting Soon and Right Now stay cross-category time features: no
nightlife-specific time rules and no new categories in this pass. Entertainment & Nightlife membership unchanged (23).

## Item 174: Arts, Culture & Events coverage

The group is renamed Arts, Culture & Events (item 168, stored key kept). Its own tags today: Reading, Art,
Photography, Crafts, Art Galleries, Art Classes, Pottery, Cultural Events, History, Libraries, Music Lessons,
Collecting, Fashion. Nothing proposed to move in or out.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Cultural Events | subcategory (this group) | covered |
| Galleries | subcategory Art Galleries; bare "gallery" does not match it | wording "gallery" -> Art Galleries |
| Museums, Historic Sites | subcategories, **Attractions & Things to See** (kept as its own group, item 168) | covered (other group) |
| Exhibitions | subcategory Exhibits (Attractions) + gathering format `exhibition`; "exhibition" as a search word does not reach the category | wording "exhibition" -> Exhibits |
| Performing Arts, Theater, Festivals | subcategories, **Entertainment & Nightlife** (membership locked in item 173) | covered (other group); not moved |
| Lectures | subcategory, **Education & Classes** | covered (other group) |
| **Art Shows** | nothing | wording "art show", "art fair" -> Art (format `exhibition` says how it runs) |
| **Local Events** | Community Events / Neighborhood Events (Community group); nothing maps "local event" | wording "local event" -> Community Events |
| **Book Events** | Reading, Libraries; nothing maps the phrase | wording "book event", "book signing", "author talk", "book club" -> Reading |

**"Event" as an object type AND an attribute: already the model, nothing new proposed.** The event object is the
gathering (events are gatherings, item 92: one table, one lifecycle, one set of actions). How it runs is the gathering's
host-declared `format` (item 66): concert, show, festival, exhibition, market, party, competition, tournament, meetup,
tour, workshop, class... and a few categories that ARE a format map to it (Concerts -> concert, Festivals -> festival,
Exhibits -> exhibition). Category says what it is about, format says what kind of event it is. A separate "Event"
object or an "Events" category would be a second representation of the same thing (one source of truth, item 87) and
is not proposed. Business-side, a business offering an event reaches people through availability postings and
gatherings it hosts, both already in the model.

**Owner decision (2026-10-03, LOCKED):** all five wording rows approved (gallery, exhibition, art show / art fair,
local event, and the book phrases book event / book signing / author talk / book club -> Reading). Bare "club" stays
unmapped (item 173); only the full phrase "book club" reaches Reading. **Event = gathering + format** is locked: the
gathering is the one event object, lifecycle and source of truth; its format says what kind of event it is; its
category says what it is about; format-like categories keep their existing format mapping. No separate event object,
no Events category, no second event representation or lifecycle. Arts, Culture & Events membership unchanged (13).

## Item 175: Shopping coverage

Shopping today: Farmers Markets, Thrift & Vintage, Florist, Party & Event Decor, Gift Shop, Boutiques, Clothing,
Jewelry, Home & Furniture, Electronics, Markets, Pop-Ups, Local Shopping, Camera Shops. The Everyday / Specialty /
Local headings are not stored. Shopping stays a place a business can describe itself, never a retail feed or directory
(item 64, creep guard).

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Clothing, Jewelry, Electronics, Boutiques, Markets, Farmers Markets | subcategories | covered |
| Gifts | Gift Shop; "gift", "present" already map (item 161) | covered; add "gift store" |
| Vintage, Thrift | Thrift & Vintage (no wording for the single words) | wording thrift store / thrift shop / vintage store / consignment -> Thrift & Vintage |
| Furniture, Home Décor | Home & Furniture (no wording; Party & Event Decor is a different thing) | wording furniture / home decor / home goods -> Home & Furniture |
| Shoes | nothing | wording shoe store / shoes / sneakers -> Clothing |
| Flea Markets | nothing | wording flea market / swap meet -> Markets |
| **Grocery** | nothing | new category; wording grocery store / supermarket |
| Convenience | nothing | wording convenience store / bodega / corner store -> Grocery |
| **Sporting Goods** | nothing | new category; wording sports store / sporting goods store |
| **Toys** | nothing | new category; wording toy store / toy shop |
| **Books** | the book wording now maps to Reading (item 174) | new category **Bookstores**; wording bookstore / book shop / bookshop (longer phrase wins; bare "books" stays Reading) |
| **Beauty** | Wellness & Beauty holds beauty SERVICES (Salons, Nails, Skin Care) | new category **Beauty Supply** (products); wording cosmetics / makeup store / beauty supply / beauty store |
| **Pharmacy** | Pharmacies exists as a BUSINESS-ONLY clinical tag (Health & Personal Care) | **no change:** never a consumer category (2026-09-21 sign-off: Nearby never infers or routes a medical need) |
| **Department Stores** | nothing | **not added** (recommendation): chains are unlikely partners and the only honest mapping would be a guess across several categories; revisit through item 166 |

**Need vs want (item 162):** a need = a need category + the person's own task words. Grocery is the obvious everyday
need ("I need groceries tonight"), so the proposal adds it to `NEED_TAG_KEYS` beside Florist and Gift Shop; the other
new shopping categories stay wants unless framed as a task, exactly like Clothing today. This changes no weight or
rule, only which list a category is on.

**Found while checking (an item-168 consequence):** `stay_getaway` is a need GROUP today. After the merge into Travel &
Getaways, a group-level need flag would make Tours, Day Trip and other outings needs too. Proposal: the merged group is
NOT a need group; its stay tags (Hotels, Resorts, Vacation Rentals, ...) join `NEED_TAG_KEYS`, so "I need a hotel
tonight" stays a need and "day trip" stays a want, as today.

**Owner decision (2026-10-03, LOCKED):**
- **The five new Shopping categories, exactly:** Grocery, Sporting Goods, Toys, Bookstores, Beauty Supply. (Florist
  and Gift Shop already exist; Personal Training is the item-171 Sports & Fitness category.) No other categories.
- **Grocery joins `NEED_TAG_KEYS`.** Necessary, not sufficient: the item-162 task framing still decides. "I need
  groceries tonight" / "I need to get groceries" = need; "groceries near me" / "grocery stores" = want. A need follows
  the existing order only (availability -> proximity -> reliability -> personalization as a literal tie-breaker); no new
  weight or grocery logic. The migration must add the wording "groceries" (the plural trim does not reach "grocery")
  and regression-test all four examples.
- **Pharmacy** stays the business-only clinical tag; no consumer need matching. **Department Stores** not added.
- **Travel & Getaways is NOT a need group.** Need-capable lodging tags (places to stay): Hotels, Resorts, Vacation
  Rentals, Spa Resorts, Family Resorts, Pet Friendly Stays, Glamping. Wants (outings / trip types): Weekend Getaway,
  Staycation, Road Trip, Romantic Getaways, and every former Travel & Experiences tag (Travel, Day Trip, Tours,
  Excursions, Boat Tours, Adventure Experiences, Local Experiences). "I need a hotel tonight" / "I need a vacation
  rental" = need; day trip / tours / sightseeing = want. A correction for the merge, not a new need rule.
- **Global:** being on the need list never classifies an ask by itself; never from urgency, time, distance, booking
  rules, category alone, learned behavior, declared interests or AI.

## Item 176: Wellness & Beauty coverage

Wellness & Beauty today: Meditation, Spa Day, Self-Care, Massage, Salons, Barbers, Nails, Skin Care, Wellness Centers,
Sauna, Recovery. No new categories proposed.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Spas | Spa Day; "spa", "day spa" already map | covered |
| Massage, Barbers, Wellness Centers, Recovery, Meditation | subcategories | covered |
| Saunas | Sauna (plural matches) | covered |
| Hair Salons | Salons; "hair salon", "hairdresser", "haircut" already map | covered |
| Nail Salons | Nails; "nail salon", "manicure", "pedicure" already map | covered |
| Facials | nothing | wording "facial" -> Skin Care |
| Skincare | Skin Care (two words); the one-word spelling does not match | wording "skincare" -> Skin Care |
| Yoga | subcategory, **Sports & Fitness** (item 171) | covered (other group); not moved |
| **Beauty** | services live here; beauty PRODUCTS are Beauty Supply (item 175) | "beauty salon" -> Salons; bare "beauty" stays unmapped (services or products is ambiguous, like bare "club") |
| Wellness Classes | gathering format `class` + the category it is about (Yoga, Meditation...) | covered; not a category |

**Targeted offers already exist for this group, nothing new proposed:** a business answers matching requests
(opportunities -> offer), posts availability ("2 massage slots open at 4 PM"), creates occasion packages and perks
targeted at a category. Routing is category-aware, so a Massage request reaches massage businesses first.

**Need status (item 162):** Wellness & Beauty is deliberately not a need group (it is often a treat). Barbers and
Salons are need tags already ("I need a haircut"). Open question: should **Nails** join them ("I need my nails
done")? Recommendation: yes (an appointment-type upkeep task like a haircut); Massage, Spa Day and the rest stay wants.

**Owner decision (2026-10-03, LOCKED):** the three wordings approved; bare "beauty" stays unmapped (never guess
services vs products). **Nails joins `NEED_TAG_KEYS`** beside Barbers and Salons, task framing still required:
"I need my nails done" / "I need a nail appointment" = need, "nails near me" = want (all three regression-tested in the
pass). Wellness & Beauty is not a need group; Massage, Spa Day and the rest stay wants unless individually approved.
Commercial behavior unchanged (offers, availability, packages, perks, category-aware routing).

## Item 177: Family & Kids coverage

Family & Kids today: Family Playdate, Kids Activity, Family Events, Playgrounds, Indoor Play, Kids Museums, Camps,
Kids Sports, Birthday Activities, Family Dining. Already oriented to what parents do, not "kids businesses".

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Playgrounds, Indoor Play, Camps, Family Events, Birthday Activities, Family Dining | subcategories | covered |
| Sports | Kids Sports | covered |
| Children's Activities | Kids Activity (no wording for the phrase) | wording children's / kids activities -> Kids Activity |
| Kids Classes, Educational Activities | Kids Education (Education & Classes) | wording -> Kids Education |
| Museums | Museums (Attractions) and Kids Museums (here) | covered |
| Zoos, Aquariums | subcategories, Attractions & Things to See | covered (other group) |

**One museum in two places, no duplicate business: already the model.** A business is ONE row with one main
category plus secondary categories (`categories`) and declared attributes. A museum can be Museums (main) + Kids
Museums (secondary) + Family-friendly / suited ages, and it is matched and shown under both groups from that one row
(`business_served_tags`). Gatherings: one category each, plus host-declared family features (Family-friendly,
Stroller friendly...). Nothing to migrate for this.

**Two gaps found, NOT taxonomy (owner decision needed, outside the item-168 pass):**
1. **Web signup cannot add a secondary category from another group.** `submit-business-application` keeps only
   secondary tags of the applicant's main group, so a museum applying on the web cannot also pick Kids Museums. The
   app's dashboard profile editor already allows any category. Fix = let the web form keep secondary tags from any
   group (still real tags only).
2. **The Family & Kids view shows only things IN the group's categories.** A museum that declared Family-friendly but
   not Kids Museums does not appear there. Option: the Family & Kids view also includes results whose OWNER/HOST
   DECLARED a family quality (Family-friendly, Kids menu, Family seating, Stroller friendly) or a suited age range,
   never inferred from category. That is a Discover behavior change, separate from this taxonomy pass.

**Owner decision (2026-10-03, LOCKED):**
1. **Wordings:** exactly four, in the item-168 pass through the existing synonym structure (no new hierarchy):
   "children's activities" / "kids activities" -> Kids Activity; "kids classes" / "educational activities" -> Kids
   Education. (The earlier proposal's "things to do with kids" and "kids class" were not approved.) Museums is in
   **Attractions & Things to See** (never Arts & Culture); Kids Museums is in Family & Kids.
2. **Web signup gap: FIXED now** (a capability fix, outside the item-168 pass). The public form `docs/business.html` has
   "Also classify as", a search over the same embedded taxonomy as its main type search (the app's
   `businessTagOptions` universe, business-only tags included), and `submit-business-application` keeps any real,
   current tag from ANY group (registry check, retired dropped, max 10; the database trigger `enforce_category_tags_array`
   still validates). Same rule as the app apply screen and the dashboard editor. One record; nothing duplicated.
3. **Family & Kids view: BUILT now** (a behavior fix, outside the item-168 pass; `utils/familyDeclared.js`,
   `familyDeclared.test.js`). Discover's Family & Kids GROUP view (only that view; a leaf-tag view such as Indoor Play
   is unchanged) also includes a gathering whose host declared a family feature (Family-friendly, Stroller friendly,
   Family seating), a suited age range or the plan kind Family, and a perk whose business declared a family attribute
   (those three + Kids menu), a suited age range or Family in groups-we-take. Never the category alone, name,
   description, reviews, distance, popularity or AI. Also: a perk now joins any category view through its business's
   declared SECONDARY categories (it used to read only subcategory and major), so Museums + Kids Museums shows under
   both groups from one record. No category changes, no ranking/routing/privacy/demand change. Google Places and
   communities carry no family declaration and are unchanged.

## Item 178: Pets coverage

Pets today: Dogs, Cats, Dog Meetup, Dog Parks, Pet Friendly Places, Pet Events, Grooming, Pet Stores, Pet Boarding,
Dog Walking, Pet Training, Veterinary. Pet-friendly is already an attribute: `pet_friendly` (pets welcome) and
`dog_friendly` (dogs specifically) in the one business attribute vocabulary, read from asks ("with my dog", "pet
friendly"), matched against what businesses declared, and refused beside the No pets restriction (item 86).

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Dog Parks | subcategory ("dog park" -> Dogs + Dog Parks) | covered |
| Dog Grooming | "dog grooming" / "dog groomer" / "pet grooming" -> Grooming | covered |
| Pet Stores | subcategory; "pet shop" finds nothing | wording: pet shop, pet supply, pet supplies |
| Veterinary | subcategory; "vet" / "veterinarian" / "animal hospital" find nothing | wording: vet, vets, veterinarian, animal hospital, pet clinic |
| Pet Boarding | subcategory; "kennel" / "dog daycare" find nothing | wording: kennel, doggy daycare, dog daycare, pet hotel |
| Dog Walking | subcategory; "dog walker" finds nothing | wording: dog walker |
| Pet Sitting | **missing**, nothing maps | **new category Pet Sitting** (care in the owner's home, a different service from boarding) + wording pet sitter, cat sitter, house sitting for pets |
| Pet-Friendly Restaurants | Restaurants + `pet_friendly` / `dog_friendly` (already how "pet friendly restaurant" resolves) | covered by the attribute |
| Pet-Friendly Hotels | Hotels + the attribute ("dog friendly hotel" resolves this way) | covered by the attribute |
| Pet Activities | nothing maps | wording -> Pet Events + Dog Meetup (things to do with a pet, never the services) |
| Pet Events | subcategory | covered |
| (also) dog training | nothing maps | wording -> Pet Training |

**Conflict with "pet-friendly is an attribute":** two tags make pet-friendliness a category: **Pet Friendly Places**
(Pets) and **Pet Friendly Stays** (Stay & Getaway / Travel & Getaways). Production uses neither (0 gatherings, 0
businesses, 0 profile interests, no synonyms). Proposal: retire both in the item-168 pass with keep-existing (nothing to
move); the words "pet friendly places / stays" then resolve to the attribute alone, "pet friendly hotel" to Hotels +
the attribute. Pet Friendly Stays then leaves the item-175 need-tag list.

**Where the attribute does NOT reach today (platform-wide gaps, outside the taxonomy pass):**
1. **Gatherings cannot declare it.** The host-declared features list (9 keys) has no pet-friendly / dog-friendly, so
   "dog-friendly hike" can only lift businesses, never a gathering, and a gathering's business request never carries it.
   Proposal: add `pet_friendly` and `dog_friendly` to the gathering features (same recipe as outdoor seating, item 55;
   they then ride into the gathering's business request automatically).
2. Communities and Google Places carry no attributes at all (unchanged; no proposal).

**Need status:** Pets is a whole need GROUP today, so "find a dog park" or "I need a pet event" is ranked as a need.
Proposal (same pattern as Travel after item 175): Pets leaves `NEED_GROUP_KEYS`; the service tags join
`NEED_TAG_KEYS`: Grooming (already), Veterinary, Pet Boarding, Dog Walking, Pet Sitting, Pet Training, Pet Stores. Dogs,
Cats, Dog Meetup, Dog Parks and Pet Events stay wants. Task framing still required.

**Owner decision (2026-10-03, LOCKED):** all five approved.
1. Wordings as in the table, plus **pet food / pet supplies -> Pet Stores** (so "I need to get pet food" can be framed
   as a need). In the item-168 pass.
2. **Pet Sitting** is a new canonical category (a distinct service, like Pet Boarding and Dog Walking). In the pass.
3. **Pet Friendly Places and Pet Friendly Stays are retired** in the pass (keep-existing, nothing to move);
   pet-friendliness lives only in the `pet_friendly` / `dog_friendly` attributes.
4. **Gathering pet features: BUILT now, outside the pass** (migration `20270278`, live; "Pets welcome" / "Dogs welcome"
   in the host's feature chips, 11 languages; `scripts/live-verify/gathering-pet-dog-friendly-features.sql`,
   `gatheringPetFeatures.test.js`). Host-declared only, never inferred from category, title, description, place,
   business or AI; carried into the gathering's business request and its opportunity by the existing feature snapshot;
   lifts a gathering for a matching typed ask through the existing declared-feature pass. Communities and Google
   Places stay attribute-free.
5. **Need list:** the Pets group is not a need group; only Grooming, Veterinary, Pet Boarding, Dog Walking, Pet Sitting,
   Pet Training and Pet Stores are need-capable, with the task-framing rule still mandatory. Regression cases for the
   pass: "I need a dog walker" = need, "I need pet sitting" = need, "I need to get pet food" = need, "pet stores near
   me" = want, "dog parks" / "dogs" / "cats" / "dog meetup" / "pet events" = want.

## Item 179: Travel & Getaways coverage

After the item-168 merge, Travel & Getaways = Travel, Day Trip, Tours, Excursions, Boat Tours, Adventure Experiences,
Local Experiences (from Travel & Experiences) + Weekend Getaway, Staycation, Road Trip, Resorts, Hotels, Vacation
Rentals, Romantic Getaways, Spa Resorts, Family Resorts, Glamping (from Stay & Getaway; Pet Friendly Stays retired,
item 178) = 17 tags. Checked against the live search on 2026-10-03.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Hotels, Resorts, Vacation Rentals | subcategories ("hotel", "motel", "inn" -> Hotels) | covered; wording: cabin, cabin rental, vacation home, beach house -> Vacation Rentals |
| Attractions | own group Attractions & Things to See (kept, item 168); bare "attractions" finds nothing | wording: attractions, things to see -> the Attractions & Things to See group (broad, like a group name); not moved into Travel |
| Tours, Excursions | subcategories | covered |
| Cruises | nothing maps | wording: cruise, sunset cruise, dinner cruise, harbor cruise -> Boat Tours (what a local business sells); no Cruises category |
| Weekend Trips | "weekend trip" finds nothing | wording: weekend trip(s), weekend away -> Weekend Getaway |
| Road Trips, Staycations, Romantic Getaways | subcategories | covered |
| Family Getaways | "family getaway" / "family vacation" find nothing | wording -> Family Resorts (see the open question) |
| Camping / Glamping | Camping (Outdoors & Nature), Glamping (here); one group per tag | covered; wording: campground, campsite -> Camping |

**Wrong mapping found:** "bed and breakfast" resolves to **Breakfast** (Food & Drink). Fix: bed and breakfast, b&b ->
Hotels (the longer phrase wins; regression-tested in the pass).

**Open question (consistency with item 178):** Romantic Getaways, Family Resorts and Spa Resorts are, like the retired
Pet Friendly Stays, a stay type plus a quality that already exists as an attribute (`romantic` / `date_friendly`,
`kid_friendly`) or as a category (Spa). Production uses none of them (0 gatherings, businesses, interests). Two options:
(a) keep them as categories (you listed Romantic and Family Getaways), with the wordings above; (b) retire them like
Pet Friendly Stays, so "romantic getaway" = Weekend Getaway + `romantic`, "family resort" = Resorts + `kid_friendly`.
Recommendation: (a) for Romantic Getaways and Family Resorts (a getaway TYPE people plan around, and you named both);
Spa Resorts stays too (a resort type). Pet Friendly Stays differed because "pet friendly" is a house rule, not a trip.

**Needs (item 175, unchanged):** the stay tags (Hotels, Resorts, Vacation Rentals, Spa Resorts, Family Resorts,
Glamping) are need-capable with task framing ("I need a hotel tonight"); trips and tours stay wants.

**Owner decision (2026-10-03, LOCKED).** Specific phrase -> existing-category mappings only; the 19 groups and their
boundaries are unchanged; no new category or hierarchy (no Cruises, Family Getaways, B&B, Cabins, Beach Houses, Things
to See or Attractions category).

| Wording | Canonical destination |
|---|---|
| family getaway, family vacation | Family Resorts |
| cruise, sunset cruise, dinner cruise, harbor cruise | Boat Tours |
| attractions, things to see | the categories of Attractions & Things to See, via synonym rows (the group stays its own group, never folded into Travel) |
| cabin, vacation home, beach house | Vacation Rentals |
| weekend trip, weekend away | Weekend Getaway |
| campground, campsite | Camping |
| bed and breakfast, b&b | Hotels (bug fix: today it resolves to Breakfast; regression test that the lodging phrase wins) |

- **Romantic Getaways, Family Resorts, Spa Resorts stay canonical categories** (a type/purpose of stay people seek);
  never replaced by an attribute + generic stay. Pet-friendly differs: a property/gathering quality or house rule.
- **Needs unchanged:** only individually approved lodging/service tags, task framing required. Regression cases:
  "I need a hotel tonight" = need, "I need a vacation rental" = need, "family resorts" / "romantic getaways" /
  "harbor cruises" = want.
- **Remaining questions answered (2026-10-03, LOCKED):**
  1. "weekend trip", "weekend away" -> Weekend Getaway (wording only, no new category).
  2. **Camping is NOT need-capable.** The need list stays exactly as approved (stay/service tags only); Camping stays an
     Outdoors & Nature want. Regression cases: "campsite tonight", "camping this weekend", "campground near me" = want.
     A real Camping need pattern later goes through item 166.
  3. "attractions" / "things to see" use option (a): synonym rows mapping the phrases to the consumer tags of
     Attractions & Things to See (existing synonym structure; no group alias, no new object or storage level). The group
     stays its own canonical group.

## Item 180: Home & Local Services coverage

Today: Cleaning, Landscaping, Plumbing, Electrical, HVAC, Handyman, Moving, Pest Control, Repairs, Interior Design.
Checked against the live search on 2026-10-03.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Cleaning | subcategory ("house cleaning", "cleaner" work; "maid" finds nothing) | wording: maid, maid service, housekeeping, house cleaner -> Cleaning |
| Landscaping | subcategory ("landscaper", "gardener" find nothing) | wording: landscaper, gardener, yard work -> Landscaping |
| Lawn Care | nothing maps | wording: lawn care, lawn service, lawn mowing, mow my lawn -> Landscaping (lawn-care businesses are landscapers; no separate category) |
| Plumbing, Electrical, Handyman, Moving, Pest Control | subcategories | covered; wording: movers -> Moving; exterminator, bed bugs, termites -> Pest Control |
| HVAC | subcategory; "ac repair" goes to the generic **Repairs**, "air conditioning", "heating", "furnace" find nothing | wording: ac repair, air conditioning, ac, heating, furnace, heat pump -> HVAC (fixes the AC -> Repairs mis-route) |
| Home Repair | Repairs ("home repair" works) | covered |
| Painting | **missing** | new category **House Painting** + wording house painter, painter, interior painting, exterior painting; bare "painting" stays unmapped (art vs home) |
| Moving / Storage | Moving yes; storage **missing** | new category **Storage** + wording storage unit, self storage, storage space |
| Home Improvement, Contractors | **missing** | new category **Contractors** + wording contractor, general contractor, home improvement, remodel, remodeling, renovation, roofer, roofing |
| Security | **missing** | new category **Home Security** + wording security system, alarm system, home security, security cameras; bare "security" stays unmapped (guards, cybersecurity) |

**Not on your list, for you to decide:** Locksmith (an urgent, common local service; today nothing maps). Options: its
own category, or leave out until a real miss (item 166).

**Need behavior (the important part).** Today the whole group is a need group. For consistency with Travel and Pets,
make it tag-level: every service tag of the group is need-capable (Cleaning, Landscaping, Plumbing, Electrical, HVAC,
Handyman, Moving, Pest Control, Repairs, Interior Design + the new House Painting, Storage, Contractors, Home Security),
and the group itself is not a need group. Behavior is the same for these tags; it just stops a future non-service tag
from becoming a need by membership. Task framing stays mandatory: "I need a plumber" / "get my AC fixed" / "book a
cleaner" = need; "plumbers near me" = want (ordinary ranking).

**One limit to know about:** a problem described without a task word ("my sink is leaking", "the AC is broken") is not
a need today and does not resolve to a category. The wordings above make "AC", "bed bugs", "termites" find the right
service, but "my AC is broken" stays an ordinary ask unless a task word is present ("fix my AC" works). Recommendation:
keep it strict (item 162: never infer a need) and revisit only from real misses (item 166).

**Owner decision (2026-10-03, LOCKED):**
1. The four new canonical categories approved: House Painting, Storage, Contractors, Home Security, with their wordings
   from the table (bare "painting" and bare "security" stay unmapped).
2. Wordings approved: maid, housekeeping -> Cleaning; landscaper, gardener -> Landscaping; movers -> Moving;
   exterminator, bed bugs, termites -> Pest Control; ac repair, air conditioning, heating, furnace -> HVAC (never the
   generic Repairs). **Confirmed (same day):** lawn care, lawn mowing, mow my lawn -> Landscaping; ac, heat pump ->
   HVAC ("ac" matched as a whole word only, regression-tested). Bare "painting" and bare "security" stay unmapped.
   **Item 180 complete; items 175-180 settled.**
3. Per-category needs: the group is not need-capable; each service tag (incl. the four new) is, with task framing
   mandatory. Regression cases: "I need a plumber", "fix my AC", "book a cleaner" = need; "plumbers near me" = want;
   "my AC is broken" = want (a problem statement is not task framing). Never inferred from urgency, proximity,
   availability or the existence of a problem.
4. **Locksmith is not a canonical category today** (checked: no tag, no synonym). Not created here; flagged for the
   final V1 taxonomy mapping review.

## Item 181: Auto & Transportation coverage

Today: Car Wash, Detailing, Auto Repair, Tires, Oil Change, EV Charging, Car Rental, Parking, Towing. Checked against
the live search and the need classifier on 2026-10-03.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Auto Repair | subcategory ("mechanic", "car repair", "auto shop" work) | wording: body shop, collision repair, brakes, smog check, car inspection, windshield -> Auto Repair |
| Tires, Oil Change, Car Wash, Detailing, Parking | subcategories ("flat tire", "tire shop", "parking garage" work) | covered |
| Towing | subcategory; "tow truck" finds nothing | wording: tow truck, roadside assistance -> Towing |
| Auto Parts | **missing** | new category **Auto Parts** + wording car parts, auto parts store |
| Dealerships | **missing**; "used cars" goes to **Cars** (the car-enthusiast hobby tag in Activities) | new category **Dealerships** + wording car dealer, dealership, used cars, new cars, buy a car (fixes the used cars -> Cars mis-route) |
| Rentals | Car Rental; "rental car" finds nothing | wording: rental car, rent a car -> Car Rental; bare "rentals" stays unmapped (bikes, vacation, equipment) |
| Charging | EV Charging; "charging station" finds nothing | wording: charging station, ev charger, car charger -> EV Charging; bare "charging" stays unmapped |
| Gas | **missing** | new category **Gas Stations** + wording gas station, gas, fuel, fill up; "gas leak" listed as an unmatched phrase so it never becomes a gas station |
| Transportation Services | **missing** | new category **Transportation Services** + wording taxi service, car service, airport shuttle, shuttle service, limo, limousine, chauffeur, party bus. Bare "taxi", "uber", "lyft", "ride" stay unmapped: item 70 reads "by taxi / Uber" as HOW the person travels, and a dinner ask that says "we'll take a taxi" must not become a transportation request |

**Need behavior.** Same rule as items 175-180: `auto_transportation` leaves the need groups; every service tag (the nine
above + Auto Parts, Dealerships, Gas Stations, Transportation Services) is need-capable with task framing.

**Your example is already handled, and must stay so** (regression cases for the pass): "I need a tire changed today"
resolves to Tires + task framing = NEED, ordered by what is available today, then distance, then reliability; "What's
fun tonight?" = an open-ended WANT (ordinary ranking, service businesses left out). Also: "I need an oil change" = need,
"car wash near me" = want, "my car won't start" = want (a problem statement, item 180 rule), "tow truck now" = want
(no task word) but "I need a tow truck" = need.

**Implementation check for the pass:** today a deterministic ask such as "I need a tire changed" resolves to the GROUP
(Auto & Transportation) with the tag as its subcategory (Tires), and is a need because the group is a need group. Once
needs are tag-level, the need check must read that subcategory tag, or these asks silently become wants. The same
applies to Home & Local Services ("I need a plumber" -> group + Plumbing) and Pets. Regression-test each.

**Owner decision (2026-10-03, LOCKED):** all three approved. Four new categories; the wordings as in the table (bare
"rentals" and bare "charging" stay unmapped); "used cars" / "new cars" / "buy a car" -> **Dealerships** (one of the four
NEW categories, not an existing one; today it lands on the Cars hobby tag). Transportation is never a need group; each
approved service tag is need-capable with explicit task framing ("my car won't start" = want, "I need a tow truck" =
need). **The need decision runs on the final resolved canonical tag, never only the parent group**, for every
service-category need from items 175-181. Regression suite added now (before the migration):
`src/utils/needTagLevel.regression.test.js` runs the real deterministic resolver and the exact category the intent
resolver receives; it passes today (tire, oil change, plumber, haircut = need; fun tonight, car won't start, car wash
near me, plumbers near me, AC is broken = want) and lists as `todo` the cases whose wording or category only exists
after the migration (tow truck, fix my AC, dog walker, pet sitting, pet food, hotel tonight, and the want cases from
items 178-179); those turn into real tests in the pass.

## Item 182: Education & Classes coverage (LOCKED 2026-10-03)

Today: Workshops, Lectures, Cooking Class, Study Group, Language Exchange, Tech Meetup, Classes, Language Classes,
Technology Classes, Tutoring, Adult Education, Kids Education, Professional Development, Certifications, Dance Classes,
Technology. Art Classes, Music Lessons and Pottery live in Arts, Culture & Events (one group per tag; kept, item 174).
No new category is needed. Checked against the live search on 2026-10-03.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Cooking | Cooking Class; but "cooking classes" -> **Cooking** (the food hobby) | wording: cooking classes, cooking lessons -> Cooking Class |
| Art | Art Classes; but "art class" -> **Art** (the hobby), "painting class" finds nothing | wording: art class, painting class, drawing class -> Art Classes |
| Music | Music Lessons; "music class" -> **Music** (entertainment), "guitar / piano lessons" find nothing | wording: music class, guitar lessons, piano lessons, voice lessons, singing lessons -> Music Lessons |
| Dance | Dance Classes; but "dance class", "dance lessons" find nothing | wording: dance class, dance lessons, salsa lessons, ballet class -> Dance Classes |
| Languages | Language Classes; "language class", "spanish lessons" find nothing | wording: language class, language lessons, ESL, english class, spanish class / lessons -> Language Classes |
| Technology | Technology Classes; "coding class", "computer class" find nothing | wording: coding class, coding bootcamp, computer class, programming class -> Technology Classes |
| Business | nothing maps | wording: business course, business workshop, entrepreneurship class -> Professional Development; bare "business class" stays unmapped (an airline seat) |
| Professional Development, Workshops, Certifications | subcategories ("cpr certification" works) | covered |
| Tutoring | subcategory; "tutor", "math tutor" find nothing | wording: tutor, math tutor, homework help -> Tutoring |
| Kids Classes | "kids classes" -> generic Classes | already approved in item 177: kids classes -> Kids Education |
| Adult Classes | "adult classes" -> generic Classes | wording: adult classes -> Adult Education |
| Training | nothing maps | wording: job training, skills training -> Professional Development; bare "training" stays unmapped (Personal Training, Pet Training, jobs) |

**The class / classes mismatch is a matching bug, not missing wording.** The plural trim turns "classes" into
"classe", so the singular and plural of the same phrase land in different places ("art class" vs "art classes",
"cooking class" vs "cooking classes") or nowhere ("dance class"). Two ways to fix in the pass: (a) fix the plural rule
for -es words (class -> classes, also -ch / -sh / -x words) in the one normalization the synonym table, signup search and
emerging-category flagging share; or (b) add both forms as wordings. Recommendation: (a), with a regression test for
each pair above, because it fixes every such pair at once; (b) only for any pair (a) cannot reach.

**Need behavior.** Today the whole group is a need group, so "find a cooking class" counts as a need. Following items
175-181 (a group is never a need), only tags that are a task someone must get done are need-capable: **Tutoring** ("I
need a tutor for my son") and **Certifications** ("I need to get CPR certified"). Classes, workshops, lectures, lessons
and meetups are things people choose to do: wants. This deliberately changes "find a cooking class" from need to want
(ordinary ranking instead of availability-first); a regression case records it.

**Owner decision (2026-10-03, LOCKED):** all three approved. (1) The wordings as in the table: tutor / math tutor /
homework help -> Tutoring, adult classes -> Adult Education, kids classes -> **Kids Education** (item 177; the owner's
note said "Kids Classes", which is not a category, so it is recorded as the already-approved Kids Education and no new
category is created); bare "business class" (an airline seat) and bare "training" (Personal Training, Pet Training or
job training) stay unmapped. "I need to get CPR certified" needs the wording "certified" -> Certifications (today only
"certification" resolves). (2) **The plural rule is fixed once, globally**, in the shared normalization and its three
copies, so singular and plural resolve identically; never by storing both forms. No duplicate plural rows. (3) Only
Tutoring and Certifications are need-capable; classes, workshops, lectures, lessons and meetups are wants. "I need a
tutor for my son" = NEED, "I need to get CPR certified" = NEED, "find a cooking class" = WANT (an intentional change from
today's group-level NEED), "I need a cooking class" = WANT. "Need" alone, urgency, or looking for a class never makes a
need when the resolved category is not need-capable; the parent group is never a need and explicit task framing is still
required. **Not migrated:** regression cases recorded now (passing today: "I need CPR certification" = NEED, "business
class" / "training" unmapped, -s plurals consistent; `todo` until the pass: the tutor / CPR certified / cooking-class
cases in `needTagLevel.regression.test.js` and the -es plural pairs in `pluralNormalization.regression.test.js`).

**Owner follow-up (same day, LOCKED, APPLIED):** the non-taxonomy fixes were made now, the taxonomy migration stays
deferred. (1) "kids classes" -> Kids Education (item 177); no "Kids Classes" category. (2) Wording "certified" ->
Certifications added (migration `20270279`, client table, web signup page); "certification" keeps resolving through the
tag's own name. (3) **One plural rule, applied to all four copies together:** the app's `singular()`
(`src/constants/categorySynonyms.js`), the web signup page's `applySingular()` (`docs/business.html`), and the server's new
`_category_singular()` called by both `_category_phrase_key` and `_category_search_key`. -sses/-ches/-shes/-xes drop "es";
a singular ending in -che/-she/-sse drops its e so both forms agree. No stored key changed (no seeded phrase affected, 0
dismissals). (4) Cooking Class stays the exact canonical category ("cooking classes" used to land on the Cooking hobby
tag; it now reaches Cooking Class) and is want-only. (5) Needs: `TAG_LEVEL_NEED_GROUP_KEYS = ['education_classes']` in
`gatheringCategories.js` makes Education per-tag now (Tutoring, Certifications in `NEED_TAG_KEYS`); the group stays in
`NEED_GROUP_KEYS` only for the open-ended "something fun" rule, unchanged until the pass. **Two consequences handled:**
once "class" and "classes" share a key, the generic Classes tag would have beaten a named activity ("yoga class" ->
Classes, caught by the item-130 benchmark); a generic format key now yields to any other category in the query
("yoga class" = Yoga, "find a class" = Classes). Bare "business class" joins `UNMATCHED_PHRASES` so it stays unmapped.
**Still for the pass:** the other item-182 wordings (tutor / math tutor / homework help, adult classes, kids classes, the
class/lesson table), so "I need a tutor for my son" stays a `todo`. Verified: dry run rolled back (server keys equal the
app's on 24 words), applied, single overloads, the three emerging-category / synonym live scripts ALL OK; Jest 4714.

## Item 183: Community & Volunteering coverage (LOCKED 2026-10-03)

Today: Volunteering, Faith & Spirituality, Fundraiser, Charity, Community Events, Neighborhood Events, Cleanups, Donation
Drives. Fundraiser is also an occasion (item 42), unchanged. Checked against the live resolver on 2026-10-03.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Volunteer | Volunteering; but "volunteer", "volunteer opportunities", "community service", "give back" find nothing | wording: volunteer, volunteer opportunities, volunteer work, community service, give back, giving back -> Volunteering |
| Fundraisers | Fundraiser (singular and plural work) | covered |
| Community Events | Community Events | covered |
| Nonprofits | nothing maps | wording: nonprofit, non profit -> Charity (a nonprofit applying as a business also files here) |
| Local Groups | nothing maps | **not a category**: local groups are Nearby Communities (their own object, surface and tag); bare "local group" / "meetup" stay unmapped |
| Charities | Charity; but **"charities" finds nothing** | plural bug, see below |
| Cleanups | Cleanups ("beach cleanup", "park cleanup" work) | covered; bare "clean up" stays unmapped ("clean up my yard" is Cleaning) |
| Food Drives | nothing maps | wording: food drive, food bank, toy drive, clothing drive, blood drive -> Donation Drives |
| Community Meetings | nothing maps | wording: community meeting, town hall, public meeting -> Community Events; neighborhood meeting, HOA meeting, block party -> Neighborhood Events |
| Civic Events | nothing maps | wording: civic event, city council meeting, public hearing -> Community Events. No Civic category (taxonomy frozen; a meeting is a gathering with a format) |

**Gathering types.** These are already gathering categories (a host can tag a gathering Cleanups, Volunteering, Community
Events...), and "how it runs" already has the format values meetup, festival, market, party. No new format: a town hall
or a neighborhood meeting is a gathering in Community / Neighborhood Events with format meetup. Community-hosted
gatherings already exist (community visibility).

**-ies plural gap (follow-up to item 182's global rule).** item 182 fixed -es plurals; -ies still splits:
"charity" vs "charities", "gallery" vs "galleries", "library" vs "libraries", "bakery" vs "bakeries". Proposal: in the same
one rule (all four copies), a word ending -ies becomes -y, and a singular ending -ie also becomes -y, so both pairs agree
("charities" = "charity", "movie" = "movies"). One stored synonym phrase changes key ("patisserie"), updated in the same
migration. Same regression test file; applied now like item 182 (a resolver fix, not a taxonomy change), if approved.

**Need behavior.** Not a need group and no need tags: volunteering, giving and attending are things people choose to do.
"I need volunteer hours" = WANT (the category is not need-capable). No change.

**Not on the list, flagged:** church / temple / mosque / synagogue find nothing (Faith & Spirituality exists). Religion
is sensitive, so mapping those words is your call; recommendation: add them as wordings (they are the person's own words
in their own search, never stored on a profile), or leave unmapped.

**Owner decision (2026-10-03, LOCKED):** (1) Wordings approved as in the table, with "volunteer" / "community service" /
"give back" -> Volunteering, "nonprofit" / "non profit" -> Charity, "charities" via the plural fix; no Local Groups
category (Communities), "local group" and "meetup" unmapped, no Civic category, no new format. (2) Nothing in the group is
need-capable, no exceptions; "I need volunteer hours" = WANT. (3) **-ies plurals, corrected rule (APPLIED, migration
`20270280`):** ordinary English, not a blanket -ie -> -y rewrite. A word ending -ies keeps -ie when that singular is on the
one exception list (`IE_SINGULAR_NOUNS`: movie, cookie, patisserie, brasserie, smoothie...), otherwise becomes -y
(charities = charity, galleries = gallery, libraries = library, bakeries = bakery). Singular words are never rewritten
("patisserie" stays "patisserie"); ordinary -s plurals (movie/movies) go through the list, not the -y branch. Same four
copies as item 182 (app `singular()`, web `applySingular()` + `APPLY_IE_NOUNS`, server `_category_singular()`), the list
test-enforced identical; no stored key changed. (4) **Faith wordings approved for search resolution only.** Applied now
(same migration): Faith & Spirituality is never learned from any behavior: `record_behavior_event` and the redemption
trigger skip it, `get_my_behavior_categories` never returns it, and the client never sends it (`NEVER_LEARNED_CATEGORIES`
in `behaviorSignals.js` = server `_category_never_learned`, test-enforced); 0 rows existed. A person may still declare it
as their own profile interest (explicit, unchanged).

**Precondition before the faith wordings land (found while applying):** a typed ask that resolves to a category is
logged with that category permanently on `intent_submissions.category` (and the typed-ask audit interpretation), tied to
the person, and that column feeds the business demand aggregate (floored at 5) and the internal category trends. For
Faith & Spirituality that is a persistent record of a religious search. Proposal: in the same pass, the search logs store
no category for a never-learned category (the same way item 88 strips stated dietary and access needs from the logged
words), so the wording resolves the current search and leaves nothing behind. **Owner APPROVED and APPLIED (2026-10-03, migration `20270281`):** generalized as a persistence rule over the never-learned list; search log, tap log and typed-ask audit keep no category, words or title for it; a declared profile interest stays allowed. The faith wordings may land in the pass.

Verified: dry run rolled back (server keys equal the app's; a Faith search records nothing, Coffee still does), applied,
single overloads, the emerging-category / synonym and four behavior-learning live scripts all OK; Jest 4730.

## Item 184: Business & Networking coverage (LOCKED 2026-10-03)

Today: Networking, Coworking, Conferences, Professional Events, Entrepreneurship, Career Events, Real Estate, Finance
(Tech Meetup lives in Education & Classes; one group per tag, kept). Also related, not categories: occasion `networking`
(item 42), party type `coworkers` (item 43), occasion `business_meal`. Checked against the resolver on 2026-10-03.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Networking, Coworking, Conferences, Entrepreneurship, Career Events | subcategories (singular/plural work) | covered |
| Coworking wordings | "co-working", "shared office" find nothing | wording: co-working, shared office, shared workspace -> Coworking |
| Seminars | nothing maps | wording: seminar -> Professional Events + Lectures (one phrase, two tags, like gym -> Gyms + Fitness) |
| Business Events, Industry Events | nothing maps | wording: business event, industry event, trade show, trade expo, business expo -> Professional Events; bare "expo" unmapped |
| Professional Groups | nothing maps | wording: professional group, professional association, industry group -> Professional Events. Not a Communities replacement: a standing group is a Nearby Community |
| Entrepreneurship wordings | "entrepreneur", "startup event", "founders meetup" find nothing | wording: entrepreneur, startup event, startup meetup, founders meetup, pitch night -> Entrepreneurship; bare "startup" unmapped |
| Career Events wordings | "career fair", "job fair" find nothing | wording: career fair, job fair, hiring event -> Career Events |
| Business Services | Real Estate, Finance only; accountant / lawyer / printing / marketing find nothing | wording: accountant, accounting, bookkeeping, tax preparation, tax prep, financial advisor -> Finance; realtor, real estate agent -> Real Estate. Legal, printing, marketing: no category; stay unmapped (taxonomy frozen, item 166: add only on a confirmed real miss) |

**Need-behavior bug.** The whole group is in `NEED_GROUP_KEYS`, so "find a networking event tonight" and "looking for
a conference" are classified NEED today (availability-first ordering). Following items 175-182 (a group is never a need):
per-tag; need-capable = **Coworking, Finance, Real Estate** (services someone must get done); Networking, Conferences,
Professional Events, Entrepreneurship, Career Events = wants. Can be applied now like item 182 (`TAG_LEVEL_NEED_GROUP_KEYS`).

**Not LinkedIn (proposed lock).** The group exists so people can find business EVENTS and business SERVICES nearby. Never:
professional profiles beyond the existing optional dating-style "Job Title" basic (never searchable, matched or ranked on),
employer / résumé / skills / endorsements fields, job listings or applications, a professional people search or
"connect with professionals" feed, or professional-graph signals in ranking. Career Events and Networking are gatherings
like any other; meeting people there follows the existing rules (counts to strangers, friends by name).

**Owner decision (2026-10-03, LOCKED):** (1) wordings approved as in the table; lawyer, printing and marketing stay
unrecognized, no speculative categories or synonyms (revisit only through the item-166 live-market gap process).
(2) **Per-tag needs, APPLIED now (no migration):** `business_networking` joins `TAG_LEVEL_NEED_GROUP_KEYS`; Coworking,
Finance, Real Estate join `NEED_TAG_KEYS`; the group key is never a need; task framing still required. "find a networking
event tonight" / "looking for a conference" = WANT (regression cases in `src/utils/needTagLevel.regression.test.js`).
(3) **Not LinkedIn, LOCKED:** no professional people search/discovery, connection graph or connection signals; no
matching or ranking on employer, résumé, skills, endorsements or Job Title; no job listings or applications. The optional
Job Title basic stays as a profile fact only. **Fixed while locking it:** the dating compatibility report compared every
basic, so an identical job title raised the match % (shown on profiles, matches, Discover; it also orders Activity's
notice list); `job_title` is now excluded (`NEVER_COMPARED_BASICS` in `services/compatibility.js`). Guard
`src/constants/notLinkedIn.test.js`: job_title read only by its declaration, labels and that exclusion; identical titles
never change the score; no employer/endorsement/résumé/job-listing fields anywhere.

## Item 185: Dating & Social coverage (LOCKED 2026-10-04)

Today: Dating, Speed Dating, Singles Events, Group Hangouts, Date Night, First Date, Double Date, Make New Friends,
Couples, Social Clubs. Related, not categories: occasions `date_night` / `first_date` (and anniversary), party types `date`
/ `friends` / `new_people` / `groups`, attributes `date_friendly` / `romantic`, the People surface. `NEVER_SHARE_WITH_BUSINESS`
(interestGraph.js) already keeps Dating, Speed Dating, Singles Events and Group Hangouts off business payloads. Checked
against the resolver and production on 2026-10-04 (0 businesses, 0 applications, 0 gatherings in the group).

**"Dating = restaurants" is already prevented on the consumer side (item 85, kept):** a date ask never hard-filters by a
Dating & Social tag; the tag is the WHY (+2 lift for gatherings carrying it) and the inventory comes from every group
(cafés, bars, restaurants, things to do), with places qualifying only by a DECLARED `date_friendly` / `romantic`.

| Owner entry | Represented as today | Proposal |
|---|---|---|
| Date Night, First Date, Speed Dating, Group Hangouts | subcategories (+ occasions for the first two) | covered |
| Singles Events | subcategory; "singles mixer", "singles night" find nothing | wording: singles mixer, singles night, singles meetup -> Singles Events; bare "singles" unmapped (tennis singles) |
| Meet New People | party type `new_people` ("meet new people", "meet people" already set it); tag Make New Friends | no category: it is WHO, not WHAT; keep as the party type so it pulls from everywhere |
| Social Groups | Social Clubs; "social group(s)" find nothing | wording: social group, social groups -> Social Clubs (a standing group with members is still a Nearby Community) |
| Friend Activities | party type `friends` (+ host-declared friends plan, item 132) | no category, same reason as Meet New People |
| Social Events | nothing maps | no wording: "social event" is any gathering; the open-ended ask already searches across groups. Bare "mixer" unmapped |

**Gap 1, the business side (the real "Dating = restaurants" risk).** A business can pick Dating & Social as its major
(app + web signup) or a tag like Date Night. A major-only business serves its whole group (`business_served_tags`), so a
restaurant filed there would answer every Date Night / First Date request and show in the Dating & Social category view.
Proposal for the pass: only Speed Dating, Singles Events and Social Clubs are business-selectable (event organizers,
matchmakers, social clubs); Dating, Date Night, First Date, Double Date, Couples, Group Hangouts and Make New Friends are
consumer-only (an occasion or social context, never a kind of business), and the Dating & Social major is not offered as a
business's primary category unless it picks one of those three. A restaurant that is good for dates says so with
`date_friendly` / `romantic`. Needs a consumer-only flag (the inverse of `business_only`, item 56-style).

**Gap 2, a named market inside a date ask is lost.** "first date coffee" resolves to First Date, which the resolver turns
into the date lift with NO category, so the Coffee the person named filters nothing ("coffee date" works: Coffee + date).
Proposal (resolver fix, can apply now): when the words name both a Dating & Social tag and another canonical tag, the other
tag is the category and the dating tag the lift (`date_tag`). Regression: "first date coffee" = Coffee + First Date lift;
"date night" alone = no category, pulls from everywhere.

**Need behavior:** not a need group, no need tags. No change.

**Owner decision (2026-10-04, LOCKED):** (1) wordings approved as in the table; nothing in Dating & Social is
need-capable. (2) **Business/customer boundary, in the single V1 migration (not now):** a new customer-only marker, the
opposite of `business_only`. Business-selectable: Speed Dating, Singles Events, Social Clubs. Customer-only: Dating, Date
Night, First Date, Double Date, Couples, Group Hangouts, Make New Friends; never a business's main or secondary category.
A business good for dates uses `date_friendly` / `romantic`. Every surface reads the same flags after the migration: app +
web signup, dashboard category editing, server validation (CHECK / trigger / `update_business_profile`), routing
(`business_served_tags`: a major-only business never serves a customer-only tag) and consumer category views. One taxonomy,
no second category universe. Production taxonomy data unchanged until then. (3) **Concrete category beats a dating
category, APPLIED now (no migration):** `tagsForPhrase` prefers the longest non-dating phrase when the longest match is
only a Dating & Social tag (`isDatingTag`), and `resolveAsk` drops an AI dating guess when the words name a concrete tag.
"first date coffee" = Coffee + occasion first_date + party date; "coffee date" = Coffee + party date; "first date",
"date night", "speed dating" alone are unchanged. Regression: `src/utils/datingConcreteCategory.regression.test.js`.
Because `tagsForPhrase` is shared, the app's business-type search follows the same rule ("speed dating bar" offers Bars &
Lounges); the web signup form's own copy is unchanged until the migration regenerates it.

## Item 186: One primary category, many secondary classifications (LOCKED 2026-10-04)

The rule already holds in the schema (checked on production 2026-10-04). `brand_partners` has:

| Layer | Column | Answers | Enforced by |
|---|---|---|---|
| Primary group | `category` (one of the 19 majors) | what market | CHECK / allowed keys |
| Primary category | `subcategory` (one tag, must belong to `category`) | what it is | FK to `category_tag_groups` + `update_business_profile`; 0 rows violate it |
| Secondary categories | `categories text[]` (any real tags, any group) | what else it is | trigger `enforce_category_tags_array` |
| Attributes | `attributes text[]` (closed vocabulary of 40) | what it is like | CHECK |
| Other declared facts | `cuisine`, `offered_occasions`, `accommodates_party_types`, `dietary_options`, `booking_mode`, `price_level`, hours, capacities, `not_accommodated` | how it serves | their own CHECKs (items 72-88) |

Coastal Coffee on today's model: primary Food & Drink -> Coffee; secondary categories Breakfast, Dessert & Ice Cream;
attributes `date_friendly`, `group_friendly`, `outdoor_seating`, `pet_friendly`, `wifi`, `laptop_friendly` (= Work-friendly).
Routing reads primary + secondary categories (`business_served_tags`; a business with neither serves its whole group);
ranking and "Customer is looking for" read attributes. "Coffee & Cafés" is a display label for the Coffee tag; "café"
already maps to it (item 169); no rename (item 168: never migrate only for a label).

**Keep the two secondary lists separate (proposed lock).** The example mixes them; they must stay two lists: a secondary
CATEGORY is another market the business serves (routes requests, appears in that category view), an ATTRIBUTE is a quality
(ranks and explains, never routes, never a category view). Never one combined "secondary" list, never an attribute stored as
a category or the reverse.

**Gap: no cap on secondary categories.** Nothing limits `categories`, and every secondary tag widens routing, so a business
could declare dozens and receive requests in all of them ("category stuffing"), which undermines category-aware routing.
Proposal (in the V1 migration): at most N secondary categories (suggest 5), enforced in the same trigger and shown in
signup and the dashboard; the customer-only marker (item 185) applies to primary AND secondary. Attributes stay uncapped
(they never route). Prod today: 1 business, no overflow to convert.

**Owner decision (2026-10-04, LOCKED):** (1) secondary categories and attributes are two separate lists, never one
"secondary" list; attributes never route and never substitute for a category. (2) Max 5 secondary categories per business,
a business-assignment product rule (not a taxonomy property), one primary, same canonical universe, customer-only applies to
both, attributes unlimited; enforced in every signup / edit / server path in the V1 migration (pending rows 47-48).
**"Coffee & Cafés"** is only a display label: the canonical category stays Coffee (permanent key `coffee`), no stored rename.
Note: no surface shows that label today (English shows the stored name "Coffee"); showing it would be a display-name entry
(English beside the 10 translations in `vocab.categories.tags.coffee`), never a taxonomy change.

## Item 187: A gathering is described by what people will do, not a business category (APPLIED 2026-10-04)

Already the model. A gathering never stores a business major or a business classification; it stores what the host said:

| Owner field | Stored as today | Notes |
|---|---|---|
| Activity: Coffee | `gatherings.interest_tag` (one canonical tag) | the same tag vocabulary as businesses, so a request from it routes correctly; the group (Food & Drink) is derived server-side for routing only, never stored on the gathering |
| Purpose: Meet friends | `party_type` friends (+ host-declared friends plan, item 132); "Meet a friend" is a derived activity, never stored | occasion (birthday...) when there is one |
| Time: Tonight | `scheduled_at` (When preset, words-only) | never inferred from AI |
| People: 4 | `capacity` = TOTAL people incl. host | business party size = max(guests + 1, capacity) |
| Location: Nearby | `latitude` / `longitude` / `area` | the host picks a real place; "nearby" is the discovery view, not a stored value |
| Business request: Coastal Coffee | optional: "Request a specific business" (directed request, item 29) or "Ask nearby businesses" (`ask_local_businesses` + "Yes, look now") | a business is never required; the request is its own object (item 65) |

**Gap (presentation only):** Create's "From what you said" summary (`inferredSummary` in `utils/gatheringInference.js`)
opens with "Category: Food & Drink" (the business group) before "What: Coffee", and the What step's picker is labeled
"Category". Proposal: show the summary as Activity / Purpose / Time / People (drop the group row; it is never stored), and
label the picker "Activity" (group headings stay as picker sections). Display only: no column, routing, request or
ranking change; 11 languages for the new labels.

**Owner decision (2026-10-04, APPLIED, presentation only):** the summary shows only Activity (the canonical stored tag, shown
through the category-name lookup, never renamed) / Purpose (the existing "What kind of plan is this?" value, only when the
words or a chip said it; never from the activity, venue, timing or AI; it never replaces the activity: "first date coffee" =
Activity Coffee + Purpose Date) / Time (the When preset the words named) / People (only a number the person stated). The
group row and the derived "To do" row are gone, with no replacement. The first-step picker reads "Activity", with the group
headings kept as sections. **One related fix:** an AI-returned 2 for a date (no number in the words) is no longer shown as
People nor suggested as capacity (`statedSize` in `createParamsFromAsk`); a stated number still is. No schema, stored
value, routing, request, ranking or taxonomy change; the gathering's place stays the place the host picks ("nearby" is
discovery context). Edit's fill-only category picker (item 64) is unchanged. Tests: `gatheringInference.test.js` (item 187
block), `askToCreate.test.js`, `closedLoop.test.js`. Not device-tested (parse-checked); business web export regenerated.

## Item 188: Events (LOCKED + APPLIED 2026-10-04)

**Conflict, flagged rather than changed silently:** item 174 (LOCKED) says an event is a gathering + `format`, never a
separate Event object, Events category or second lifecycle. "Events need another model" would reverse that. Mapping the
owner's example shows the existing gathering already carries almost all of it, so the proposal keeps item 174:

| Owner field | Already on the gathering | Gap |
|---|---|---|
| Event type: Concert | `format` = concert (16 formats: concert, show, festival, tour...) | none |
| Category: Entertainment | `interest_tag` (Live Music / Concerts...), group derived; `genre` for music | none |
| Start 7 PM | `scheduled_at` | none |
| End 10 PM | `duration_minutes` (15-720, host-declared); the time engine already derives the end ("Happening now · until 10 PM") | cards show "About 3 hr", not "7-10 PM"; optional display-only follow-up |
| Venue: business/location | the place the host picks (`precise_lat/lng`, `area`); a business venue/co-host = `hosting_partner_id` | none |
| Capacity 500 | `capacity` (total people incl. host, no upper limit; joins waitlist when full) | none |
| Ticketing: required | nothing (only `price_level`) | **decision needed** (below) |
| Age 18+ | nothing; gathering 18+/21+ is PARKED (items 39/79/87 LOCKED: an eligibility system needing verified age, never a label) | **stays parked** unless the owner opens the verified-age design |
| Many contexts, no duplicates | one row, every surface reads it by id (item 134) and merges reasons (item 32) | none |

**Ticketing options (owner to choose):**
1. **Declared fact only (recommended if wanted):** an optional host-declared `ticket_required` on the gathering, shown as
   "🎟️ Ticket needed, bought separately". Nearby sells nothing, links nowhere (external links were declined in item 28),
   and join/capacity/ranking/routing are unchanged. One column + Create/Edit switch + display + 11 languages.
2. **Not built:** keep `price_level` as the only cost signal until a real event host needs it in the live market.
3. **Selling tickets in Nearby:** not recommended (real money: Stripe approvals; and the creep guard against reservation /
   ticketing platforms).

**Owner decision (2026-10-04, LOCKED):** (1) item 174 stands: an event is a gathering + `format`, one canonical record read
by id everywhere. Capacity = total people incl. the host, no upper limit, waitlist once full; no second capacity field and
never derived from People / purpose / category (the 5-secondary-category cap is a business taxonomy rule, unrelated).
(2) **Ticketing option 1 APPLIED** (migration `20270282`, live): `gatherings.ticket_required boolean not null default
false`, host-written through the existing RLS (verified live rolled-back: the host updates, a stranger updates 0 rows; the
25 existing gatherings unchanged). Create (Details) toggle + Edit switch "🎟️ Ticket needed, bought separately" with
"Just lets people know. Nearby doesn't sell tickets, and joining here doesn't include one."; shown in the gathering's
practical facts (card + detail) only when on; 11 languages (machine-authored). Nearby sells nothing, collects nothing,
links nowhere, holds no inventory; no join / capacity / waitlist / ranking / routing / recommendation / business-matching
code reads it (guard `src/utils/ticketRequired.test.js`: only the gathering service, display and the two screens touch it;
no function, policy, view, trigger or edge function). (3) **Age stays parked:** no age field or logic in V1; if revisited,
first define whether it means an age restriction, a recommended age or an audience. Not device-tested (parse-checked);
business web export regenerated.
