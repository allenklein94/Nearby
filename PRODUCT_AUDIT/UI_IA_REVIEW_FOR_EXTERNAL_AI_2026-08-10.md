# Nearby — UI / IA Documentation for External-AI Review (2026-08-10)

**Purpose.** Factual, read-only documentation of the current UI/navigation of 7 core screens
(Home, Discover/Meet People, Profile, Settings, Inbox, Create, Gathering Detail + Gatherings
Attending/Hosting) plus Business Mode's intersection points, built for handoff to a different AI
to critique the information architecture. **No application code was changed to produce this
document. This is not a product audit and contains no recommendations, fixes, or opinions —
factual documentation only**, per explicit instruction.

Each screen is documented A-J: screen name, file path, full top-to-bottom UI hierarchy (nested
tree, not a flat list), every section, every card/button/CTA, what each major CTA does on tap,
what data is shown and its real source, a classification tag per item (personal information /
discovery / creation / messaging / activity / settings / recommendations /
commitments-upcoming-plans), and full bidirectional navigation (where this screen goes, and
where the user reaches it from).

Built from two parallel read-only research passes over the current source (not from this
repo's own `CLAUDE.md` history, which can be stale by the time a later pass touched a screen
again): Part 1 covers Home, Discover, Create, and a dedicated weather-logic trace. Part 2 covers
Profile, Settings, Inbox (both its Messages and Activity tabs), Gathering Detail, and Gatherings'
Attending/Hosting tabs, plus a dedicated Business Mode intersections section.

---

# Nearby — Home / Discover / Create Information-Architecture Documentation

Sources read in full: `src/screens/HomeScreen.js`, `src/screens/DiscoverHubScreen.js`, `src/screens/CreateHubScreen.js`, `src/components/StartSomethingModal.js`, `src/utils/timeContext.js`, `src/services/homeDashboard.js`, `src/components/QuickPicksEditModal.js`, plus supporting reads of `src/navigation/RootNavigator.js` (route-name confirmation), `src/services/gatherings.js` (`getGatheringFitReasons`, `getNearbyGatherings`, etc.), `src/services/createAssistant.js`, `src/components/GatheringFeedbackModal.js` (navigation calls only), and the SQL bodies of `submit_weather_request` / `get_weather_result` in `supabase/full_schema_pull_2026-08-09.sql` (identical copy also present in `supabase/migrations/00000000000000_baseline.sql`).

Confirmed tab route names from `RootNavigator.js:246-250`: `Tab.Screen name="Home"` → `HomeScreen`, `name="Discover"` → `DiscoverHubScreen`, `name="Create"` → `CreateHubScreen`, `name="Matches"` → `InboxScreen` (tab label "Inbox"), `name="Profile"` → `ProfileScreen` (tab label "You").

---

## 1. HOME

### A. Screen name
Home (bottom-tab route name `"Home"`, component `HomeScreen`)

### B. File path
`/workspaces/Nearby/src/screens/HomeScreen.js`

### C. Complete top-to-bottom UI hierarchy

```
SafeAreaView (container)
├── [IF loading === true] ── replaces entire body
│   ├── ActivityIndicator
│   └── Text "Finding what's happening near you..."
│
├── [ELSE, loading === false]
│   ├── ScrollView (pull-to-refresh via RefreshControl)
│   │   ├── Text — greeting: "{getGreeting()}{, {firstName}} 👋"
│   │   ├── Text — subtitle: "Here's what's happening around you."
│   │   │
│   │   ├── [IF dashboard.upcomingPlans[0] exists]
│   │   │   ├── Text — sectionHeader "Your Next Thing"
│   │   │   └── TouchableOpacity — heroCard (→ GatheringDetail)
│   │   │       ├── Text — heroIcon (category icon)
│   │   │       ├── Text — heroRole ("You're hosting" | "You're going")
│   │   │       ├── Text — heroTitle
│   │   │       ├── Text — heroDateTime (formatHeroDateTime)
│   │   │       ├── [IF heroAttendeeCount > 0] Text — heroAttendees "{N} people going"
│   │   │       └── Text — heroAction "View Gathering →"
│   │   │
│   │   ├── [IF dashboard.gatheringsTodayCount > 0]
│   │   │   └── Text — opportunityLine "You have {N} great opportunity/opportunities {today|tonight|this weekend}."
│   │   │
│   │   ├── [IF getHomeInsight(dashboard, socialForecast) returns non-null]
│   │   │   └── Text — insightLine (single computed sentence, see §G/Weather)
│   │   │
│   │   ├── [IF pendingInvitesCount>0 OR perksCount>0 OR sinceAway has newPeople/newGatherings]
│   │   │   └── View (wrapper)
│   │   │       ├── [IF pendingInvitesCount > 0] TouchableOpacity — pendingInvitesBanner (→ Matches)
│   │   │       │   ├── Text "🤝 {N} pending invite(s) & request(s)"
│   │   │       │   └── Text "›"
│   │   │       ├── [IF perksCount > 0] TouchableOpacity — perksBanner (→ BrandOffers)
│   │   │       │   ├── Text "🎁 {N} perk(s) unlocked nearby"
│   │   │       │   └── Text "›"
│   │   │       └── [IF sinceAway.newPeopleCount>0 OR sinceAway.newGatheringsCount>0]
│   │   │           └── View — sinceAwayBanner (NOT tappable)
│   │   │               ├── Text "Since you were away"
│   │   │               ├── [IF newPeopleCount>0] Text "👥 {N} new person/people nearby"
│   │   │               └── [IF newGatheringsCount>0] Text "🎉 {N} new gathering(s)"
│   │   │
│   │   ├── View — quickPicksHeaderRow
│   │   │   ├── Text — sectionHeader ("Quick Picks" if custom else PERIOD_SECTION_LABELS[period])
│   │   │   └── TouchableOpacity — "Edit" (opens QuickPicksEditModal)
│   │   ├── ScrollView (horizontal) — quickPicks.map(...)
│   │   │   └── TouchableOpacity — quickActionChip × N (icon + label)
│   │   │
│   │   ├── [IF dashboard.happeningNow.length > 0]
│   │   │   ├── Text — sectionHeader "🔥 Happening Now"
│   │   │   └── ScrollView (horizontal)
│   │   │       └── TouchableOpacity — happeningNowChip × N (→ Gatherings, no params)
│   │   │
│   │   ├── [IF socialForecast !== null]
│   │   │   └── View — forecastCard (NOT tappable)
│   │   │       ├── Text — forecastLabel "☀️ Social Forecast"
│   │   │       ├── Text — forecastValue (socialForecast.forecast_label)
│   │   │       └── Text — forecastDetail (socialForecast.forecast_detail)
│   │   │
│   │   ├── [IF continueCommunities.length > 0]
│   │   │   ├── Text — "🏘️ Continue Your Communities"
│   │   │   └── TouchableOpacity — continueCommunityCard × up to 3 (→ CommunityDetail)
│   │   │       ├── Text — community name
│   │   │       └── [IF recentMessageCount>0] Text "{N} new message(s) in the last day"
│   │   │
│   │   ├── View — card (always rendered; stat rows)
│   │   │   ├── TouchableOpacity — cardRow "👥 {N} people nearby ›" (→ Nearby)
│   │   │   ├── divider
│   │   │   ├── TouchableOpacity — cardRow "🎉 {N} gatherings today ›" (→ Gatherings)
│   │   │   ├── [IF dashboard.mostRecentSighting exists]
│   │   │   │   ├── divider
│   │   │   │   └── TouchableOpacity — cardRow "📍 Crossed paths with {name} ›" (→ ViewProfile)
│   │   │   ├── divider
│   │   │   ├── TouchableOpacity — cardRow "💬 {N} unread message(s) ›" (→ Matches)
│   │   │   ├── divider
│   │   │   └── TouchableOpacity — cardRow "🤝 {N} friend(s) ›" (→ Friends)
│   │   │
│   │   ├── [IF bestPick OR becauseYouLike.length>0 OR trendingGatherings.length>0 OR friendsActivity.length>0]
│   │   │   ├── Text — sectionHeader "✨ Recommended For You"
│   │   │   ├── [IF dashboard.bestPick]
│   │   │   │   ├── Text — subLabel "⭐ Best Pick Tonight"
│   │   │   │   └── TouchableOpacity — bestPickCard (→ GatheringDetail)
│   │   │   │       ├── Text — bestPickTitle
│   │   │   │       ├── View — bestPickReasons: Text "✓ {reason}" × N
│   │   │   │       └── Text — "View →"
│   │   │   ├── [IF becauseYouLike.length>0]
│   │   │   │   ├── Text — subLabel "💡 Because You're Into {formatted category list}"
│   │   │   │   └── TouchableOpacity — trendingCard × up to 6 (→ GatheringDetail{gatheringId})
│   │   │   │       ├── Text "{icon} {title}"
│   │   │   │       └── Text "{interest_tag} · {formatHeroDateTime}"
│   │   │   ├── [IF trendingGatherings.length>0]
│   │   │   │   ├── Text — subLabel "🔥 Trending Near You"
│   │   │   │   └── TouchableOpacity — trendingCard × up to 3 (→ Gatherings, NO gatheringId param)
│   │   │   │       ├── Text — title
│   │   │   │       └── Text "{N} attending · {distanceLabel}"
│   │   │   └── [IF friendsActivity.length>0]
│   │   │       ├── Text — subLabel "👥 Friends' Activity"
│   │   │       └── TouchableOpacity — trendingCard × up to 3 (→ Gatherings, NO gatheringId param)
│   │   │           ├── Text "{friend name} is hosting"
│   │   │           └── Text — gathering title
│   │   │
│   │   ├── [IF dashboard.upcomingPlans.length > 1]
│   │   │   ├── Text — sectionHeader "📅 Also Coming Up"
│   │   │   └── TouchableOpacity — trendingCard × (upcomingPlans minus first) (→ Gatherings, NO planId param)
│   │   │       ├── Text — plan title
│   │   │       └── Text "Hosting|Attending · {date}"
│   │   │
│   │   ├── [IF weeklyRecap.gatheringsAttended>0 OR weeklyRecap.newFriends>0]
│   │   │   └── View — recapCard (NOT tappable)
│   │   │       ├── Text "This Week"
│   │   │       ├── [IF gatheringsAttended>0] Text "✓ Attended {N} gathering(s)"
│   │   │       └── [IF newFriends>0] Text "✓ Made {N} new friend(s)"
│   │   │
│   │   ├── [IF !bestPick AND no trendingGatherings AND nearbyPeopleCount===0]
│   │   │   └── View — quietCard (NOT tappable)
│   │   │       ├── Text "Quiet night nearby"
│   │   │       └── Text "Nothing notable happening right now — but that can change fast. Browse anyway, or check back later."
│   │   │
│   │   └── TouchableOpacity — browseButton "Continue Browsing →" (→ Discover)
│   │
│   ├── TouchableOpacity — fab "+ Start Something" (absolute-positioned, outside ScrollView; opens StartSomethingModal)
│   ├── <StartSomethingModal> (visible = startModalVisible)
│   ├── <GatheringFeedbackModal> (visible = !!unratedGathering)
│   └── <QuickPicksEditModal> (visible = quickPicksEditVisible)
```

### D. Every section, in on-screen order
1. Greeting + subtitle
2. "Your Next Thing" hero card (conditional)
3. Opportunity line (conditional, plain text)
4. Home insight line (conditional, plain text)
5. Alert-banner cluster: Pending Invites banner / Perks banner / Since You Were Away banner (each independently conditional)
6. Quick Picks / period-labeled quick-action chip row (with Edit link) — always rendered
7. "🔥 Happening Now" horizontal chip row (conditional)
8. "☀️ Social Forecast" card (conditional)
9. "🏘️ Continue Your Communities" card list (conditional)
10. Stats card (people nearby / gatherings today / crossed paths / unread messages / friends) — always rendered
11. "✨ Recommended For You" super-section (conditional container): Best Pick Tonight / Because You're Into X / Trending Near You / Friends' Activity
12. "📅 Also Coming Up" list (conditional)
13. "This Week" weekly recap card (conditional)
14. "Quiet night nearby" empty-state card (conditional)
15. "Continue Browsing →" button
16. Floating "+ Start Something" FAB (persistent, overlays scroll content)

### E. Every card / button / CTA (exhaustive)
- Hero card (whole card is one CTA) — icon (dynamic category emoji), "You're hosting"/"You're going", title, date/time, optional "{N} people going", "View Gathering →"
- "🤝 {N} pending invite(s) & request(s)" banner + "›"
- "🎁 {N} perk(s) unlocked nearby" banner + "›"
- "Edit" text link (quick-picks header)
- Quick-action chips (dynamic set of up to 3, icon + label each; content varies — see §G)
- Happening-Now chips (dynamic, up to 6, category icon + gathering title, `numberOfLines={1}`)
- "👥 {N} people nearby ›"
- "🎉 {N} gatherings today ›"
- "📍 Crossed paths with {name} ›" (conditional row)
- "💬 {N} unread message(s) ›"
- "🤝 {N} friend(s) ›"
- Best Pick Tonight card — title, "✓ {reason}" list, "View →"
- "Because You're Into…" cards (up to 6) — "{icon} {title}" + "{interest_tag} · {datetime}"
- Trending Near You cards (up to 3) — title + "{N} attending · {distanceLabel}"
- Friends' Activity cards (up to 3) — "{name} is hosting" + gathering title
- Also Coming Up cards — title + "Hosting/Attending · {date}"
- "Continue Browsing →" button
- "+ Start Something" FAB
- Inside `<StartSomethingModal>` (opened by FAB or by tapping a quick-action chip that has sub-options): grid of icon+label option tiles (time-of-day `getQuickPrompts()` list + "➕ Something Else"), a sub-grid for any category with `SUB_OPTIONS` (only "Dinner" currently: Pizza/Mexican/Sushi/Burgers/Healthy/Italian/"➕ Doesn't matter"), "← Back", "Cancel"
- Inside `<QuickPicksEditModal>`: 25 toggleable interest-tag chips, "Save", "Use My Activity Instead", "Cancel"
- Inside `<GatheringFeedbackModal>` (component not fully read, but its navigation calls confirm at least): options that route to `CreateGathering` or `Gatherings`

### F. What happens when each major CTA is tapped
| CTA | Action |
|---|---|
| Hero card | `navigation.navigate('GatheringDetail', { gatheringId: dashboard.upcomingPlans[0].id })` |
| Pending invites banner | `navigation.navigate('Matches', { initialSection: 'invitations' })` |
| Perks banner | `navigation.navigate('BrandOffers')` |
| "Edit" (quick picks) | `setQuickPicksEditVisible(true)` — opens `QuickPicksEditModal`, no navigation |
| Quick-action chip, label with `SUB_OPTIONS` entry (currently only "Dinner") | `setQuickCategory(item); setStartModalVisible(true)` — opens `StartSomethingModal` pre-drilled into that sub-category |
| Quick-action chip, any other label | `navigation.navigate('Gatherings', { initialCategoryFilter: item.category, initialDateFilter: PERIOD_DATE_FILTER[period] })` |
| Happening-Now chip | `navigation.navigate('Gatherings')` (no filter params passed) |
| Continue Your Communities card | `navigation.navigate('CommunityDetail', { communityId: community.id })` |
| "👥 N people nearby" | `navigation.navigate('Nearby')` |
| "🎉 N gatherings today" | `navigation.navigate('Gatherings')` |
| "📍 Crossed paths with X" | `navigation.navigate('ViewProfile', { userId: dashboard.mostRecentSighting.otherUserId })` |
| "💬 N unread messages" | `navigation.navigate('Matches')` |
| "🤝 N friends" | `navigation.navigate('Friends')` |
| Best Pick card | `navigation.navigate('GatheringDetail', { gatheringId: dashboard.bestPick.id })` |
| "Because You're Into…" card | `navigation.navigate('GatheringDetail', { gatheringId: g.id })` |
| Trending Near You card | `navigation.navigate('Gatherings')` (no gatheringId — generic list, not the specific gathering) |
| Friends' Activity card | `navigation.navigate('Gatherings')` (same — no id) |
| Also Coming Up card | `navigation.navigate('Gatherings')` (same — no plan id) |
| "Continue Browsing →" | `navigation.navigate('Discover')` |
| "+ Start Something" FAB | `setStartModalVisible(true)` — opens `StartSomethingModal` with `initialCategory=null` |
| StartSomethingModal: tile with `category:null` ("Something Else") | `navigation.navigate('CreateGathering')` — **no params at all**, no prefill |
| StartSomethingModal: tile with a plain category | `navigation.navigate('CreateGathering', { quickStartTitle, quickStartCategory })` |
| StartSomethingModal: sub-option (e.g. Dinner→Pizza) | `navigation.navigate('CreateGathering', { quickStartTitle, quickStartCategory: activeCategory.category })` |
| QuickPicksEditModal "Save" | `onSave(selected)` → Home's `saveQuickPicks` writes `profiles.home_quick_pick_categories` in Supabase, closes modal, no navigation |
| QuickPicksEditModal "Use My Activity Instead" | `onResetToAuto()` → Home's `resetQuickPicksToAuto` sets `home_quick_pick_categories` to `null` in Supabase, closes modal |
| QuickPicksEditModal "Cancel" | closes modal, no state change |

### G. What data is shown (real source of every number/list)
- **Greeting name**: `supabase.from('profiles').select('display_name').eq('id', myId).single()` — first token of `display_name` (HomeScreen.js:66-67)
- **`dashboard` object**: entirely from `getHomeDashboard()` in `homeDashboard.js:309-493`, which on every call also does a side effect: reads `profiles.last_home_visit`, then immediately overwrites it with `now()` (line 314-316), before computing `sinceAway`.
  - `upcomingPlans`: union of `gathering_interest` rows (`status='approved'`, joined `gatherings` where `scheduled_at >= now`) and `gatherings` the user hosts with `scheduled_at >= now`, sorted soonest-first, sliced to 3 (lines 386-405). Real DB data.
  - `heroAttendeeCount`: separate call `getApprovedAttendeeCount(upcomingPlans[0].id)` from `gatherings.js` (HomeScreen.js:74).
  - `gatheringsTodayCount`: `getNearbyGatherings('wide')` filtered client-side to same calendar day (homeDashboard.js:325).
  - `happeningNow`: same nearby-gatherings set, filtered to `scheduled_at` within −30min/+2h of now, capped to 6 (lines 330-343).
  - `bestPick`: single highest-scoring gathering from `getGatheringFitReasons()` (a pure client-side scorer in `gatherings.js:919-953`) over the nearby-gatherings set, only kept if `score >= 5`; otherwise `null` (homeDashboard.js:350-358).
  - `becauseYouLike` / `becauseYouLikeCategories`: `getMyTopGatheringCategories()` (user's real historical attendance categories) intersected with nearby gatherings, excluding anything already in `upcomingPlans`, sliced to 6 (lines 407-418).
  - `trendingGatherings`: nearby gatherings sorted by `approvedAttendees.length` descending, top 3 (lines 326-328).
  - `friendsActivity`: gatherings created in the last 3 days by accepted friends (`friendships` table), up to 3 (lines 420-442).
  - `weeklyRecap`: real counts — `gathering_interest` (approved, scheduled in the last 7 days and already past) and new accepted `friendships` in the last 7 days (lines 444-464).
  - `sinceAway`: `nearbyPeople`/`nearbyGatherings` filtered against the just-overwritten `last_home_visit` timestamp; `null` on a user's very first visit (no baseline to diff against) (lines 466-475).
  - `nearbyPeopleCount`, `friendsCount`, `mostRecentSighting`, `unreadCount`: all direct Supabase counts/queries (`getNearbyMatches`, `friendships`, `matches`+`messages` unread-count) (lines 318-378).
- **`socialForecast`**: `getSocialForecast(lat, lng)` (homeDashboard.js:123-142) — only fetched if foreground location permission is already `'granted'` (HomeScreen.js:95-102); calls Postgres RPCs `submit_weather_request`/`get_weather_result` which proxy the real OpenWeatherMap Current Weather API. Full mechanics in the dedicated **Weather** section below.
- **`getHomeInsight(dashboard, socialForecast)`** (homeDashboard.js:499-515): a pure function picking ONE line from a fixed priority order — friendsActivity≥2 → bestPick exists → forecast label regex match → happeningNow>0 → else `null`. Not stored; recomputed on every render.
- **`continueCommunities`**: `getContinueYourCommunities()` — user's joined communities (`community_members`), each annotated with `community_messages` count in the last 24h, sorted by that count, top 3 (homeDashboard.js:151-178).
- **`perksCount`**: `getUnlockedPerksCount()` — count of `brand_offers` rows where `active=true`, `gathering_id IS NULL`, and not expired (homeDashboard.js:294-307).
- **`pendingInvitesCount`**: `getPendingInvitesCount(myId)` — sum of pending `gathering_interest` (as host), pending `friendships`, pending `social_invites` (homeDashboard.js:110-121).
- **`unratedGathering`**: `getMostRecentUnratedGathering()` from `gatherings.js` (drives whether `GatheringFeedbackModal` shows).
- **`pinnedQuickPicks`**: `profiles.home_quick_pick_categories` (array column, user-editable via `QuickPicksEditModal`).
- **Quick-action chip content**: if `pinnedQuickPicks` is a non-empty array → `getPinnedQuickPicks()` (timeContext.js:103-110), else → `getPersonalizedQuickPicks(period, dashboard.becauseYouLikeCategories, categoryStyleFor)` (timeContext.js:67-95), which blends the user's real top categories with static `QUICK_PROMPTS_BY_PERIOD` defaults (timeContext.js:17-38) to fill up to 3 slots.

### H. Classification (per item)
- Greeting/subtitle — **personal information**
- Hero card ("Your Next Thing") — **commitments-upcoming-plans**
- Opportunity line, Home insight line — **recommendations**
- Pending invites banner — **messaging** / **commitments-upcoming-plans** (invites/requests awaiting response)
- Perks banner — **recommendations** / **discovery**
- Since You Were Away banner — **activity**
- Quick-action chip row — **discovery** primarily, with a **creation** carve-out for any label matching `SUB_OPTIONS` (see dedicated call-out below) — also **personal information** in that its content is personalized/user-pinned
- "Edit" link on quick picks — **settings** / **personal information** (editing personalization data)
- Happening Now chips — **discovery** / **activity**
- Social Forecast card — **recommendations**
- Continue Your Communities — **activity** / **messaging**
- "N people nearby" stat row — **discovery**
- "N gatherings today" stat row — **discovery**
- "Crossed paths with X" stat row — **personal information** (surfaces another user's identity/photo via proximity history) / **activity**
- "N unread messages" stat row — **messaging**
- "N friends" stat row — **personal information** / **messaging**
- Recommended For You (Best Pick / Because You Like / Trending / Friends' Activity) — **recommendations**
- Also Coming Up — **commitments-upcoming-plans**
- Weekly Recap — **activity** / **personal information**
- Quiet Night card — **recommendations** (informational null-state)
- "Continue Browsing →" — **discovery**
- "+ Start Something" FAB — **creation**
- StartSomethingModal — **creation**
- QuickPicksEditModal — **settings** / **personal information**
- GatheringFeedbackModal — **activity** (feedback collection), with **creation** exit paths

### I. Where the user can navigate from Home (deduplicated)
`GatheringDetail`, `Matches`, `BrandOffers`, `CommunityDetail`, `Nearby`, `Gatherings`, `ViewProfile`, `Friends`, `Discover`, `CreateGathering` (reached only through the `StartSomethingModal`/`GatheringFeedbackModal` children, using the `navigation` prop Home passes down — Home's own file body has no literal `navigate('CreateGathering', …)` call).

### J. Where the user can navigate to Home from
- Bottom tab bar — Home is a `Tab.Screen`, always reachable, one tap from anywhere inside `MainTabs`.
- `OnboardingRecommendationsScreen.js:80` — `navigation.navigate('MainTabs')` (lands on the default/first tab, which is Home per the `Tab.Screen` registration order).
- No other file in `src/` calls `navigate('Home', …)` explicitly (verified via repo-wide grep).

---

## 2. DISCOVER (Meet People is a card *within* Discover, not a separate top-level screen)

### A. Screen name
Discover (bottom-tab route name `"Discover"`, component `DiscoverHubScreen`)

### B. File path
`/workspaces/Nearby/src/screens/DiscoverHubScreen.js`

### C. Complete top-to-bottom UI hierarchy

```
SafeAreaView (container)
├── View (header, always visible, pinned above scroll/map)
│   ├── Text — "Discover"
│   ├── Text — "What are you looking for?"
│   ├── View — searchBarWrap
│   │   ├── Text — 🔍 icon
│   │   ├── TextInput — placeholder "Search gatherings, communities, places, perks"
│   │   └── [IF searchQuery.length > 0] TouchableOpacity "✕" (clears query)
│   ├── TouchableOpacity — conciergeRow (→ AIConcierge)
│   │   ├── Text "✨ Ask AI Concierge what to do"
│   │   └── Text "›"
│   ├── View — filterRow
│   │   ├── ScrollView (horizontal) — TYPE_FILTERS.map: filterChip × 5 ("All"/"Gatherings"/"Communities"/"Places"/"Perks")
│   │   └── [IF showViewToggle] TouchableOpacity — viewToggleButton ("🗺️" ⇄ "📋")
│   └── [IF typeFilter === 'places'] ScrollView (horizontal) — PLACE_CATEGORIES.map: filterChip × 4 ("☕ Coffee"/"🍽️ Restaurants"/"🌳 Parks"/"🏛️ Hubs")
│
├── [IF viewStyle === 'map' AND showViewToggle]
│   └── View (flex:1) — <GatheringsMapView> (full-bleed map; markers for gatherings/deals/businesses)
│
├── [ELSE — list mode]
│   └── ScrollView
│       ├── [IF isAll] TouchableOpacity — "Meet People" card (→ Nearby)
│       │   ├── Text "👥"
│       │   ├── Text "Meet People" / "Find people nearby"
│       │   └── Text "›"
│       ├── [IF isAll] View (row of 2)
│       │   ├── TouchableOpacity — quickTimeCard "🌙 Tonight" (→ Gatherings{initialDateFilter:'today'})
│       │   └── TouchableOpacity — quickTimeCard "📅 This Weekend" (→ Gatherings{initialDateFilter:'weekend'})
│       ├── [IF loadingCore] ActivityIndicator
│       ├── [IF recommended.length>0]
│       │   ├── Text — sectionHeader "Recommended For You"
│       │   └── TouchableOpacity — card × N (→ GatheringDetail)
│       ├── [IF trending.length>0]
│       │   ├── Text — sectionHeader "🔥 Trending Near You"
│       │   └── TouchableOpacity — card × N (→ GatheringDetail)
│       ├── Gatherings section (three mutually exclusive render states gated by showGatherings/isSearching/loadingSearch)
│       │   ├── [searching+loading] sectionHeader "Gatherings" + ActivityIndicator
│       │   ├── [searching+empty] sectionHeader "Gatherings" + Text 'No gatherings match "…"'
│       │   └── [has results] sectionHeader "Gatherings" + card × N (→ GatheringDetail) + [IF isAll] "See all in Gatherings →" (→ Gatherings)
│       ├── Communities section (same 3-state pattern)
│       │   └── card × N (🏘️ icon, → CommunityDetail{communityId, communityName}) + [IF isAll] "See all in Communities →" (→ Communities)
│       ├── Places section (states: no location / loading / empty / list)
│       │   ├── Text "Enable location to discover places nearby." (no userLocation)
│       │   ├── ActivityIndicator (loadingPlaces)
│       │   ├── Text "Nothing found nearby…" (empty)
│       │   └── card × N (📍 icon or photo, → Linking.openURL(Google Maps URL)) + [IF isAll && places.length>0] "See all in Places →" (→ Places)
│       ├── Perks section (same 3-state pattern)
│       │   └── card × N (🎁 icon, → BrandOffers) + [IF isAll] "See all in Perks →" (→ BrandOffers)
│       ├── [IF isAll && gatheringStories.length>0]
│       │   ├── Text — "Gathering Memories"
│       │   └── TouchableOpacity — card × N (🎉 icon, → opens gatheringStoryViewer local Modal, no navigation)
│       └── [IF isAll && publicStories.length>0]
│           ├── Text — "Public Stories Near You"
│           └── ScrollView (horizontal) — storyRing × N (→ opens StoryViewerModal via local state)
│
├── <StoryViewerModal> (visible = !!viewerTarget)
└── Modal (native) — gatheringStoryViewer (visible = !!gatheringStoryViewer)
    ├── Text — gathering title
    ├── TouchableOpacity — "Close"
    └── FlatList of GatheringStoryItem (Image or Video per story)
```

### D. Every section, in on-screen order
1. Header block: title, subtitle, search bar, AI Concierge row, type-filter chip row (+ view toggle), place-category chip row (conditional)
2. Map view (conditional full-screen replacement of everything below) OR:
3. "Meet People" entry card (All filter only)
4. "Tonight" / "This Weekend" quick-time card pair (All filter only)
5. Loading spinner (initial core load)
6. "Recommended For You" (score-based, All/Gatherings filter, not searching)
7. "🔥 Trending Near You" (All/Gatherings filter, not searching)
8. "Gatherings" list/search-results section
9. "Communities" list/search-results section
10. "Places" section
11. "Perks" list/search-results section
12. "Gathering Memories" (past-gathering story archive)
13. "Public Stories Near You" (horizontal story rings)

### E. Every card / button / CTA
- Search TextInput + "✕" clear button
- "✨ Ask AI Concierge what to do" row + "›"
- Type filter chips: All, Gatherings, Communities, Places, Perks
- View-toggle button (🗺️ map / 📋 list)
- Place-category chips: ☕ Coffee, 🍽️ Restaurants, 🌳 Parks, 🏛️ Hubs
- "👥 Meet People" card
- "🌙 Tonight" card
- "📅 This Weekend" card
- Recommended For You cards (dynamic, cover photo or category icon, title, fit-reason subtitle)
- Trending Near You cards (dynamic, title, "N attending · distance")
- Gatherings list cards (dynamic, title, distance)
- "See all in Gatherings →"
- Communities cards (🏘️ icon, name, optional description)
- "See all in Communities →"
- Places cards (photo or 📍 icon, name, rating/gathering-count or address)
- "See all in Places →"
- Perks cards (🎁 icon, title, brand name, optional "Matches your interests")
- "See all in Perks →"
- Gathering Memories cards (🎉 icon, gathering title, story count)
- Public Stories story rings (avatar + display name)
- Map markers: gathering pins (→ GatheringDetail), deal pins (→ BrandOffers), business pins (→ BusinessProfile)
- Story viewer "Close" button

### F. What happens when each major CTA is tapped
| CTA | Action |
|---|---|
| "✕" clear search | `setSearchQuery('')` |
| AI Concierge row | `navigation.navigate('AIConcierge')` |
| Type filter chip | `setTypeFilter(f.key)` — local state, no navigation |
| View-toggle button | `setViewStyle(viewStyle==='list'?'map':'list')` — local state |
| Place-category chip | `setPlacesCategory(c.key)` — local state |
| Map — gathering marker | `navigation.navigate('GatheringDetail', { gatheringId: g.id })` |
| Map — deal marker | `navigation.navigate('BrandOffers')` |
| Map — business marker | `navigation.navigate('BusinessProfile', { partnerId: b.id })` |
| "Meet People" card | `navigation.navigate('Nearby')` |
| "Tonight" card | `navigation.navigate('Gatherings', { initialDateFilter: 'today' })` |
| "This Weekend" card | `navigation.navigate('Gatherings', { initialDateFilter: 'weekend' })` |
| Recommended / Trending / Gatherings-list card | `navigation.navigate('GatheringDetail', { gatheringId: g.id })` |
| "See all in Gatherings →" | `navigation.navigate('Gatherings')` |
| Community card | `navigation.navigate('CommunityDetail', { communityId: c.id, communityName: c.name })` |
| "See all in Communities →" | `navigation.navigate('Communities')` |
| Place card | `Linking.openURL('https://www.google.com/maps/search/?api=1&query=...&query_place_id=...')` — **external action**, not in-app navigation |
| "See all in Places →" | `navigation.navigate('Places')` |
| Perk card | `navigation.navigate('BrandOffers')` |
| "See all in Perks →" | `navigation.navigate('BrandOffers')` |
| Gathering Memories card | `setGatheringStoryViewer(group)` — opens in-screen native `<Modal>`, no navigation |
| Public story ring | `setViewerTarget(group)` — opens `<StoryViewerModal>`, no navigation |
| Story-viewer "Close" | `setGatheringStoryViewer(null)` |

### G. What data is shown
- `gatherings`: `getNearbyGatherings('wide')` — real query (`services/gatherings.js`), fetched once per focus in `loadCore()`.
- `communities`: `getPublicCommunities()` minus the caller's own `getMyCommunities()` membership set (client-side filter, DiscoverHubScreen.js:118-121).
- `offers`/`businesses`: `getActiveOffers(lat,lng)` / `getNearbyBusinesses(lat,lng)`.
- `places`: `searchNearbyPlaces(lat, lng, category, keyword)` — real external **Google Places** API call, metered, fetched on-demand only (debounced 350ms) when the Places filter is active or a ≥2-char search is typed (lines 143-160, 139-142 comment).
- `searchedGatherings`/`searchedCommunities`/`searchedOffers`: server-side, indexed searches — `searchGatherings()` and `searchPublicCommunities()` use Postgres trigram GIN indexes per migration `20260809_indexed_text_search.sql` (per in-file comment, lines 162-166); `searchOffers()` uses a `search_offer_ids()` RPC across `brand_offers`/`brand_partners` (lines 235-239). All debounced 350ms, 2-character minimum (line 227).
- `recommended`: computed client-side from the already-fetched `gatherings` array via `getGatheringFitReasons(g)` (the exact same pure scorer as Home's `bestPick`, per file's own header comment lines 46-49), filtered to `score>=5`, sorted, sliced to 3 (lines 242-248).
- `trending`: computed client-side from the same `gatherings` array, sorted by `approvedAttendees.length` descending, sliced to 3 — the file's own comment (lines 250-253) states this uses "the same signal/threshold Home's own '🔥 Trending Near You' section already uses."
- `publicStories`/`gatheringStories`: `getPublicStoriesGrouped()` / `getGatheringStoriesGrouped()` from `services/stories.js`.
- Cover/story photo URLs: signed URLs from Supabase Storage (`getSignedGatheringPhotoUrl`, `getSignedPhotoUrl`, `getSignedStoryUrl`).

### H. Classification
- Search bar, filter chips, view toggle — **discovery**
- AI Concierge row — **discovery** / **recommendations**
- "Meet People" card — **discovery** (dating/proximity people-finding entry point)
- "Tonight"/"This Weekend" cards — **discovery**
- Recommended For You — **recommendations**
- Trending Near You — **recommendations** / **discovery**
- Gatherings/Communities/Places/Perks lists — **discovery**
- Gathering Memories, Public Stories — **activity** / **discovery** (social proof/content, not settings or creation)
- Map markers — **discovery**

Note: nothing on this entire screen is tagged **creation** or **commitments-upcoming-plans** or **personal information** — it is a pure browse/discovery surface with one **messaging**-adjacent exception (none observed) and no settings.

### I. Where the user can navigate from Discover (deduplicated)
`AIConcierge`, `Nearby`, `Gatherings`, `GatheringDetail`, `Communities`, `CommunityDetail`, `Places`, `BrandOffers`, `BusinessProfile`. Plus one external (non-navigation) action: `Linking.openURL` to Google Maps for a place. **Discover never calls `navigate('CreateGathering' | 'CreateCommunity' | ...)` anywhere in this file** — confirmed by full read; it is a discovery-only surface with zero creation exit points.

### J. Where the user can navigate to Discover from
- Bottom tab bar — always reachable.
- `HomeScreen.js:490` — "Continue Browsing →" button: `navigation.navigate('Discover')` (the only explicit programmatic navigation to Discover found anywhere in `src/`).

---

## 3. CREATE

### A. Screen name
Create (bottom-tab route name `"Create"`, component `CreateHubScreen`; the file's own header comment calls this "Create 2.0")

### B. File path
`/workspaces/Nearby/src/screens/CreateHubScreen.js`

### C. Complete top-to-bottom UI hierarchy

```
KeyboardAvoidingView
└── SafeAreaView (container)
    └── ScrollView (keyboardShouldPersistTaps="handled")
        ├── Text — "Create"
        ├── Text — "What do you want to do?"
        ├── [IF activeSubCategory OR showSomethingElse] TouchableOpacity — "← Back" (resetGrid())
        │
        ├── [IF showSomethingElse === true]
        │   └── View — somethingElseBox
        │       ├── Text "💡 What do you have in mind?"
        │       ├── Text "We'll help you turn it into a plan."
        │       └── View — assistantRow
        │           ├── TextInput — placeholder 'e.g. "get some people together for coffee this weekend"'
        │           └── TouchableOpacity — assistantButton ("→" or ActivityIndicator if thinking)
        │
        ├── [ELSE — grid mode]
        │   ├── [IF activeSubCategory] Text — gridHeader "What kind of {label.toLowerCase()}?"
        │   └── View — grid
        │       └── TouchableOpacity — gridItem × N (icon + label; options = CREATE_HUB_OPTIONS or SUB_OPTIONS[activeSubCategory.label])
        │
        └── [IF !activeSubCategory AND !showSomethingElse]
            └── View — secondaryRow
                ├── Text — "Want to build something bigger?"
                ├── TouchableOpacity — "👥 Create a Community" (→ CreateCommunity)
                └── [IF managesBusiness] TouchableOpacity — "🏪 Manage Your Business" (→ BusinessDashboard)
                    [ELSE] TouchableOpacity — "🤝 Partner with a Business" (→ RequestBusinessPartner)
```

### D. Every section, in on-screen order
1. Title + subtitle
2. Back link (conditional, only inside a sub-category or Something Else state)
3. Either: (a) the "Something Else" natural-language box, or (b) the icon grid (top-level `CREATE_HUB_OPTIONS` or a drilled-in sub-grid, e.g. Dinner's cuisine options)
4. "Want to build something bigger?" secondary row (Community + Business links) — only shown at the top-level grid state (hidden once inside a sub-category or Something Else)

### E. Every card / button / CTA
- "← Back" link
- Icon grid, top level (`CREATE_HUB_OPTIONS`, exactly 8 tiles): ☕ Coffee, 🍽️ Dinner, 🚶 Walk, 🏐 Sports, 🎮 Games, 🎵 Music, 🤝 Volunteer, ➕ Something Else
- Icon grid, "Dinner" sub-level (`SUB_OPTIONS.Dinner`, exactly 7 tiles): 🍕 Pizza, 🌮 Mexican, 🍣 Sushi, 🍔 Burgers, 🥗 Healthy, 🍝 Italian, ➕ "Doesn't matter"
- Something Else box: TextInput + submit button (→ arrow, or spinner while `thinking`)
- "👥 Create a Community"
- "🏪 Manage Your Business" (conditional — only if `managesBusiness`)
- "🤝 Partner with a Business" (conditional — only if NOT `managesBusiness`)

### F. What happens when each major CTA is tapped
| CTA | Action |
|---|---|
| "← Back" | `resetGrid()` → clears `activeSubCategory`, `showSomethingElse`, `assistantText` (local state only) |
| Grid tile "➕ Something Else" | `setShowSomethingElse(true)` |
| Grid tile "🍽️ Dinner" (has `SUB_OPTIONS`) | `setActiveSubCategory(item)` — drills into the Dinner sub-grid, no navigation |
| Grid tile — any other top-level tile (Coffee/Walk/Sports/Games/Music/Volunteer) | `navigation.navigate('CreateGathering', { quickStartTitle: item.label, quickStartCategory: item.category, fromQuickPick: true })` — **skips the wizard's "What" step entirely** |
| Sub-grid tile (e.g. Pizza) | `navigation.navigate('CreateGathering', { quickStartTitle: title, quickStartCategory: activeSubCategory.category, fromQuickPick: true })` (title = tile label, or the parent category label if tile is "Doesn't matter"/"Other") |
| Something Else — submit | `classifyCreateRequest(text)` (calls the `create-assistant` Supabase Edge Function) then routes by `result.intent`: `'gathering'` → `navigate('CreateGathering', { quickStartTitle, quickStartCategory })` (no `fromQuickPick`, so the "What" step still shows, prefilled/editable); `'community'` → `navigate('CreateCommunity', { quickStartTitle, quickStartCategory })`; `'business_partner'` → `navigate('RequestBusinessPartner', { initialBusinessQuery: result.businessName ?? '' })`; anything else (`'unclear'`) → `navigate('CreateGathering', { quickStartTitle: typedText, quickStartCategory: null })`. On error: `Alert.alert('Something went wrong', e.message)` |
| "👥 Create a Community" | `navigation.navigate('CreateCommunity')` (no params) |
| "🏪 Manage Your Business" | `navigation.navigate('BusinessDashboard')` |
| "🤝 Partner with a Business" | `navigation.navigate('RequestBusinessPartner')` (no params) |

### G. What data is shown
- `managesBusiness`: `supabase.from('profiles').select('managed_partner_id').eq('id', myId).single()` — real boolean derived from whether the signed-in user has a linked business-partner row (line 40-42). Refetched on every screen focus via `useFocusEffect`.
- Grid option list: static constant `CREATE_HUB_OPTIONS` (from `StartSomethingModal.js:13-22`) — explicitly NOT time-of-day adaptive (unlike Home's quick picks), per the file's own header comment (lines 9-13): "Fixed, non-time-adaptive option set for CreateHubScreen's 'Start a Gathering' card." Sub-grid: `SUB_OPTIONS.Dinner` (same source file, lines 24-34).
- No dashboard numbers, counts, or personalized lists appear anywhere on this screen — Create is 100% static configuration + one live boolean (`managesBusiness`) + the AI classifier's freeform response.

### H. Classification
- Entire screen — **creation** (every interactive element on this screen either opens a creation flow or is a direct step toward one).
- "🏪 Manage Your Business" specifically is arguably also **settings** (business account management) rather than pure creation, since it opens a management dashboard, not a new-object wizard.
- "🤝 Partner with a Business" is **creation** (a new partner-request) blended with **discovery** in spirit (finding/proposing a business relationship), though mechanically it opens a request form.
- No element on this screen is tagged personal information, messaging, activity, or recommendations.

### I. Where the user can navigate from Create (deduplicated)
`CreateGathering` (three call sites, all with different param shapes), `CreateCommunity` (two call sites — bare, or with `quickStartTitle`/`quickStartCategory`), `RequestBusinessPartner` (two call sites — bare, or with `initialBusinessQuery`), `BusinessDashboard`. Exactly 4 distinct route names.

### J. Where the user can navigate to Create from
- Bottom tab bar — always reachable.
- Repo-wide grep of `src/` for `navigate('Create'` / `navigate("Create"` returns **zero** hits. Create is reached exclusively via the bottom tab bar in this codebase.

---

## 4. WEATHER — "Social Forecast"

**Files/objects involved:** `submit_weather_request` (Postgres function, `supabase/full_schema_pull_2026-08-09.sql:4915-4937`), `get_weather_result` (`supabase/full_schema_pull_2026-08-09.sql:2940-2981`), `getSocialForecast()` (`src/services/homeDashboard.js:123-142`), rendering in `src/screens/HomeScreen.js:298-304` (forecast card) and `src/screens/HomeScreen.js:206-208` + `src/services/homeDashboard.js:499-515` (`getHomeInsight`). Both SQL functions are duplicated verbatim in `supabase/migrations/00000000000000_baseline.sql` (same line content, confirmed via grep).

### What data is used
- Real external API: **OpenWeatherMap Current Weather Data API**, endpoint `https://api.openweathermap.org/data/2.5/weather?lat=%s&lon=%s&appid=%s&units=imperial` (`submit_weather_request`, full_schema_pull_2026-08-09.sql:4927-4932). This is OpenWeatherMap's **current-conditions** endpoint, not a forecast endpoint.
- `units=imperial` → temperature is returned/stored in **Fahrenheit**.
- Three raw fields are extracted from the JSON response in `get_weather_result` (lines 2960-2962):
  - `weather_main` — `response->'weather'->0->>'main'` (e.g. "Clear", "Rain", "Clouds")
  - `weather_temp` — `response->'main'->>'temp'` (numeric, °F)
  - `weather_condition_id` — `response->'weather'->0->>'id'` (OpenWeatherMap's numeric condition-code ID)
- No precipitation-probability field is used anywhere — only the current condition family (`main`), the current numeric condition ID, and the current temperature.

### Thresholds — verbatim from the SQL CASE statements (get_weather_result, lines 2966-2979)

`forecast_label` (first matching branch wins, in this exact order):
1. `weather_condition_id < 700` → `'Quiet'`
2. `weather_temp < 45 or weather_temp > 95` → `'Quiet'`
3. `weather_main = 'Clear' and weather_temp between 60 and 85` → `'Excellent'`
4. else → `'Good'`

`forecast_detail` (same branch order/conditions):
1. `weather_condition_id < 700` → `'Rain or storms expected — a better night for something indoors.'`
2. `weather_temp < 45` → `'Cold out — outdoor plans might be a harder sell tonight.'`
3. `weather_temp > 95` → `'Very hot — outdoor plans are better earlier or later in the day.'`
4. `weather_main = 'Clear' and weather_temp between 60 and 85` → `'Clear skies and comfortable temps — good conditions for outdoor plans.'`
5. else → `'Decent conditions out there tonight.'`

Per OpenWeatherMap's own condition-code scheme, `id < 700` covers the Thunderstorm (2xx), Drizzle (3xx), Rain (5xx) and Snow (6xx) groups collectively (Atmosphere starts at 700, Clear=800, Clouds=80x) — i.e. the branch-1 copy ("Rain or storms expected") fires identically for snow conditions too, since snow codes are also `< 700`.

### Current vs forecast, and time window
The underlying API call is **current weather at the moment of the request** — a single snapshot, not a forecast for any specific future window. There is no time-of-day or "tonight" parameter anywhere in `submit_weather_request` or `get_weather_result`; the request simply fires whenever `getSocialForecast(lat, lng)` is invoked (i.e., whenever Home loads/refreshes and foreground location permission is already granted — `HomeScreen.js:95-102`). Despite this, the label text on Home reads "☀️ Social Forecast" (implying a forward-looking forecast) and multiple `forecast_detail` strings explicitly say "tonight" (branches 1 and 5) regardless of what time of day the request actually happened.

### Exact copy strings
- `forecast_label` values: `Quiet`, `Excellent`, `Good` (exactly these three strings, nothing else is ever returned).
- `forecast_detail` values (verbatim, exactly one of):
  - `Rain or storms expected — a better night for something indoors.`
  - `Cold out — outdoor plans might be a harder sell tonight.`
  - `Very hot — outdoor plans are better earlier or later in the day.`
  - `Clear skies and comfortable temps — good conditions for outdoor plans.`
  - `Decent conditions out there tonight.`

### Is the "why" always shown next to the conclusion?
Where the forecast appears as its own card (`HomeScreen.js:298-304`), **yes** — `forecast_label` (styled as `forecastValue`) and `forecast_detail` (styled as `forecastDetail`) are both rendered inside the same `forecastCard` `View`, always together; there is no code path in `HomeScreen.js` that renders `forecast_label` without also rendering `forecast_detail` right below it.

However, there **is** a separate code path where a weather-derived *conclusion* is shown with no reasoning attached at that location: `getHomeInsight()` (`homeDashboard.js:508`) tests `socialForecast?.forecast_label` against the regex `/good|great|perfect|clear|sunny/i` and, if it matches, returns the fixed, hardcoded sentence **`'Looks like a perfect evening for something outdoors.'`** (`HomeScreen.js` renders this as `insightLine`, above and separate from the forecast card, with no `forecast_detail` text attached to it). This line carries a conclusion but not the specific real reason (e.g. it never says "because it's 72°F and clear"). Note also that of the three actual possible `forecast_label` values (`Quiet`/`Excellent`/`Good`), only `'Good'` contains any of the regex's terms (`good`) — `'Excellent'` and `'Quiet'` do not match `good|great|perfect|clear|sunny` at all — so in practice this insight sentence can only ever fire when `forecast_label === 'Good'` (the SQL function's catch-all/else branch), never for `'Excellent'` or `'Quiet'`.

### "Better night for something indoors" — exact copy and trigger
Yes, this exact phrase exists verbatim: **`'Rain or storms expected — a better night for something indoors.'`** It is the `forecast_detail` returned when `weather_condition_id < 700` (`get_weather_result`, line 2974) — this is the first branch checked in the `CASE`, so it takes priority over every other condition (temperature, clear-skies) whenever the current OpenWeatherMap condition ID falls in the Thunderstorm/Drizzle/Rain/Snow range (codes 200–699).

---

## 5. Cross-cutting call-outs

### Home's quick-action row — Discovery vs. Commitment vs. Creation vs. Personal Activity
Home's quick-action chip row (`HomeScreen.js:252-272`, `handleQuickAction` at lines 122-137) is **not uniformly one classification**:
- For the majority of labels (any category without a `SUB_OPTIONS` entry — e.g. "Coffee", "Morning Run", "Lunch", "Walk", "Concert", "Beach Volleyball", etc.), tapping is pure **DISCOVERY**: `navigation.navigate('Gatherings', { initialCategoryFilter, initialDateFilter })` — it browses *existing* content, per the file's own comment (lines 128-132: "Discover-first: browse what already exists in this category before offering to create one").
- For the one label that currently has a `SUB_OPTIONS` entry — **"Dinner"** (present in the evening period's default set, `timeContext.js:29`) — tapping instead opens `StartSomethingModal` pre-drilled into the Dinner sub-grid, and every leaf of that sub-grid is **CREATION** (`navigate('CreateGathering', …)`). So the row's behavior silently flips from discovery to creation depending solely on whether the *label string* happens to match a key in `SUB_OPTIONS`.
- The row itself is also **PERSONAL ACTIVITY / PERSONAL INFORMATION**-flavored in its *content selection*: when the user has pinned categories (`profiles.home_quick_pick_categories`), the chips reflect an explicit personal preference; otherwise they're personalized from the user's own real attendance history (`becauseYouLikeCategories`) blended with static time-of-day defaults.
- No path from this row is **COMMITMENT** — it never surfaces or links to a gathering the user is already attending/hosting; that job belongs entirely to the Hero card and "Also Coming Up" section elsewhere on Home.

### Home content that duplicates Discover (or is complementary but overlapping in surface area)
- **"🔥 Trending Near You"** exists on both screens. Home's version (`dashboard.trendingGatherings`) is computed server/client-side in `getHomeDashboard()` by sorting nearby gatherings on `approvedAttendees.length` (`homeDashboard.js:326-328`). Discover's version is computed independently, client-side, in `DiscoverHubScreen.js:254-258`, using the exact same sort key — and the file's own comment (lines 250-253) states explicitly this reuses "the same signal/threshold Home's own '🔥 Trending Near You' section already uses." Two independently-implemented but algorithmically identical sections, one per screen.
- **"Recommended For You"** exists on both screens, both driven by the same pure scorer `getGatheringFitReasons()` at the same `score >= 5` threshold (Home: single best pick, `homeDashboard.js:354-358`; Discover: top 3, `DiscoverHubScreen.js:242-248`). Discover's own header comment (lines 46-49) explicitly notes this reuse: "the same pure scorer already used by Home's bestPick and GatheringDetailScreen."
- **"N people nearby"** (Home stat row) and **"Meet People"** (Discover card) are two differently-styled entry points to the identical route, `Nearby` (`DiscoveryScreen`).
- **Perks**: Home's "🎁 N perks unlocked nearby" banner and Discover's "Perks" filter/section both surface `brand_offers` and both terminate at the same `BrandOffers` route.
- **Communities**: Home's "🏘️ Continue Your Communities" surfaces communities the user has *already joined* (with recent-activity ranking) and links to `CommunityDetail`; Discover's "Communities" section deliberately *excludes* already-joined communities (`communities.filter((c) => !joinedCommunityIds.has(c.id))`, `DiscoverHubScreen.js:121`) and links to the same `CommunityDetail` route for a different (not-yet-joined) set. These are complementary rather than literally duplicate content, but both screens carry a "Communities" surface.
- **"+ Start Something" FAB (Home) vs. the Create tab**: both terminate in the same `CreateGathering` screen with the same `quickStartTitle`/`quickStartCategory` param shape, but via two separately-built UIs (`StartSomethingModal`, a bottom-sheet modal reusing `getQuickPrompts()`'s time-adaptive list, vs. `CreateHubScreen`'s inline full-screen grid using the fixed `CREATE_HUB_OPTIONS` list) — see the detailed comparison below.

---

## 6. CREATE — icon grid, "Something Else" box, and secondary row vs. Home's quick-action chips

### Exact grid contents compared
| Home quick-action chips (time-of-day dependent, `timeContext.js:17-38`, or user-pinned) | Create's fixed grid (`CREATE_HUB_OPTIONS`, `StartSomethingModal.js:13-22`) |
|---|---|
| Morning: ☕ Coffee(Coffee), 🏃 Morning Run(Fitness), 🍳 Breakfast Meetup(Foodie) | ☕ Coffee(Coffee), 🍽️ Dinner(Foodie), 🚶 Walk(Outdoors), 🏐 Sports(Sports), 🎮 Games(Gaming), 🎵 Music(Music), 🤝 Volunteer(Volunteering), ➕ Something Else |
| Afternoon: 🥪 Lunch(Foodie), 🤝 Volunteering(Volunteering), 📚 Reading(Reading) | *(same 8, always — non-time-adaptive)* |
| Evening: 🍽️ Dinner(Foodie), 🎤 Concert(Concerts), 🚶 Walk(Outdoors) | |
| Weekend: 🏐 Beach Volleyball(Sports), 🌱 Beach Cleanup(Outdoors), 🍷 Wine Tasting(Wine) | |
| Or, if pinned: any subset (up to 5) of a 25-tag list (`QuickPicksEditModal.js:10-15`) | |

**Direct label/category overlaps observed:** Home's morning "Coffee"(Coffee) = Create's "Coffee"(Coffee); Home's evening "Dinner"(Foodie) = Create's "Dinner"(Foodie); Home's evening "Walk"(Outdoors) = Create's "Walk"(Outdoors); Home's afternoon "Volunteering"(Volunteering) ≈ Create's "Volunteer"(Volunteering). The weekend defaults (Beach Volleyball/Beach Cleanup/Wine Tasting) and the personalized/pinned picks do not literally match any Create grid label by string, though their underlying categories (Sports, Outdoors) do exist on Create's grid under different labels.

**Behavioral contradiction on identical labels:** because `SUB_OPTIONS` (imported by both `StartSomethingModal.js` and `CreateHubScreen.js` from the same module) is only keyed by `"Dinner"`, tapping **"Dinner"** produces the *same* sub-grid experience (Pizza/Mexican/Sushi/Burgers/Healthy/Italian/"Doesn't matter") whether reached from Home or from Create — genuinely identical behavior. But tapping **any other shared label** (e.g. "Coffee", "Walk", "Volunteer"/"Volunteering") produces *opposite* outcomes depending on origin screen:
- From **Home**: navigates to `Gatherings` with that category as a filter — i.e., **browse existing gatherings** (discovery).
- From **Create**: navigates directly to `CreateGathering` with that category prefilled, skipping the wizard's "What" step (`fromQuickPick: true`) — i.e., **start creating a new gathering** (creation).

So the same visible chip/tile label means "show me what already exists" on Home and "let me make a new one" on Create.

### "Something Else" — Home's modal version vs. Create's NL box are NOT the same feature
- **Home** (`StartSomethingModal.js`, tile with `category: null`): tapping "➕ Something Else" simply calls `navigation.navigate('CreateGathering')` with **zero params** — no text capture, no AI classification, no prefill of any kind (`StartSomethingModal.js:52-57`).
- **Create** (`CreateHubScreen.js`, tile labeled "Something Else"): tapping opens an inline TextInput ("💡 What do you have in mind?" / "We'll help you turn it into a plan.") that, on submit, calls `classifyCreateRequest(text)` — a real Supabase Edge Function (`create-assistant`) that returns an `intent` (`gathering` | `community` | `business_partner` | `unclear`) plus best-effort `title`/`category`/`businessName` fields, and routes accordingly to `CreateGathering`, `CreateCommunity`, or `RequestBusinessPartner` (`CreateHubScreen.js:82-109`). Per its own file comment, this assistant "is never labeled 'AI' in the UI and has no premium gate," and is explicitly distinct from the premium-gated AI Concierge used elsewhere (Discover's "Ask AI Concierge" row navigates to the separate `AIConcierge` screen, `services/aiConcierge.js`, not this one).
- Net effect: the identically-labeled "Something Else" option is a bare, unassisted `CreateGathering` shortcut on Home, and a full natural-language, multi-intent classifier on Create.

### Community / Business secondary row (Create only)
Renders only at the top-level grid state (`!activeSubCategory && !showSomethingElse`, `CreateHubScreen.js:174-205`) under the header **"Want to build something bigger?"**:
- **"👥 Create a Community"** → `navigation.navigate('CreateCommunity')` (no params) — always shown.
- Then exactly one of:
  - **"🏪 Manage Your Business"** → `navigation.navigate('BusinessDashboard')`, shown if `profiles.managed_partner_id` is non-null for the signed-in user (`managesBusiness` state, refetched on focus).
  - **"🤝 Partner with a Business"** → `navigation.navigate('RequestBusinessPartner')` (no params), shown otherwise.

This row has **no counterpart on Home**: Home's only community-related surface ("🏘️ Continue Your Communities") is read-only/continuation of already-joined communities, with zero creation affordance and zero business-management affordance — `CreateCommunity`, `BusinessDashboard`, and `RequestBusinessPartner` are not reachable from `HomeScreen.js` at all (confirmed by full-file read and the `navigate(...)` inventory in §1.I). This portion of Create is therefore additive, not duplicative, relative to Home.

---

# Nearby — Information Architecture Documentation
### Screens: Profile, Settings, Inbox (Messages + Activity), Gathering Detail, Gatherings (Attending/Hosting)

---

## 1. PROFILE

### A. SCREEN NAME
Profile (bottom tab label: "You")

### B. FILE PATH
`/workspaces/Nearby/src/screens/ProfileScreen.js`

### C. COMPLETE TOP-TO-BOTTOM UI HIERARCHY

- `SafeAreaView` (container)
  - `ScrollView`
    - Header row
      - Title text: "Profile" (`t('profile.title')`)
      - ⚙️ Settings gear button (top-right)
    - Subtitle: "Your story, your stats, your circle."
    - Quick Stats row (4 tappable stat cells: Communities / Friends / Upcoming / Past)
    - Link rows (each a full-width tappable card with chevron), in order:
      - 📖 View Your Timeline
      - 💫 Memory Vault
      - 📊 Your Insights
      - 🔥 Your Momentum
      - 🎁 Your Rewards
      - 💳 Billing
      - 🛡️ Emergency Contacts
    - Earned Stats row — *renders only if `earnedStats.favoriteVibe` or `earnedStats.usuallyActive` is non-null*
      - Favorite vibe stat card — *renders only if `favoriteVibe` present*
      - Usually active stat card — *renders only if `usuallyActive` present*
    - Achievements section — *renders only if at least one achievement is earned*
      - Section label: "Achievements"
      - Achievement badge grid (icon + label per earned badge)
    - Business Mode button — *conditional three-way branch*:
      - IF `managesBusiness`: 🏪 "Switch to Business" button
      - ELSE IF `myBusinessRequestStatus` is 'pending' or 'denied': ⏳/📋 "My Application (Pending)" / "My Application" button
      - ELSE: nothing rendered
    - Main photo picker (tap-to-add/change photo box with ✎ edit badge)
    - Verified row (dot + "Main photo verified" / "Main photo pending review")
    - Section label: "More Photos" (`t('profile.morePhotos')`)
    - Gallery grid
      - Extra photo tiles (long-press for options) — each may show "Pending" overlay if unverified
      - "+" add-photo tile — *renders only if `extraPhotos.length < 6`*
    - Helper text (tap-and-hold instructions)
    - Form card: Display Name input, Bio input (multiline)
    - Section label: "Prompts" (`t('profile.prompts')`)
    - Form card
      - Prompt cards (question + answer, tap to edit; ✕ remove button per card)
      - "Add a Prompt" dashed button — *renders only if `prompts.length < 3`*
      - Helper text
    - Section label: "What are you hoping to find?"
      - Connection-goal chip row (single-select: Meet friends / Date / Network / Explore my city / Find community / Get out more)
      - Helper text
    - Section label: "About You" (`t('profile.aboutYou')`)
    - Form card
      - "I identify as" label + gender-identity chip multi-select (GENDER_IDENTITY_OPTIONS)
      - Helper text
      - "I'm interested in dating" label + interested-in-genders chip multi-select (same option set)
      - Helper text
      - Pronouns text input
      - Sexual orientation text input
    - Section label: "Details" (`t('profile.detailsSection')`)
    - Form card — Accordion list of 10 free-text BASICS_FIELDS (each an `AccordionField`: tap header to expand/collapse, then a `TextInput`):
      Height, Living In, School, Job Title, Languages I Speak, In 5 Years I See Myself, Dream Place to Live, Skill I Want to Learn, Holiday Traditions, Cultural Values
    - Section label: "Basics" (`t('profile.basicsSection')`)
    - Form card — Accordion list of ~28 single-select BASICS_FIELDS (each an `AccordionField` expanding to a chip single-select):
      Hair Color, Eye Color, Diet, Looking For (relationship_goals), Relationship Type, Religion, Zodiac, Education, Family Plans, Communication Style, Love Language, Pets, Drinking, Smoking, Cannabis, Workout, Social Media, Financial Priority, Social Energy, Weekend Style, Independence, Family Closeness, Open to Relocating, A Typical Morning, Weeknight Dinner, My Life Chapter Right Now
    - Section label: "Interests" (`t('profile.interestsSection')`)
      - Interest chip multi-select (24 options: Travel, Coffee, Hiking, Music, Movies, Foodie, Fitness, Reading, Art, Gaming, Photography, Yoga, Dancing, Cooking, Wine, Dogs, Cats, Outdoors, Sports, Concerts, Museums, Volunteering, Meditation, Running)
    - ✨ "Why someone would be lucky to date you" button (AI strengths generator)
    - "Save" button (`t('profile.save')`)
  - `Modal` (Question Picker) — *visible only when `questionPickerVisible`*
    - Header: "Choose a Prompt" + Cancel
    - `FlatList` of unused `PROMPT_QUESTIONS` (30 total minus already-used ones), each row tappable
  - `Modal` (Answer Sheet, transparent, slide-up) — *visible only when `answerModalVisible`*
    - Question text (header)
    - Answer `TextInput` (multiline)
    - "Save" button
    - "Cancel" link

### D. EVERY SECTION (on-screen order)
1. Header ("Profile" + Settings gear)
2. Quick Stats row (Communities / Friends / Upcoming / Past)
3. Timeline / Memory Vault / Insights / Momentum / Rewards / Billing / Emergency Contacts link list
4. Earned Stats row (favorite vibe, usually active) — conditional
5. Achievements grid — conditional
6. Business Mode button (Switch to Business / My Application) — conditional
7. Main photo picker + verified status
8. More Photos gallery
9. Display Name / Bio form
10. Prompts
11. "What are you hoping to find?" (connection goal)
12. About You (gender identity, interested-in genders, pronouns, orientation)
13. Details (free-text basics accordion)
14. Basics (select-type basics accordion)
15. Interests
16. "Why someone would be lucky to date you" (AI strengths)
17. Save button

### E. EVERY CARD / BUTTON / CTA
- ⚙️ Settings gear icon (top-right of header)
- Quick Stat: number + "Communities"
- Quick Stat: number + "Friends"
- Quick Stat: number + "Upcoming"
- Quick Stat: number + "Past"
- 📖 "View Your Timeline" row
- 💫 "Memory Vault" row
- 📊 "Your Insights" row
- 🔥 "Your Momentum" row
- 🎁 "Your Rewards" row
- 💳 "Billing" row
- 🛡️ "Emergency Contacts" row
- 🏪 "Switch to Business" button (managesBusiness)
- ⏳ "My Application (Pending)" button (myBusinessRequestStatus==='pending')
- 📋 "My Application" button (myBusinessRequestStatus==='denied')
- Main photo tap target ("Tap to add a photo" / change photo) + ✎ edit badge
- Extra photo tiles (long-press → Alert action sheet: "Set as Main Photo" / "Remove" / "Cancel")
- "+" add extra photo tile
- Display Name text field
- Bio text field
- Prompt card (tap → edit; separate ✕ "Remove" button per prompt)
- "+ Add a Prompt" button (label from `t('profile.addPrompt')`)
- Connection-goal chips: Meet friends, Date, Network, Explore my city, Find community, Get out more (single-select toggle)
- Gender-identity chips (9 options, multi-select toggle each)
- Interested-in-gender chips (same 9 options, multi-select toggle each)
- Pronouns text field
- Sexual orientation text field
- 10 accordion rows in "Details" (each toggle-expand + text input)
- ~28 accordion rows in "Basics" (each toggle-expand + chip single-select, chip count varies 2–9 per field)
- 24 interest chips (multi-select toggle each)
- ✨ "Why someone would be lucky to date you" / "Thinking..." button
- "Save" button (`t('profile.save')`)
- Question Picker modal: Cancel button; each unused prompt question row (tap to select)
- Answer Sheet modal: Answer text field, "Save" button, "Cancel" link

### F. WHAT HAPPENS WHEN EACH MAJOR CTA IS TAPPED
- Settings gear → `navigation.navigate('Settings')`
- Communities stat → `navigation.navigate('Communities')`
- Friends stat → `navigation.navigate('Friends')`
- Upcoming stat → `navigation.navigate('Gatherings')`
- Past stat → `navigation.navigate('Gatherings')`
- View Your Timeline → `navigation.navigate('Timeline')`
- Memory Vault → `navigation.navigate('MemoryVaultIndex')`
- Your Insights → `navigation.navigate('Insights')`
- Your Momentum → `navigation.navigate('Momentum')`
- Your Rewards → `navigation.navigate('Rewards')`
- Billing → `navigation.navigate('Billing')`
- Emergency Contacts → `navigation.navigate('EmergencyContacts')`
- Switch to Business → `navigation.navigate('BusinessDashboard')`
- My Application (pending/denied) → `navigation.navigate('MyBusinessApplication')`
- Photo tap → opens native image picker (`pickProfilePhoto()`), then `uploadProfilePhoto()`; on success shows Alert "Photo updated... under review" and reloads
- Extra photo long-press → `Alert.alert` action sheet: "Set as Main Photo" (calls `setAsMainPhoto()`), "Remove" (calls `deleteExtraPhoto()`, destructive style)
- "+" add photo → opens picker (`pickExtraPhoto()`), then `uploadExtraPhoto()`
- Prompt card tap → opens Answer Sheet modal pre-filled for editing (state: `answerModalVisible=true`, `editingPromptIndex` set)
- Prompt ✕ → removes prompt from local state array (no immediate DB write; saved on "Save")
- Add a Prompt → opens Question Picker modal (state change), unless at the 3-prompt cap (Alert "Limit reached")
- Question row tap (in picker modal) → sets draft question, opens Answer Sheet modal
- Answer Sheet "Save" → runs `checkTextModeration()`; on pass, commits prompt to local `prompts` state and closes modal (persists to DB only on main Save)
- Connection-goal chip → toggles local `connectionGoal` state (single-select, deselect on repeat tap)
- Gender-identity / interested-in-gender chips → toggle local array state (multi-select)
- Details/Basics accordion header → `LayoutAnimation` + expand/collapse local state (`expandedField`)
- Basics select-chip tap → sets `basics[key]` (or clears it if re-tapped) and auto-collapses the accordion
- Interest chip → toggles local `interests` array
- "Why someone would be lucky to date you" → `fetch(functionUrl('generate-strengths'))` (Supabase Edge Function, POST with auth bearer token). On 403 → `Alert.alert('Premium Feature', ..., [{Not now}, {Upgrade to Premium → navigation.navigate('Paywall')}])`. On success → `Alert.alert('✨ A note for you', result.summary)`
- Save button → runs moderation checks on all free-text fields (`checkTextModeration`), then `supabase.from('profiles').update(...)` writing display_name, bio, interests, pronouns, gender, sexual_orientation, gender_identity, interested_in_genders, basics, prompts, connection_goal; shows `Alert.alert('Saved')` or error

### G. WHAT DATA IS SHOWN
- Display name, bio, interests, pronouns, gender, sexual_orientation, gender_identity, interested_in_genders, basics (JSON), prompts (JSON array), connection_goal, photo_verified, photo_url — all real columns from `supabase.from('profiles').select('*').eq('id', id).single()`
- Extra photos — `getExtraPhotos(id)` (real rows + signed URLs, includes `photo_verified` flag per photo)
- Quick Stats (Communities/Friends/Upcoming/Past) — `getProfileQuickStats()` in `services/homeDashboard.js`: real counts from `community_members`, `friendships` (status=accepted), `gathering_interest` (status=approved, joined `gatherings`) split by past/future `scheduled_at`, and `gatherings` where `host_id`=me, split future/past. Upcoming = attending-future + hosting-future; Past = attending-past + hosting-past.
- Achievements — `getAchievements()`: computed from `getProfileQuickStats()` plus `count` queries on `gatherings` (hosted, past) and `communities` (creator_id=me) and friends count; each badge's `earned` boolean is a real threshold check (e.g. "Regular" = pastGatherings ≥ 5), not a stored flag.
- Earned Stats (Favorite vibe / Usually active) — `getEarnedProfileStats()`: computed by aggregating `gathering_interest` (status=approved) joined to `gatherings.interest_tag`/`scheduled_at` for the current user — the most-frequent interest_tag and most common time-of-day, i.e. genuinely derived/"earned," not self-reported.
- Business mode: `managesBusiness` = `!!data.managed_partner_id` on the profile row (real column). `myBusinessRequestStatus` = `getMyBusinessPartnerRequest()` from `services/businessPartnerApply.js` (only fetched when not already a managed partner).
- AI Strengths note — real Supabase Edge Function call (`generate-strengths`), gated by premium (403 response triggers paywall).
- Timezone sync — background side-effect only (writes device timezone silently to `profiles.timezone`), not user-visible data.

### H. CLASSIFICATION
- Header/Settings gear → settings (navigation shortcut)
- Quick Stats (Communities, Friends) → social/connections, activity
- Quick Stats (Upcoming, Past) → commitments-upcoming-plans, activity
- Timeline, Memory Vault → activity, personal information
- Insights, Momentum, Rewards → activity, recommendations (gamification/stats)
- Billing → settings
- Emergency Contacts → settings (safety)
- Business Mode button → settings/creation (business-mode entry point)
- Photo picker, extra photos → personal information, creation
- Display name, bio → personal information
- Prompts → personal information, creation
- Connection goal chips → preferences, discovery (affects matching/recommendations)
- Gender identity / interested-in genders / pronouns / orientation → personal information, preferences (affects discovery/matching)
- Details/Basics accordions → personal information
- Interests → personal information, discovery (affects matching)
- AI Strengths button → creation (generated content), recommendations
- Save button → personal information (persistence action)

**Profile-vs-Settings crossover flags:**
- The ⚙️ gear icon itself is the only pure navigation link to Settings from Profile.
- **Business Mode button** ("Switch to Business" / "My Application") is functionally a settings/account-management action (identical row also exists in Settings under "Account & Billing"), not a profile-content edit — flagged as duplicated across Profile and Settings.
- **Billing** row on Profile duplicates the "Manage Subscription" row in Settings' "Account & Billing" section — a settings-type function surfaced on Profile.
- **Emergency Contacts** row on Profile duplicates the "Emergency Contacts" row in Settings' "Safety" section — another settings-type function surfaced on Profile.
- Everything else on Profile (photos, bio, prompts, chips, basics accordions) is genuinely profile-content editing, not settings.

**IDENTITY/PUBLIC PROFILE, SOCIAL/CONNECTIONS, ACTIVITY, PREFERENCES, ACCOUNT, SETTINGS tagging:**
| Item | Tag(s) |
|---|---|
| Settings gear | SETTINGS |
| Communities stat | SOCIAL/CONNECTIONS |
| Friends stat | SOCIAL/CONNECTIONS |
| Upcoming stat | ACTIVITY |
| Past stat | ACTIVITY |
| View Your Timeline | ACTIVITY |
| Memory Vault | SOCIAL/CONNECTIONS, ACTIVITY |
| Your Insights | ACTIVITY |
| Your Momentum | ACTIVITY |
| Your Rewards | ACTIVITY |
| **Billing** | **ACCOUNT / SETTINGS** (flagged — settings-type function on Profile) |
| **Emergency Contacts** | **ACCOUNT / SETTINGS** (flagged — settings-type function on Profile) |
| Achievements grid | ACTIVITY |
| **Switch to Business / My Application** | **ACCOUNT / SETTINGS** (flagged — settings-type function on Profile, duplicated in Settings) |
| Main photo, extra photos | IDENTITY/PUBLIC PROFILE |
| Display Name, Bio | IDENTITY/PUBLIC PROFILE |
| Prompts | IDENTITY/PUBLIC PROFILE |
| Connection goal chips | PREFERENCES |
| Gender identity / interested-in-genders | IDENTITY/PUBLIC PROFILE, PREFERENCES |
| Pronouns / sexual orientation | IDENTITY/PUBLIC PROFILE |
| Details accordion (10 text fields) | IDENTITY/PUBLIC PROFILE |
| Basics accordion (~28 select fields) | IDENTITY/PUBLIC PROFILE |
| Interests | IDENTITY/PUBLIC PROFILE, PREFERENCES |
| "Why someone would be lucky to date you" (AI) | IDENTITY/PUBLIC PROFILE |
| Save button | ACCOUNT (persistence) |

### I. WHERE THE USER CAN NAVIGATE FROM PROFILE (deduplicated)
`Settings`, `Communities`, `Friends`, `Gatherings`, `Timeline`, `MemoryVaultIndex`, `Insights`, `Momentum`, `Rewards`, `Billing`, `EmergencyContacts`, `BusinessDashboard`, `MyBusinessApplication`, `Paywall` (via strengths-paywall Alert)

### J. WHERE THE USER CAN NAVIGATE TO PROFILE FROM
Profile is the `Profile` bottom tab (registered in `RootNavigator.js` as `<Tab.Screen name="Profile" component={ProfileScreen} .../>`). No other screen calls `navigation.navigate('Profile')` directly anywhere in `src/` — it is reached exclusively by tapping the "You" tab-bar icon at the bottom of the app (a `ProfileTabIcon` showing the user's own photo).

---

## 2. SETTINGS

### A. SCREEN NAME
Settings

### B. FILE PATH
`/workspaces/Nearby/src/screens/SettingsScreen.js`

### C. COMPLETE TOP-TO-BOTTOM UI HIERARCHY
- `SafeAreaView`
  - `ScrollView`
    - Header: "Settings" (`t('settings.title')`)
    - Permission banner — *renders only if `osNotifPermission !== 'granted'`*: 🔕 "Notifications are off" (tap → opens system settings)
    - Section: "Looking For"
      - Card: Intention chips (multi-select, 5 options), helper text
    - Section: "Appearance"
      - Card:
        - Dark Mode row (Switch)
        - Divider
        - "Nearby Display Style" row: helper text + List/Cards chip toggle
    - Section: "Language"
      - Card: 11-language chip row (single-select)
    - Section: "Notifications"
      - Card: New Matches (Switch), Messages (Switch), Waves (Switch), each divided
    - Section: "Privacy"
      - Card: Read Receipts (Switch + helper), "I Message First" (Switch + helper)
    - Section: "Discovery Preferences"
      - Card:
        - "Show Me" chips (Men/Women/Everyone)
        - Age range (min/max number inputs)
        - "My Gender" chips (Men/Women/Other/Prefer not to say) + helper text clarifying it's separate from Profile's "Gender" field
        - "Hide My Gender" row (Switch + helper)
        - "My Ethnicity" chips
        - "Hide My Ethnicity" row (Switch + helper)
        - "Ethnicity Preferences" chips (multi-select) + helper text
        - "Save Preferences" button
    - Section: "Account"
      - Card — *three-state conditional*:
        - Default: "Change Phone Number" row
        - State 2 (`changingPhone && !otpSent`): New Phone Number input, "Send Verification Code" button, "Cancel" link
        - State 3 (`otpSent`): 6-digit code input, "Confirm New Number" button
    - Section: "Connect"
      - 🤝 "Friends" row
      - 🎵 "Music Mode" row
      - 🎁 "Invite Friends" row
    - Section: "Safety"
      - 🚫 "Blocked Users" row
      - ✓ "Verify Identity" row
      - 🛡️ "Emergency Contacts" row
      - ❤️ "Relationship" row
    - Section: "Account & Billing"
      - 💳 "Manage Subscription" row
      - 🎁 "Offers & Perks" row
    - Section: "Help & Legal"
      - ✨ "Everything In Nearby" row
      - "Legal" row
      - "Review Reports (Admin)" row — *renders only if `isAdmin`*
      - Business row — *three-way conditional*:
        - IF `managesBusiness`: 🏪 "Manage Your Business"
        - ELSE IF pending/denied: ⏳/📋 "My Application (Pending)"/"My Application"
        - ELSE: "Partner With Us"
      - "Business Dashboard (Admin)" row — *renders only if `isAdmin`*
      - "Business Requests (Admin)" row — *renders only if `isAdmin`*
      - "Review Verifications (Admin)" row — *renders only if `isAdmin`*
    - "Request My Data" button (data export)
    - "Sign Out" button
    - "Delete Account" button (destructive, 2-step confirm)

### D. EVERY SECTION (on-screen order)
1. Header + permission banner (conditional)
2. Looking For
3. Appearance
4. Language
5. Notifications
6. Privacy
7. Discovery Preferences
8. Account (phone number change flow)
9. Connect
10. Safety
11. Account & Billing
12. Help & Legal (incl. admin-only rows and business-application row)
13. Data export / Sign Out / Delete Account (unlabeled footer group)

### E. EVERY CARD / BUTTON / CTA
- 🔕 "Notifications are off" banner (conditional)
- Intention chips: 💍 Serious relationship, 😊 Casual dating, 🤝 New friends, 💒 Marriage-minded, 🤔 Still figuring it out (multi-select)
- Dark Mode Switch
- Nearby Display Style: 📋 List chip, 🃏 Cards chip
- Language chips: English, Español, Deutsch, Français, Português, Kreyòl Ayisyen, 中文, Tiếng Việt, Tagalog, Русский, 한국어 (11 total, single-select)
- Notification Switches: New Matches, Messages, Waves
- Privacy Switches: Read Receipts, I Message First
- "Show Me" chips: Men, Women, Everyone
- Min Age input, Max Age input
- "My Gender" chips: Men, Women, Other, Prefer not to say
- "Hide My Gender" Switch
- "My Ethnicity" chips (10 options, single-select w/ deselect)
- "Hide My Ethnicity" Switch
- "Ethnicity Preferences" chips (10 options, multi-select)
- "Save Preferences" button
- "Change Phone Number" row → New Phone input → "Send Verification Code" button → "Cancel" link → OTP input → "Confirm New Number" button
- 🤝 "Friends" row
- 🎵 "Music Mode" row
- 🎁 "Invite Friends" row
- 🚫 "Blocked Users" row
- ✓ "Verify Identity" row
- 🛡️ "Emergency Contacts" row
- ❤️ "Relationship" row
- 💳 "Manage Subscription" row
- 🎁 "Offers & Perks" row
- ✨ "Everything In Nearby" row
- "Legal" row
- "Review Reports (Admin)" row (admin only)
- Business row: "🏪 Manage Your Business" / "⏳ My Application (Pending)" / "📋 My Application" / "Partner With Us" (mutually exclusive by state)
- "Business Dashboard (Admin)" row (admin only)
- "Business Requests (Admin)" row (admin only)
- "Review Verifications (Admin)" row (admin only)
- "Request My Data" button
- "Sign Out" button
- "Delete Account" button (2-stage destructive Alert flow)

### F. WHAT HAPPENS WHEN EACH MAJOR CTA IS TAPPED
- Permission banner → `Linking.openSettings()` (opens native OS settings)
- Intention chip → `toggleIntention()`: immediately writes `relationship_intention` array to `profiles` table (no separate save button — instant persistence)
- Dark Mode Switch → `toggleTheme()` (ThemeContext, local/app-level, not DB)
- Display Style chip → `updateDiscoveryViewStyle()`: immediate write to `profiles.discovery_view_style`
- Language chip → `setLanguage()` (LanguageContext, app-level)
- Notification Switches → `toggleNotifPref()`: immediate write to `profiles.notify_matches` / `notify_messages` / `notify_waves`, with rollback+Alert on error
- Read Receipts / I Message First Switches → immediate write to `profiles.read_receipts_enabled` / `profiles.women_message_first`
- Show Me / Age / My Gender / My Ethnicity / Ethnicity Preferences → held in local state, only committed on "Save Preferences" tap → `supabase.from('profiles').update({discovery_gender, show_me, preferred_min_age, preferred_max_age, ethnicity, ethnicity_preferences})`
- Hide My Gender / Hide My Ethnicity Switches → immediate write to `profiles.gender_hidden` / `profiles.ethnicity_hidden`
- "Save Preferences" → validates age range, writes to `profiles`, `Alert.alert('Saved')`
- "Change Phone Number" → reveals inline form (state change, no navigation)
- "Send Verification Code" → `supabase.auth.updateUser({phone})`, reveals OTP input
- "Confirm New Number" → `supabase.auth.verifyOtp({phone, token, type:'phone_change'})`, Alert "Phone number updated"
- Friends → `navigation.navigate('Friends')`
- Music Mode → `navigation.navigate('MusicMode')`
- Invite Friends → `navigation.navigate('InviteFriends')`
- Blocked Users → `navigation.navigate('BlockedUsers')`
- Verify Identity → `navigation.navigate('IdVerification')`
- Emergency Contacts → `navigation.navigate('EmergencyContacts')`
- Relationship → `navigation.navigate('RelationshipHub')`
- Manage Subscription → `navigation.navigate('Billing')`
- Offers & Perks → `navigation.navigate('BrandOffers')`
- Everything In Nearby → `navigation.navigate('FeaturesOverview')`
- Legal → `navigation.navigate('Legal')`
- Review Reports (Admin) → `navigation.navigate('AdminReports')`
- Business row → `navigation.navigate('BusinessDashboard')` (managesBusiness) / `navigation.navigate('MyBusinessApplication')` (pending/denied) / `navigation.navigate('BusinessPartnerApply')` (else)
- Business Dashboard (Admin) → `navigation.navigate('BusinessDashboard')`
- Business Requests (Admin) → `navigation.navigate('AdminBusinessRequests')`
- Review Verifications (Admin) → `navigation.navigate('AdminVerification')`
- Request My Data → `requestDataExport()` (service call, likely triggers backend export/email; no navigation)
- Sign Out → `supabase.auth.signOut()` (triggers app-level auth state change, redirect handled by RootNavigator, not an explicit navigate call)
- Delete Account → two chained `Alert.alert` confirmations ("Delete your account?" → "Are you absolutely sure?") → `deleteAccount()` service call

### G. WHAT DATA IS SHOWN
- All preference toggles/values are real columns loaded from `supabase.from('profiles').select('*').eq('id', id).single()`: `discovery_gender`, `show_me`, `preferred_min_age`, `preferred_max_age`, `notify_matches`, `notify_messages`, `notify_waves`, `gender_hidden`, `ethnicity`, `ethnicity_hidden`, `discovery_view_style`, `ethnicity_preferences`, `relationship_intention`, `read_receipts_enabled`, `women_message_first`, `managed_partner_id`
- OS notification permission — real `Notifications.getPermissionsAsync()` (expo-notifications), re-checked on `AppState` change to 'active'
- Business application status — `getMyBusinessPartnerRequest()` real service call (only when not already `managed_partner_id`)
- `isAdmin` — from `useAuth()` context (real auth-role check), gates 4 admin-only rows

### H. CLASSIFICATION (per item)
- Permission banner → settings
- Looking For (intention chips) → preferences, personal information (shown on profile per helper text)
- Appearance (Dark Mode, Display Style) → settings
- Language → settings
- Notifications (3 switches) → settings
- Privacy (Read Receipts, I Message First) → settings, messaging (affects chat behavior)
- Discovery Preferences (all) → discovery, preferences
- Account (phone change) → settings
- Connect (Friends, Music Mode, Invite Friends) → social/connections (navigation shortcuts), creation (Invite Friends)
- Safety (Blocked Users, Verify Identity, Emergency Contacts, Relationship) → settings
- Account & Billing (Manage Subscription, Offers & Perks) → settings
- Help & Legal (Everything In Nearby, Legal) → settings
- Admin rows → settings (admin-only)
- Business row → settings, creation (application flow)
- Request My Data / Sign Out / Delete Account → settings

### Settings ↔ Profile / Discover cross-reference
- **Discovery Preferences (Show Me, Age Range, My Gender, Hide Gender, My Ethnicity, Hide Ethnicity, Ethnicity Preferences)** — no direct equivalent UI exists on the Discover/Meet-People surface itself in these files, but these are the exact server-side filters that determine what Discover shows; the screen's own helper text explicitly calls out overlap risk with Profile: *"This is separate from the 'Gender' field on your profile — it's only used to match against other people's 'Show Me' preference."* So Settings' "My Gender" (discovery_gender) and Profile's "About You → I identify as / gender" fields cover related-but-distinct subject matter (discovery matching field vs. public identity field) and are easy to conflate.
- **Looking For / Intention chips** (Settings) duplicate subject matter with Profile's "What are you hoping to find?" (connection_goal) — both are "why are you here" style preference captures, stored as separate columns (`relationship_intention` array vs. `connection_goal` string) and edited on two different screens.
- **Business row** ("Manage Your Business" / "My Application" / "Partner With Us") in Settings' Help & Legal section is a duplicate of Profile's own "Switch to Business" / "My Application" row — identical destination screens (`BusinessDashboard`, `MyBusinessApplication`), same conditional logic, same data source (`managed_partner_id`, `getMyBusinessPartnerRequest()`), present on both screens.
- **Emergency Contacts** in Settings' Safety section duplicates Profile's own "Emergency Contacts" link-row.
- **Manage Subscription/Billing** in Settings' Account & Billing duplicates Profile's own "Billing" link-row.
- **Nearby Display Style** (list/cards) in Settings' Appearance section governs how the Discover/Nearby browsing surface renders — a Discover-related setting housed entirely in Settings, with no equivalent control on the Discover screen itself.

### I. WHERE THE USER CAN NAVIGATE FROM SETTINGS (deduplicated)
`Friends`, `MusicMode`, `InviteFriends`, `BlockedUsers`, `IdVerification`, `EmergencyContacts`, `RelationshipHub`, `Billing`, `BrandOffers`, `FeaturesOverview`, `Legal`, `AdminReports` (admin), `BusinessDashboard`, `MyBusinessApplication`, `BusinessPartnerApply`, `AdminBusinessRequests` (admin), `AdminVerification` (admin)

### J. WHERE THE USER CAN NAVIGATE TO SETTINGS FROM
Only one call site found in `src/`: `screens/ProfileScreen.js:413` — the ⚙️ gear icon on Profile. `Settings` is registered in `RootNavigator.js` as a top-level `Stack.Screen` (headerShown, title "Settings"), reachable via `navigation.navigate('Settings')` from anywhere with stack access, but Profile's gear icon is the only actual call site present in the codebase.

---

## 3. INBOX (Messages tab = MatchesScreen, Activity tab = ActivityScreen)

### A. SCREEN NAME
Inbox (bottom tab, embeds two internal sections: "💬 Messages" and "🔔 Activity")

### B. FILE PATH
- Shell: `/workspaces/Nearby/src/screens/InboxScreen.js`
- Messages tab: `/workspaces/Nearby/src/screens/MatchesScreen.js`
- Activity tab: `/workspaces/Nearby/src/screens/ActivityScreen.js`

### C. COMPLETE TOP-TO-BOTTOM UI HIERARCHY

**InboxScreen (shell):**
- `SafeAreaView`
  - Header
    - Title "Inbox" + subtitle "Messages, requests, and everything else waiting for you."
    - 🤝 "Friends" button
  - Toggle row: 💬 Messages / 🔔 Activity (with pending-count badge, e.g. "🔔 Activity (3)")
  - Body — *mutually exclusive by `section` state*:
    - IF `section==='messages'`:
      - Group chats horizontal row — *renders only if `groupChats.length > 0`*: chips per gathering-chat (🎉) or community-chat (🏘️)
      - `<MatchesScreen />` embedded
    - IF `section==='activity'`: `<ActivityScreen initialSubSection={...} />` embedded

**MatchesScreen (Messages tab):**
- `SafeAreaView`
  - Header: "Matches" title (`t('matches.title')`)
  - `StoriesRow` component (stories feature, not detailed here)
  - Offers banner — *renders only if `newOfferCount > 0`*: 🎁 "N new offer(s) available"
  - `FlatList` of match rows (or `SkeletonCard` loading state / empty state "✨ ...")
    - Each row: avatar (tap → view profile), name + compatibility badge (romantic matches only, tap → compatibility report modal), sub-label (matched-time / "Met through X gathering"), chevron (tap row body → chat)
  - `MatchCelebrationModal` — *visible only when a new match is detected*
  - `CompatibilityReportModal` — *visible only when a compat report is requested*
  - Background: `Alert.alert` "How did your date go?" check-in prompt — *fires only if `getPendingCheckIns()` returns results*

**ActivityScreen (Activity tab):**
- `SafeAreaView`
  - Header: "Activity"
  - Upsell banner — *renders only if `!premium`*: ✨ "Unlock Premium" banner
  - Loading: skeleton grid (4x `SkeletonGridCard`) — *while loading*
  - `FlatList` with:
    - `ListHeaderComponent` — *renders only if any group has content*: three named groups, reorderable via `groupOrder` (deep-link `initialSubSection` moves one to front):
      - 🙋 "Connection Requests (N)" — *renders only if `connectionRequests.length > 0`*: rows of people wanting to join gatherings you host, each with Approve button
      - 🤝 "Invitations (N)" — *renders only if `combinedInvites.length > 0`*: friend requests (Accept) + social invites to gatherings/communities (Accept/Decline)
      - ⏰ "Upcoming (N)" — *renders only if `reminders.length > 0`*: gatherings starting within 24h (attending or hosting), non-tappable info rows
    - `ListEmptyComponent` — *renders only if no group content*: 🔔 "Nothing new yet..." empty state
    - Main chronological feed items (notices, sightings/crossed-paths, business updates), each tappable row

### D. EVERY SECTION (on-screen order)
1. Inbox header (title, subtitle, Friends button)
2. Messages/Activity toggle
3. **Messages tab:** Group chats row (conditional) → Matches header → Stories row → Offers banner (conditional) → Match list
4. **Activity tab:** Activity header → Premium upsell banner (conditional) → Connection Requests group (conditional) → Invitations group (conditional) → Upcoming group (conditional) → chronological feed (notices / crossed paths / business updates)

### E. EVERY CARD / BUTTON / CTA
- 🤝 "Friends" header button
- 💬 "Messages" toggle button
- 🔔 "Activity (N)" toggle button
- Group-chat chip (🎉 gathering or 🏘️ community icon + title), one per chat
- 🎁 "N new offer(s) available" banner
- Match row: avatar tap, name/compat-badge row, chat-open tap, "X% · Why?" compatibility badge
- Match Celebration Modal: "Keep Browsing" / "Send a Message" buttons (inside Alert triggered by notice-back flow, plus modal's own send-message action)
- Check-in Alert: "I'm safe 👍" / "Something felt wrong" buttons; nested Alert: "Message my check-in contact" / "Report or Block" / "Dismiss"
- ✨ "Unlock Premium" upsell banner (Activity tab)
- Connection Request row: "Approve" text button per pending join request
- Invitation row (friend): "Accept" text button
- Invitation row (social/gathering/community): "Decline" + "Accept" text buttons
- Upcoming/reminder row: non-interactive (title, role, "in N hours")
- Business update row: tappable (navigates to business profile)
- Notice/Wave row: tappable card; premium users additionally get a 👋/✓ inline "notice back" button
- Crossed-paths ("📍 Crossed paths with X") row: tappable

### F. WHAT HAPPENS WHEN EACH MAJOR CTA IS TAPPED
- Friends button → `navigation.navigate('Friends')`
- Messages / Activity toggle → local `section` state change (no navigation)
- Group-chat chip → `navigation.navigate('GatheringChat', {gatheringId, gatheringTitle})` or `navigation.navigate('CommunityChat', {communityId, communityName})`
- Offers banner → `navigation.navigate('BrandOffers')`
- Match row avatar → `navigation.navigate('ViewProfile', {userId: other.id})`
- Match row body → `navigation.navigate('Chat', {matchId: item.id})`
- Compatibility badge → opens `CompatibilityReportModal` (state change, no navigation)
- Match Celebration Modal "Send Message" → `navigation.navigate('Chat', {matchId})`
- Check-in "I'm safe" → `respondToCheckIn(id, 'safe')`
- Check-in "Something felt wrong" → nested Alert → "Message my check-in contact" triggers native `Share.share()` + `respondToCheckIn(id, 'help_needed')`; "Report or Block" → `respondToCheckIn()` + `navigation.navigate('Chat', {matchId})`
- Upsell banner → `navigation.navigate('Paywall')`
- Connection Request "Approve" → `approveInterest(request.id)`; if waitlisted, Alert; reloads request list
- Friend-request "Accept" → `respondToFriendRequest(friendshipId, true)`
- Social invite "Decline" → `respondToInvite(id, false)`
- Social invite "Accept" → `respondToInvite(id, true)` then `navigation.navigate('GatheringDetail', {gatheringId})` or `navigation.navigate('CommunityDetail', {communityId, communityName})`
- Business update row → `navigation.navigate('BusinessProfile', {partnerId})`
- Notice/Wave row tap → if premium (or item is a "sighting") → `navigation.navigate('ViewProfile', {userId})`; else → `navigation.navigate('Paywall')`
- Notice inline 👋 "notice back" button → `sendNoticeTo(from_user, false)`; on match, `Alert.alert("It's a Match! 🎉", ..., [{Keep Browsing}, {Send a Message → navigation.navigate('Matches')}])`
- Crossed-paths row tap → same `handleCardPress` logic as notices (ViewProfile or Paywall)

### G. WHAT DATA IS SHOWN
- Group chats: `getMyGatheringChats()` + `getMyCommunities()` — real gathering/community chat memberships
- Pending count badge: `getPendingInvitesCount()` — the same real aggregate (pending join requests + pending friend requests + pending social invites) used by Home's own pending-invites banner (explicitly noted in code comments as intentional reuse)
- Matches list: `supabase.from('matches').select(...)` joined to both profiles, ordered by `matched_at desc` — real match rows, including `source_gathering_id`/`source_friendship_id` to distinguish romantic vs. gathering/friend-sourced connections
- Compatibility score/report: `generateCompatibilityReport(myProfile, other)` — computed client-side from `interests`/`basics` fields, romantic matches only
- New-offer banner count: `getActiveOffers()` minus `getMyRedemptions()` — real unredeemed offer count
- Pending check-ins: `getPendingCheckIns()` from `services/dateSafety.js` — real safety check-in rows
- Connection Requests: `getAllPendingRequests()` — real `gathering_interest` rows (status=pending) for gatherings the user hosts
- Invitations: `getPendingFriendRequests()` + `getMyReceivedInvites()` — real friendship and invite rows
- Upcoming/reminders: `getUpcomingReminders()` — real query against `gathering_interest` (approved, joined `gatherings`) + `gatherings` (hosted), both filtered to `scheduled_at` within the next 24 hours
- Main feed: `notices` table (capped at 200, most recent first, excluding matched/blocked users), `getNearbyMatches()` sightings (capped at 10), `getFollowedBusinessUpdates()` — all real, interleaved by timestamp

### H. CLASSIFICATION (per item type)
| Item | Classification |
|---|---|
| Match/message row | CONVERSATION |
| Group-chat chip | CONVERSATION |
| Connection request row (join-my-gathering) | REQUEST |
| Friend request row | REQUEST |
| Social invite row (gathering/community) | REQUEST |
| Upcoming/reminder row | **COMMITMENT** |
| Notice/Wave row | NOTIFICATION, ACTIVITY |
| Crossed-paths/sighting row | NOTIFICATION, ACTIVITY, discovery |
| Business update row | NOTIFICATION |
| Compatibility badge/report | ACTIVITY (recommendations-adjacent, computed insight) |
| Offers banner | NOTIFICATION, recommendations |
| Premium upsell banner | recommendations (upsell) |

**Home-overlap flag:** The Activity tab's **⏰ "Upcoming" group** (`getUpcomingReminders()` — gatherings starting in the next 24 hours, attending or hosting) shows the same *kind* of commitment data as Home's own hero card (`dashboard.upcomingPlans[0]`, sourced from the same `homeDashboard`/gathering-attendance domain, just a different time window — Home shows the single next plan regardless of 24h cutoff, Activity shows all plans within 24h). Both are "your confirmed upcoming gathering(s)" surfaces drawing from overlapping underlying data (`gathering_interest`/`gatherings` for the same user), rendered as non-interactive info rows here vs. a large actionable hero card on Home — this is a clear duplicate-surface case: the same commitment fact ("you have gathering X coming up") is shown in Inbox→Activity and again on Home.

### I. WHERE THE USER CAN NAVIGATE FROM INBOX (deduplicated across both tabs)
`Friends`, `GatheringChat`, `CommunityChat`, `BrandOffers`, `ViewProfile`, `Chat`, `Paywall`, `GatheringDetail`, `CommunityDetail`, `BusinessProfile`, `Matches` (self, via celebration modal's "Send a Message" shortcut)

### J. WHERE THE USER CAN NAVIGATE TO INBOX FROM
- Bottom tab bar: `<Tab.Screen name="Matches" component={InboxScreen} .../>` (tab bar label "Inbox")
- `screens/HomeScreen.js:215` — `navigation.navigate('Matches', {initialSection: 'invitations'})` (deep-links straight into Activity tab's Invitations group)
- `screens/HomeScreen.js:355` — `navigation.navigate('Matches')` (unread-messages card row → Messages tab)
- `screens/ActivityScreen.js:269` — self-referential, `navigation.navigate('Matches')` from the notice-back match Alert ("Send a Message")
- `screens/GatheringsScreen.js:357` — `navigation.navigate('Matches')` from the "You're In!" auto-approved-gathering Alert
- Additionally, a separate top-level stack route `Notices` (registered as `<Stack.Screen name="Notices" component={ActivityScreen} .../>`) provides direct, non-tab access straight into ActivityScreen (bypassing the InboxScreen shell/toggle) — reached via `services/notifications.js:112` (push notification tap) and `components/ActivityBell.js:46` (a 🔔 header bell button used elsewhere in the app)

---

## 4. GATHERING DETAIL

### A. SCREEN NAME
Gathering Detail

### B. FILE PATH
`/workspaces/Nearby/src/screens/GatheringDetailScreen.js`

### C. COMPLETE TOP-TO-BOTTOM UI HIERARCHY
- `View` (container) — *early-return states: loading spinner; "not available anymore" text if gathering is null*
  - `ScrollView`
    - Hero image — *3-way conditional*: real cover photo (`coverUrl`) → curated stock cover photo (`curatedCover`) → category-icon fallback tile
    - Content block
      - Title row: category badge icon + gathering title
      - Meta line: formatted date/time + distance label
      - Capacity line — *renders only if `capacity != null`*: "🔒 Full — X/Y spots" or "X/Y spots filled"
      - Host line (tappable, avatar + "Hosted by X")
      - 👩 "Women Only" badge — *conditional*
      - "Why this fits you" reasons card — *renders only if `reasons.length > 0`*
      - Description text — *conditional*
      - "Who's Going" section — *renders only if `approvedAttendees.length > 0`*: avatar stack (up to 6) + count text; 🌱 first-timer note (conditional)
      - "📋 What to Expect" section — *renders only if vibe scales or timeline_steps present*
        - "The Vibe" sub-section: Energy/Conversation/Group-feel 5-dot scales; 🔰 Beginner friendly note (conditional)
        - "Timeline" sub-section: step-by-step vertical timeline
      - "🏘️ Community & Perks" section — *renders only if `offer` or `gathering.community` present*
        - 🎁 Community Perk card (offer title, tappable brand-partner link, description)
        - Community card (tappable, "View community →")
      - "Meet the Organizer" section: avatar+name row (tappable), host stats line (hosted count/avg attendance), reputation line (welcoming %/would-return %), loved-tags line
      - `GatheringQnA` component (Q&A widget)
      - **Bottom action panel — mutually exclusive by role/status:**
        - IF `gathering.isHost`: Host banner
          - "You're hosting this gathering." text
          - Countdown stat row: Going / Interested / Messages / Waitlisted (conditional) counts
          - "🔥 Almost full" nudge — *conditional*
          - "Manage attendees →" link
          - "🤝 Invite friends →" link
          - "🤝 Request a Business Partner →" link
          - "🏘️ Start a Community from This Gathering →" link — *renders only if no `community_id` AND gathering already occurred*
        - ELSE IF `myStatus==='approved'`: "You're In!" panel
          - "Open Gathering Hub →" button
          - "💬 Say Hello" link (opens group chat)
          - "🤝 Invite friends" link
          - "Leave Gathering" link (destructive)
        - ELSE IF `myStatus==='waitlisted'`: pending panel — "You're on the waitlist" text + "Leave Waitlist" link
        - ELSE IF `myStatus==='pending'`: pending panel — "You're interested..." text + "Withdraw Request" link
        - ELSE IF invite-only and no access: pending panel — "🔒 invite-only" text (no action)
        - ELSE (default/joinable): "JOIN GATHERING" / "REQUEST TO JOIN" / "JOIN WAITLIST" button + "🤝 Invite a friend" link
  - `GatheringIntentModal` — *visible when `intentModalVisible`*
  - `InviteFriendsModal` — *visible when `inviteModalVisible`*

### D. EVERY SECTION (on-screen order)
1. Hero image
2. Title / meta / capacity / host line / Women Only badge
3. "Why this fits you" (conditional)
4. Description
5. "Who's Going"
6. "What to Expect" (Vibe + Timeline)
7. "Community & Perks" (Community Perk card + Community card)
8. "Meet the Organizer"
9. Q&A widget
10. Bottom action panel (host banner / attendee status panel / join button) — role/status-dependent

### E. EVERY CARD / BUTTON / CTA
- Host line (avatar + name, tappable)
- Community Perk card → brand-partner name link
- Community card ("View community →")
- Organizer row (avatar + name, tappable)
- Host banner: "Manage attendees →", "🤝 Invite friends →", "🤝 Request a Business Partner →", "🏘️ Start a Community from This Gathering →" (conditional)
- "You're In!" panel: "Open Gathering Hub →" button, "💬 Say Hello" link, "🤝 Invite friends" link, "Leave Gathering" link
- Waitlisted panel: "Leave Waitlist" link
- Pending panel: "Withdraw Request" link
- Join button: "JOIN GATHERING" / "REQUEST TO JOIN" / "JOIN WAITLIST"
- "🤝 Invite a friend" link (non-attendee state)
- `GatheringIntentModal` confirm/cancel (embedded component, not detailed)
- `InviteFriendsModal` (embedded component, not detailed)

### F. WHAT HAPPENS WHEN EACH MAJOR CTA IS TAPPED
- Host line / Organizer row → `navigation.navigate('ViewProfile', {userId: gathering.host_id})`
- Community Perk brand link → `navigation.navigate('BusinessProfile', {partnerId: offer.partner_id})`
- Community card → `navigation.navigate('CommunityDetail', {communityId, communityName})`
- "Manage attendees →" (host) → `navigation.navigate('Gatherings')`
- "🤝 Invite friends →" (host) / "🤝 Invite friends" (attendee) / "🤝 Invite a friend" (non-attendee) → opens `InviteFriendsModal` (state change, no navigation)
- "🤝 Request a Business Partner →" → `navigation.navigate('RequestBusinessPartner', {targetType:'gathering', targetId: gatheringId, targetTitle})`
- "🏘️ Start a Community from This Gathering →" → `navigation.navigate('CreateCommunity', {seedFromGatheringId, quickStartTitle, quickStartCategory})`
- "Open Gathering Hub →" → `navigation.navigate('GatheringHub', {gatheringId})`
- "💬 Say Hello" → `navigation.navigate('GatheringChat', {gatheringId, gatheringTitle})`
- "Leave Gathering" / "Leave Waitlist" / "Withdraw Request" → confirmation `Alert.alert` → `leaveGathering(gatheringId)` → reload
- Join/Request/Waitlist button → opens `GatheringIntentModal` (state) → on confirm: `checkGatheringInterestLimit()` (if blocked, Alert with "Upgrade to Premium" → `navigation.navigate('Paywall')`); else `expressInterest(gatheringId)` — if auto-approved, `navigation.replace('GatheringHub', {gatheringId, justJoined:true})`; else reloads in-place (pending/waitlisted panel)

### G. WHAT DATA IS SHOWN
- Core gathering record — `getGatheringById(gatheringId)`: title, description, scheduled_at, capacity, approvedAttendees, waitlistCount, host, myStatus, isHost, community, visibility, women_only, vibe scale fields, timeline_steps, interest_tag, cover_photo_path
- Cover photo — `getSignedGatheringPhotoUrl()` (real) or `curatedCoverPhotoFor(interest_tag)` (static curated fallback) or category icon (final fallback)
- "Why this fits you" reasons — `getGatheringFitReasons(gathering, {firstTimerCount})` — computed client-side reasoning
- First-timer count — `getFirstTimerAttendeeIds(gatheringId, attendeeIds)` — real query
- Community Perk offer — `getGatheringOffer(gatheringId)` — real brand_partners-linked offer row
- Host stats — `getHostStats(host_id)`: real `gatherings_hosted` count, `avg_attendance`
- Host reputation — `getHostReputation(host_id)`: real `welcoming_pct`, `would_return_pct`, `feedback_count`
- Loved tags — `getHostLovedTags(host_id)`: real aggregated feedback tags
- Host-only countdown stats — `getApprovedAttendeeCount()`, `getPendingInterestCount()`, `getGatheringMessageCount()` (all real, host-only queries)
- Attendee avatars — signed photo URLs per `approvedAttendees`

### H. CLASSIFICATION
- Hero/title/meta/description → discovery
- "Why this fits you" → recommendations, discovery
- "Who's Going" → discovery, social/connections
- "What to Expect" (Vibe/Timeline) → discovery
- Community & Perks → discovery, business-mode-related (see section below)
- Meet the Organizer → discovery, social/connections
- Q&A widget → messaging (public Q&A), discovery
- Host banner (countdown stats, manage attendees, invite friends, request business partner, start community) → commitments-upcoming-plans (host's own event), creation, messaging (invite), activity
- "You're In!" panel (Open Hub, Say Hello, Invite, Leave) → commitments-upcoming-plans, messaging
- Waitlisted/Pending panels → commitments-upcoming-plans (pending state)
- Join button → creation (joining is a commitment action), discovery

### Where a user's own upcoming/attending/hosting gathering is surfaced elsewhere (cross-reference)
- **Home hero card** (`HomeScreen.js`) — the single next upcoming plan (attending or hosting), tapping it → `navigation.navigate('GatheringDetail', {gatheringId})`
- **Home "best pick" card** and secondary upcoming-plans list (`dashboard.upcomingPlans.slice(1)`) also link to `GatheringDetail`
- **Inbox → Activity tab's "⏰ Upcoming" group** — non-tappable reminder rows for gatherings in the next 24h (see Inbox section H above for the Home-overlap flag)
- **Gatherings screen → Attending tab** and **Hosting tab** — full lists of a user's own upcoming (and past) gatherings, each card linking to `GatheringDetail`
- **Profile's Quick Stats "Upcoming"/"Past"** — numeric counts only, tapping navigates to `Gatherings` (not directly to a specific `GatheringDetail`)
- **GatheringHub** (a distinct "live day-of" screen, not documented here) also links back to `GatheringDetail` via its own back/detail link

---

## 5. GATHERINGS — ATTENDING TAB

### A. SCREEN NAME
Gatherings — "Attending" tab (`t('gatherings.attendingTab')`)

### B. FILE PATH
`/workspaces/Nearby/src/screens/GatheringsScreen.js`

### C. COMPLETE TOP-TO-BOTTOM UI HIERARCHY (Attending tab only)
- Shared header (see Gatherings Overview below): title "Gatherings", 🗺️/📋 map-list view toggle, "Host" create button, offers banner (conditional), 3-way tab row (Nearby/Attending/Hosting)
- Attending tab body:
  - IF `viewStyle==='map'`: `GatheringsMapView` showing `attending.upcoming` pins, tap pin → `GatheringDetail`
  - ELSE: `FlatList` of synthetic rows:
    - "Upcoming" section header — *renders only if `attending.upcoming.length > 0`*
    - Upcoming gathering cards (one per item in `attending.upcoming`)
    - "Past (N)" collapsible section header — *renders only if `attending.past.length > 0`*; expand/collapse chevron; when expanded, a "Sort: Newest/Oldest first ⇅" toggle appears
    - Past gathering cards — *rendered only when Past section is expanded*, sorted by `attendingPastSort`
    - Empty state: "✅ ..." (`t('gatherings.emptyAttending')`) — *renders only if no upcoming or past items*
  - Each **upcoming** card:
    - Cover photo (real or curated fallback)
    - Tappable header: category badge, title, "Hosted by X", expand-chevron (toggles fellow-attendees section)
    - "🤝 N friend(s) also going" badge — *conditional*
    - Description (conditional)
    - Formatted date/time
    - "You're Going" badge
    - "🚀 Gathering Hub" button
    - Expanded state (*conditional on `expandedGathering===item.id`*):
      - Vibe/timeline details (`renderVibeDetails`)
      - `GatheringQnA` (read-only, isHost=false)
      - "Who else is going" fellow-attendees list: each row = avatar+name (tappable) + "Notice Sent"/"Send Notice" button
  - Each **past** card (isPast=true): same cover/header but not expandable, no Hub button, "✓ Attended" badge instead of "You're Going", plus `GatheringFeedbackPrompt` component

### D. EVERY SECTION (on-screen order)
1. Shared Gatherings header + tab row
2. "Upcoming" gatherings list (conditional)
3. "Past (N)" collapsible section (conditional), with sort toggle when expanded

### E. EVERY CARD / BUTTON / CTA
- Upcoming gathering card: title/header tap (toggles fellow-attendees expand), "View details" tap-through (title→GatheringDetail), "🚀 Gathering Hub" button, fellow-attendee rows (avatar tap + "Send Notice"/"Notice Sent" button per fellow)
- Past gathering card: title tap → GatheringDetail; "✓ Attended" badge (non-interactive); embedded `GatheringFeedbackPrompt` (feedback CTA, not detailed further)
- "Past (N)" header (tap to expand/collapse) + "Sort: Newest first/Oldest first ⇅" toggle (when expanded)
- Map view: pin tap → GatheringDetail

### F. WHAT HAPPENS WHEN EACH CTA IS TAPPED
- Card title/header (inside `TouchableOpacity` wrapping title) → `navigation.navigate('GatheringDetail', {gatheringId: item.id})`
- Card body tap (non-title area) → `toggleExpandGathering(item.id)` — local expand state, triggers `getFellowAttendees(gatheringId)` fetch on first expand
- "🚀 Gathering Hub" button → `navigation.navigate('GatheringHub', {gatheringId: item.id})`
- Fellow-attendee avatar/name → `navigation.navigate('ViewProfile', {userId: fellow.user_id})`
- "Send Notice" button → `sendNoticeTo(userId, false)`; on `ALREADY_SENT` error → Alert "Already sent"
- Past section header → toggles `attendingPastExpanded` local state
- Sort toggle → toggles `attendingPastSort` between 'newest'/'oldest' (client-side re-sort, no refetch)
- Map pin tap → `navigation.navigate('GatheringDetail', {gatheringId: gathering.id})`

### G. WHAT DATA IS SHOWN
- `attending.upcoming` / `attending.past` — `getMyAttendingGatherings()` (real service call, likely querying `gathering_interest` status=approved joined to `gatherings`, split by `scheduled_at` vs now)
- Fellow attendees — `getFellowAttendees(gatheringId)` (real, fetched lazily on expand) with signed photo URLs
- Cover photos — `getSignedGatheringPhotoUrl()` (real) or `curatedCoverPhotoFor()` (static fallback)
- "N friend(s) also going" — computed client-side by intersecting `item.approvedAttendees` against `myFriendIds` (from `getMyFriends()`)

### H. CLASSIFICATION
- Upcoming gathering cards → commitments-upcoming-plans
- Past gathering cards → activity (history)
- Gathering Hub button → commitments-upcoming-plans, messaging (live event coordination)
- Fellow-attendees list + Send Notice → discovery, social/connections, messaging (notice = a lightweight interest signal)
- Sort/expand controls → activity (navigation-of-list controls, not content)

---

## 6. GATHERINGS — HOSTING TAB

### A. SCREEN NAME
Gatherings — "Hosting" tab (`t('gatherings.hostingTab')`)

### B. FILE PATH
`/workspaces/Nearby/src/screens/GatheringsScreen.js`

### C. COMPLETE TOP-TO-BOTTOM UI HIERARCHY (Hosting tab only)
- Shared header + tab row (same as Attending)
- Hosting tab body:
  - IF `viewStyle==='map'`: `GatheringsMapView` showing `hosting.upcoming` pins
  - ELSE: `FlatList` of synthetic rows:
    - "Upcoming" section header — *conditional*
    - Upcoming hosted-gathering cards
    - "Past (N)" collapsible header — *conditional*, with sort toggle when expanded
    - Past hosted-gathering cards — *only when expanded*
    - Empty state: "📅 ..." (`t('gatherings.emptyHosting')`)
  - Each **upcoming hosted** card:
    - Cover photo
    - Header row: category badge, title (tap → GatheringDetail), 🤝 invite-friends icon button (conditional on having friends), ✏️ Edit icon button, "Cancel" text button
    - Formatted date/time
    - Two-button row: "💬 Group Chat" / "🚀 Hub"
    - Interested-people list: each row = name + status (⏳ pending → "Approve" button / ✓ "Approved" label)
    - "No one has expressed interest yet" text — *if `interested` empty*
    - Vibe/timeline details (`renderVibeDetails`, always shown for non-past)
    - `GatheringQnA` (isHost=true — host can answer questions)
  - Each **past hosted** card: same cover/header (no edit/cancel/chat/hub buttons), interested-list shows "✓ Attended"/"Did not attend" instead of Approve

### D. EVERY SECTION (on-screen order)
1. Shared Gatherings header + tab row
2. "Upcoming" hosted gatherings list (conditional)
3. "Past (N)" collapsible section (conditional), with sort toggle

### E. EVERY CARD / BUTTON / CTA
- Upcoming hosted card: title (tap → detail), 🤝 invite-friends icon, ✏️ Edit icon, "Cancel" text button, "💬 Group Chat" button, "🚀 Hub" button, per-interested-person "Approve" button, `GatheringQnA` host-answer controls
- Past hosted card: title (tap → detail), per-interested-person "✓ Attended"/"Did not attend" labels (non-interactive)
- "Past (N)" header (expand/collapse) + sort toggle

### F. WHAT HAPPENS WHEN EACH CTA IS TAPPED
- Card title → `navigation.navigate('GatheringDetail', {gatheringId: item.id})`
- 🤝 invite icon → opens `InviteFriendsModal` (state, `setInviteModalGathering(item)`)
- ✏️ Edit icon → `navigation.navigate('EditGathering', {gathering: item})`
- "Cancel" → `confirmCancelGathering(item)`: if recurring, 3-way Alert ("Keep It" / "Just This One" → `cancelGathering()` / "Stop The Whole Series" → `stopRecurringSeries()`); if not recurring, 2-way Alert ("Keep It" / "Cancel Gathering" → `cancelGathering()`)
- "💬 Group Chat" → `navigation.navigate('GatheringChat', {gatheringId, gatheringTitle})`
- "🚀 Hub" → `navigation.navigate('GatheringHub', {gatheringId})`
- Per-person "Approve" → `handleApprove(interest)` → `approveInterest(interest.id)`; Alert "Approved! A match was created" or "Gathering full... waitlist" if waitlisted; reloads
- Past-section header → toggles `hostingPastExpanded`
- Sort toggle → toggles `hostingPastSort`
- Map pin tap → `navigation.navigate('GatheringDetail', {gatheringId})`

### G. WHAT DATA IS SHOWN
- `hosting.upcoming` / `hosting.past` — `getMyGatherings()` (real service call: gatherings where `host_id`=me, split by `scheduled_at` vs now, each including `interested` array of `gathering_interest` rows with joined profile + status)
- Cover photos — same signed/curated logic as Attending
- Interested-list — real per-gathering `gathering_interest` rows (pending/approved/for past: attended vs not)

### H. CLASSIFICATION
- Upcoming hosted cards → commitments-upcoming-plans, creation (this is content the user authored)
- Edit / Cancel controls → creation, settings (management actions on own content)
- Group Chat / Hub buttons → messaging, commitments-upcoming-plans
- Interested-person Approve flow → REQUEST-handling (mirrors Activity tab's "Connection Requests" group — this is the same underlying pending-interest data, actionable here as well as in Inbox→Activity), social/connections
- Past hosted cards → activity (history)
- GatheringQnA (host mode) → messaging

**Cross-reference note:** The "Approve" action available here on each interested person duplicates the same underlying action available in Inbox → Activity tab's "🙋 Connection Requests" group (`getAllPendingRequests()` / `approveInterest()`) — both surfaces let a host approve the same pending `gathering_interest` rows, just scoped differently (Activity aggregates across all hosted gatherings; Hosting tab shows it per-gathering, card-by-card, alongside already-approved attendees).

---

## GATHERINGS SCREEN — NEARBY TAB (brief summary, per instructions)

The default landing tab of `GatheringsScreen.js`. It is a browse/discovery surface, not an attending/hosting surface: a searchable, filterable (Distance, When, Category incl. "⭐ For You" and "🔥 Trending"), map-or-list toggleable feed of all nearby gatherings (`getNearbyGatherings(radiusTier)` / `searchGatherings()`), each card showing host, cover photo, category, women-only/matches-interests/friends-interested badges, business-host badge, recurring badge, offer badge, an expandable "Details & questions" section with vibe info + public Q&A, an "I'm Interested" CTA (opens `GatheringIntentModal` → `expressInterest()`), and an optional "🤝 invite friends" icon. Classification: discovery, recommendations (For You/Trending), creation (via the "+ Start a [Category] Gathering" empty-state CTA and the header's "Host" button → `navigation.navigate('CreateGathering', ...)`).

---

## BUSINESS DASHBOARD (identification only, per instructions)

`BusinessDashboardScreen.js` (1226 lines) is a 5-section internal-tab dashboard (`SECTIONS`: 🏠 Dashboard, 🎉 Gatherings, 🏘️ Community, 📊 Insights, ⚙️ Business) for a user managing a `brand_partners` record (`getMyManagedPartner()`). It covers offers CRUD, business gatherings, community management, insights/analytics, and business-profile/address editing, plus partnership-request handling and a business-side messaging inbox. Its internals are not documented further per instructions — only its identity and entry points are captured below.

**Entry points found in `src/`:**
- `screens/ProfileScreen.js:544` — "🏪 Switch to Business" button (shown when `managesBusiness`)
- `screens/SettingsScreen.js:853` — "🏪 Manage Your Business" row (shown when `managesBusiness`)
- `screens/SettingsScreen.js:889` — "Business Dashboard (Admin)" row (admin-only, always visible to admins regardless of `managesBusiness`)
- `screens/CreateHubScreen.js:188` — a Business Dashboard entry point from the app's creation hub
- `services/notifications.js:134` — push-notification deep link (`navigationRef.navigate('BusinessDashboard')`)
- Registered in `RootNavigator.js:380` as a top-level `Stack.Screen` titled "Business Dashboard"

---

## BUSINESS MODE INTERSECTIONS (cross-screen summary)

**Profile:**
- "🏪 Switch to Business" button (visible when `managesBusiness` — i.e., `profiles.managed_partner_id` is set) → `navigation.navigate('BusinessDashboard')`
- "⏳ My Application (Pending)" / "📋 My Application" button (visible when not yet a managed partner but a request exists with status pending/denied, via `getMyBusinessPartnerRequest()`) → `navigation.navigate('MyBusinessApplication')`

**Settings:**
- Same three-way business row in the "Help & Legal" section: "🏪 Manage Your Business" (managesBusiness) / "⏳/📋 My Application" (pending/denied) / "Partner With Us" (else, → `navigation.navigate('BusinessPartnerApply')`)
- Admin-only "Business Dashboard (Admin)" row (always available to admins)
- Admin-only "Business Requests (Admin)" row → `navigation.navigate('AdminBusinessRequests')`

**Inbox (Activity tab):**
- "📣 Business update" feed item type — real rows from `getFollowedBusinessUpdates()`, rendered with a 📣 icon and `brand_partners.name: title` text, tappable → `navigation.navigate('BusinessProfile', {partnerId})`

**Gatherings / Gathering Detail:**
- **Community Perk card** (🎁, on Gathering Detail) — a `brand_partners`-linked offer (`getGatheringOffer()`), tappable brand name → `BusinessProfile`
- **`BusinessHostBadge`** component rendered on each Nearby-tab gathering card when `hosting_partner_id` is set (a business is the sponsoring/hosting partner for that gathering)
- **`GatheringOfferBadge`** component on Nearby-tab cards signaling an available brand offer tied to that gathering
- Host-only "🤝 Request a Business Partner →" link on Gathering Detail → `navigation.navigate('RequestBusinessPartner', {targetType:'gathering', targetId, targetTitle})`
- "🎁 N new offer(s) available" banner on both the Gatherings screen header and MatchesScreen (Messages tab) → `navigation.navigate('BrandOffers')` (offers are business-partner-issued)