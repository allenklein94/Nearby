# Nearby — Current UI Map (2026-08-10)

**Purpose.** A precise, current-state inventory of the app's navigation and screen content, built
for a screen-by-screen "keep / move / remove / combine / rename" pass against a target
information architecture. **No application code was changed to produce this document** — it's a
read-only map, built by reading the current source directly (not inferred from `CLAUDE.md`'s own
history, which can be stale by the time a later pass touched a screen again).

**How to use it.** Part 3 is the reference — every registered route, bucketed against the target
IA below. Part 4 is the working document — every real section on each of the 6 primary screens,
in on-screen order, with a blank annotation column. Part 5 directly answers the six specific
complaints that prompted this map, with file:line citations, so "is this already fixed?" doesn't
have to be re-litigated from memory.

**Target IA** (as given):

| Tab | Question it answers |
|---|---|
| 🏠 Home | What's happening in my Nearby life? |
| 🔎 Discover | What can I find? |
| ➕ Create | What can I make happen? |
| 💬 Inbox | Who is talking to me / what needs my attention? |
| 👤 Profile | Who am I on Nearby? |
| ⚙️ Settings | How does Nearby work for me? |

---

## Part 1: Top-level structure

5 bottom tabs (`RootNavigator.js:246-250`, `MainTabs`): **Home**, **Discover**, **Create**,
**Matches** (tab label "Inbox"), **Profile** (tab label "You"). Settings is not a tab — it's a
top-level stack screen reached via a gear icon on Profile's header (`ProfileScreen.js:413`).

60 screens total are registered in the root `Stack.Navigator` (`RootNavigator.js`): 6
auth/onboarding-only screens (shown before `MainTabs` exists at all) + `MainTabs` itself + 54
further stack screens reachable once signed in, none of which are tabs — every one of them is
reached by tapping *into* something from a tab (or from another stack screen).

---

## Part 2: Six complaints — quick-reference status

(Full detail with citations in Part 5.)

| # | Complaint | Current actual status |
|---|---|---|
| 1 | Coffee/Breakfast/Meetup buttons should discover, not just create | **Still true.** Home's quick-action chips skip straight to `CreateGathering` — no "show existing Coffee gatherings first" step exists anywhere. |
| 2 | Quick actions should be personalized to user interests, not hardcoded categories | **Still true for the chip row itself** (hardcoded by time-of-day only). A genuinely personalized section *does* exist on Home, but it's a separate section ("Because You're Into..."), not the quick-action chips. |
| 3 | Morning/afternoon/evening should be interest-aware, not just clock-driven | **Still true.** `getTimePeriod()`/`getQuickPrompts()` are 100% clock-driven, zero interest input. |
| 4 | Weather message needs to show its reasoning, not just a conclusion | **Partially true.** The "☀️ Social Forecast" card does show a one-line qualitative reason ("Rain or storms expected..."). Home's separate one-line "insight" sentence (lower priority, only shown when other signals are absent) shows the conclusion only, no reasoning. Neither shows a number (no "70% chance"). |
| 5 | Upcoming/attending gatherings belong on Home | **Already built, and prominently.** The single soonest upcoming commitment is the very first content section on Home (the "Your Next Thing" hero, right after the greeting). Additional upcoming plans beyond the first one are pushed down near the bottom, below all recommendation content. |
| 7 | Group chat shouldn't read as a generic Inbox message row | **Already matches the target model.** Group chats are a distinct chip row inside Inbox's Messages tab (opens the chat screen directly), separate from the Activity tab's invitation/request rows. |

---

## Part 3: Full route inventory, bucketed against the target IA

"Primary entry point(s)" lists where a user actually reaches this screen from today — not every
possible caller, the realistic ones. Screens with no tab bucket are cross-cutting (reached from
multiple tabs) or admin-only.

### 🏠 Home
| Route | Primary entry point(s) |
|---|---|
| `Home` (tab) | Bottom tab bar |

### 🔎 Discover
| Route | Primary entry point(s) |
|---|---|
| `Discover` (tab) | Bottom tab bar |
| `AIConcierge` | Discover's "✨ Ask AI Concierge" row |
| `Places` | Discover "See all in Places" |
| `Nearby` (DiscoveryScreen — people swipe) | Discover "Meet People" card; Home quick-stats "people nearby" |
| `Gatherings` (list) | Discover quick-time cards, "See all", Home multiple rows |
| `Communities` (list) | Discover "See all in Communities"; Profile quick-stat |
| `BrandOffers` (Perks) | Discover "See all in Perks"; Home perks banner; Matches new-offer banner; Settings Account & Billing |

### ➕ Create
| Route | Primary entry point(s) |
|---|---|
| `Create` (tab) | Bottom tab bar |
| `CreateGathering` | Create's icon grid / "Something Else" box; Home quick-action chips; `StartSomethingModal` (Home FAB) |
| `SelectGatheringLocation` | Sub-step inside `CreateGathering`'s Where step |
| `GatheringConfirmation` | Auto-navigated to right after a successful `CreateGathering` publish |
| `CreateCommunity` | Create's secondary row; "Start a Community from This Gathering" (GatheringDetail host banner) |
| `RequestBusinessPartner` | Create "Something Else" (business_partner intent); GatheringDetail/CommunityDetail host/leader link |
| `BusinessPartnerApply` | Settings "Partner With Us" fallback row (no other path in) |
| `MyBusinessApplication` | Profile/Settings conditional row (pending/denied application) |
| `BusinessDashboard` | Create secondary row (if managing a business); Profile "Switch to Business"; Settings "Manage Your Business" / admin row |
| `QuickFilterCustomize` | `Gatherings` screen's filter customization |

### 💬 Inbox
| Route | Primary entry point(s) |
|---|---|
| `Matches` (tab, label "Inbox") | Bottom tab bar — renders `InboxScreen`, which toggles between embedded `MatchesScreen` (Messages) and embedded `ActivityScreen` (Activity) |
| `Chat` | Tapping a match row in Messages tab |
| `GatheringChat` | Messages tab's Group Chats chip row; GatheringDetail/GatheringHub |
| `CommunityChat` | Messages tab's Group Chats chip row; CommunityDetail |
| `BusinessConversation` | BusinessProfile "Message"; BusinessDashboard conversation drill-in |
| `Notices` (standalone, renders `ActivityScreen`) | Activity bell icon elsewhere in the app; cold-start push-tap routing (**not** reached from the Inbox tab itself, which embeds `ActivityScreen` directly rather than navigating to this route) |
| `Friends` | Inbox header "🤝 Friends" pill; Home quick-stats; Profile quick-stat; Settings Connect |

### 👤 Profile
| Route | Primary entry point(s) |
|---|---|
| `Profile` (tab, label "You") | Bottom tab bar |
| `Timeline` | Profile quick-link |
| `MemoryVaultIndex` | Profile quick-link |
| `MemoryVault` (per-match) | `MemoryVaultIndex` list; ChatScreen "Together" menu |
| `Insights` | Profile quick-link |
| `Momentum` | Profile quick-link |
| `Rewards` | Profile quick-link |
| `Billing` | Profile quick-link; Settings "Manage Subscription" |
| `EmergencyContacts` | Profile quick-link; Settings Safety |
| `ViewProfile` (other people) | Cross-cutting — Home crossed-paths tile, Activity notice/sighting rows, Matches avatar tap, GatheringHub "Who You'll Meet", etc. |

### ⚙️ Settings
| Route | Primary entry point(s) |
|---|---|
| `Settings` | Profile header gear icon (only entry point) |
| `Legal` | Settings Help & Legal |
| `FeaturesOverview` | Settings Help & Legal |
| `MusicMode` | Settings Connect |
| `InviteFriends` (app referral code) | Settings Connect |
| `BlockedUsers` | Settings Safety |
| `IdVerification` | Settings Safety |
| `RelationshipHub` | Settings Safety section's "❤️ Relationship" row |
| `RelationshipTools`, `SharedPlaylist`, `TripPlanning`, `SharedDecisions`, `RelationshipLegacy`, `RelationshipConstitution`, `StressTest`, `TimelinePlanner` (match-scoped tools) | `RelationshipHub` → "With Someone" section |
| `LegacyLibrary`, `GoodbyeArchiveList`, `GoodbyeArchiveEntry`, `RelationshipEmergencyKit`, `RehearsalRoom`, `ChemistryDiaryList`, `ChemistryDiaryEntry` (personal tools) | `RelationshipHub` → "On Your Own" section (Chemistry Diary also reachable from ChatScreen and ViewProfileScreen directly) |
| `AdminReports`, `AdminBusinessRequests`, `AdminVerification` | Settings Help & Legal, admin-only rows |
| `BusinessAIAssistant` | `BusinessDashboard` Insights tab |

### Cross-cutting (reached from 3+ tabs, no single home)
| Route | Notes |
|---|---|
| `GatheringDetail` | The single most-referenced screen in the app — reached from Home (hero, best pick, because-you-like), Discover (search/recommended/trending/map), Create (post-publish share), Inbox (invite-accept), Activity groups, deep link (`nearby://gathering/:id`) |
| `GatheringHub` | Post-join live experience — reached after joining a public gathering from `GatheringDetail`; from `Gatherings` attending/hosting tabs |
| `CommunityDetail` | Discover, Home "Continue Your Communities", Communities list |
| `BusinessProfile` | Discover map, BrandOffers partner name, GatheringDetail perk card, Activity business-update rows |
| `Paywall` | Any premium-gated action across the app (modal presentation) |
| `Onboarding`, `OnboardingQuestions`, `OnboardingLocation`, `Login`, `CompleteProfile`, `OnboardingRecommendations` | Pre-auth / first-run only, not reachable once a profile is complete |

---

## Part 4: Screen-by-screen section inventory (annotate here)

Each row below is a real, currently-rendered section, in actual on-screen order. `Navigates to`
is the exact route/modal a tap opens. **Annotation** is blank — this is the working column for
keep / move / remove / combine / rename.

### 🏠 HOME (`HomeScreen.js`)

| # | Section | Renders when | Shows | Navigates to | Annotation |
|---|---|---|---|---|---|
| 1 | Greeting header | Always | "{Good morning/afternoon/evening}, {name} 👋" + static subtitle | — | |
| 2 | **"Your Next Thing" hero card** | `upcomingPlans[0]` exists (a real hosting/attending commitment) | Category icon, hosting/going label, title, calendar-relative date/time, attendee count | `GatheringDetail` | |
| 3 | Opportunity line | `gatheringsTodayCount > 0` | "You have N great opportunities {today/tonight/this weekend}" | — | |
| 4 | Insight line | `getHomeInsight()` returns non-null (priority: friends'-activity → best-pick → weather → happening-now) | One sentence, conclusion only, no reasoning shown | — | |
| 5a | Pending invites banner | `pendingInvitesCount > 0` | "🤝 N pending invite(s) & request(s)" | `Matches` (`initialSection: 'invitations'`) | |
| 5b | Perks banner | `perksCount > 0` | "🎁 N perk(s) unlocked nearby" | `BrandOffers` | |
| 5c | Since-you-were-away banner | Real new-people/new-gatherings count since last visit | New people/gatherings counts | — | |
| 6 | Time-period section header | Always | "Good Morning" / "This Afternoon" / "Tonight" / "This Weekend" | — | |
| 7 | **Quick-action chips** | Always | Hardcoded, clock-only categories (see Part 5, item 1-3) | `CreateGathering` (skips straight to creation) or `StartSomethingModal` | |
| 8 | "🔥 Happening Now" | `happeningNow.length > 0` | Gatherings starting within 30min / started ≤2h ago | `Gatherings` (list, not the specific gathering) | |
| 9 | "☀️ Social Forecast" card | Location permission granted | Real weather-derived label + one-line qualitative reason | — | |
| 10 | "🏘️ Continue Your Communities" | Up to 3 joined communities with recent activity | Name + recent message count | `CommunityDetail` | |
| 11 | Quick-stats card row | Always | People nearby / gatherings today / crossed paths / unread messages / friends | `Nearby` / `Gatherings` / `ViewProfile` / `Matches` / `Friends` | |
| 12a | "⭐ Best Pick Tonight" (under "✨ Recommended For You") | Single gathering scores ≥5 on real fit signals | Title + real reasons | `GatheringDetail` | |
| 12b | "💡 Because You're Into {categories}" | Real category history + a matching nearby gathering | Genuinely personalized list, driven by caller's own top-3 attended categories | `GatheringDetail` | |
| 12c | "🔥 Trending Near You" | Top 3 nearby by attendee count | — | `Gatherings` (list) | |
| 12d | "👥 Friends' Activity" | A friend created a gathering in the last 3 days | — | `Gatherings` (list) | |
| 13 | "📅 Also Coming Up" | More than 1 real upcoming plan (shows all but the first) | Title, hosting/attending, date | `Gatherings` (list, not the specific gathering) | |
| 14 | "This Week" recap card | Real attended/new-friend counts this week > 0 | — | — | |
| 15 | "Quiet night nearby" card | No best pick, no trending, 0 people nearby | Static reassurance | — | |
| 16 | "Continue Browsing →" | Always | — | `Discover` | |
| 17 | FAB "+ Start Something" | Always, fixed position | Opens `StartSomethingModal` | modal | |

### 🔎 DISCOVER (`DiscoverHubScreen.js`)

| # | Section | Renders when | Shows | Navigates to | Annotation |
|---|---|---|---|---|---|
| 1 | Title/subtitle | Always | "Discover" / "What are you looking for?" | — | |
| 2 | Search bar | Always | Unified text search (gatherings/communities/places/perks) | — | |
| 3 | "✨ Ask AI Concierge what to do" | Always | — | `AIConcierge` | |
| 4 | Type filter chips | Always | All / Gatherings / Communities / Places / Perks | sets local filter | |
| 5 | List/Map toggle | Filter is All/Gatherings/Perks | — | toggles view | |
| 6 | Places sub-category chips | Filter = Places | Coffee/Restaurants/Parks/Hubs | sets local filter | |
| — | **Map mode** (replaces list below) | Toggle active | `GatheringsMapView` — gathering/deal/business pins | `GatheringDetail` / `BrandOffers` / `BusinessProfile` | |
| 7 | "Meet People" card | Filter = All | — | `Nearby` | |
| 8 | "🌙 Tonight" / "📅 This Weekend" cards | Filter = All | — | `Gatherings` (`initialDateFilter`) | |
| 9 | "Recommended For You" | Not searching, filter All/Gatherings, real fit score ≥5 | Cover photo/icon, title, real reasons | `GatheringDetail` | |
| 10 | "🔥 Trending Near You" | Same gating, top 3 by attendee count | — | `GatheringDetail` | |
| 11 | "Gatherings" section | Filter All/Gatherings | Search results or nearby browse, capped to 3 in "All" | `GatheringDetail`; "See all" → `Gatherings` | |
| 12 | "Communities" section | Filter All/Communities | Same 3-state pattern | `CommunityDetail`; "See all" → `Communities` | |
| 13 | "Places" section | Filter All/Places | Google Places nearby-search results | External Google Maps URL (not in-app); "See all" → `Places` | |
| 14 | "Perks" section | Filter All/Perks | Same 3-state pattern | `BrandOffers` | |
| 15 | "Gathering Memories" | Filter All, real stories exist | — | In-page story-viewer modal | |
| 16 | "Public Stories Near You" | Filter All, real stories exist | Avatar rings | In-page story-viewer modal | |

### ➕ CREATE (`CreateHubScreen.js`)

| # | Section | Renders when | Shows | Navigates to | Annotation |
|---|---|---|---|---|---|
| 1 | Title/subtitle | Always | "Create" / "What do you want to do?" | — | |
| 2 | Primary icon grid | Default state | 7 fixed tiles (Coffee/Dinner/Walk/Sports/Games/Music/Volunteer) + "Something Else" | Direct tap → `CreateGathering` (`fromQuickPick: true`, skips wizard's What step); Dinner → sub-grid first | |
| 3 | "Something Else" NL box | User tapped that tile | Free-text input → `classifyCreateRequest()` | `CreateGathering` / `CreateCommunity` / `RequestBusinessPartner` depending on classified intent | |
| 4 | Secondary row "Want to build something bigger?" | Top-level grid state only | Two links | `CreateCommunity`; `BusinessDashboard` (if managing) or `RequestBusinessPartner` | |

### 💬 INBOX (`InboxScreen.js` — Messages/Activity toggle)

| # | Section | Renders when | Shows | Navigates to | Annotation |
|---|---|---|---|---|---|
| 1 | Header "Inbox" + subtitle | Always | — | — | |
| 2 | "🤝 Friends" pill | Always | — | `Friends` | |
| 3 | Messages / Activity toggle | Always | 2 segmented buttons, Activity shows a live pending-count badge | Local state only | |
| 4 | **Group Chats chip row** | Messages tab, ≥1 real gathering/community chat | Icon + title per chip | `GatheringChat` / `CommunityChat` **directly** | |
| 5 | Matches list (Messages tab body) | Messages tab | Real match rows, avatar/name/last-activity, optional compat badge | `Chat`; avatar → `ViewProfile` | |
| 6a | "🙋 Connection Requests" (Activity tab) | ≥1 pending join request for a gathering the caller hosts | Inline **Approve** action | stays on screen | |
| 6b | "🤝 Invitations" (Activity tab) | ≥1 pending friend request or social invite | Inline Accept (+ Decline for invites) | stays on screen, or `GatheringDetail`/`CommunityDetail` on accept | |
| 6c | "⏰ Upcoming" (Activity tab) | ≥1 gathering starting within 24h | Display only | — | |
| 7 | Chronological notices feed (Activity tab body) | Always, below the 3 groups | Waves/notices, crossed-paths, business updates | `ViewProfile` / `Paywall` / `BusinessProfile` | |

### 👤 PROFILE (`ProfileScreen.js`)

| # | Section | Renders when | Shows | Navigates to | Annotation |
|---|---|---|---|---|---|
| 1 | Header + ⚙️ gear | Always | "Profile" title | gear → `Settings` | |
| 2 | Quick-stats row | Always | Communities / Friends / Upcoming / Past | `Communities` / `Friends` / `Gatherings` / `Gatherings` | |
| 3 | Quick-link rows | Always, each independently | Timeline, Memory Vault, Insights, Momentum, Rewards, Billing, Emergency Contacts | `Timeline` / `MemoryVaultIndex` / `Insights` / `Momentum` / `Rewards` / `Billing` / `EmergencyContacts` | |
| 4 | Earned-stats row | Real favorite vibe / usual-activity signal exists | Display only | — | |
| 5 | Achievements grid | ≥1 earned achievement | Display only | — | |
| 6 | Business/application row | 2-way: manages a business, or has a pending/denied application; **no row at all if neither** | "Switch to Business" or "My Application" | `BusinessDashboard` / `MyBusinessApplication` | |
| 7–20 | Photo gallery, bio/name form, prompts, connection-goal chips, About You, Details/Basics accordions, Interests, AI Strengths generator, Save | Always (form/editor content) | — | Mostly in-place edits; Strengths → `Paywall` if not premium | |

### ⚙️ SETTINGS (`SettingsScreen.js`)

| Section header | Rows | Annotation |
|---|---|---|
| (top) | Notifications-off OS-permission banner (conditional) | |
| Looking For | Intention chips | |
| Appearance | Dark Mode switch, Nearby Display Style (List/Cards) | |
| Language | 11 language chips | |
| Notifications | New Matches / Messages / Waves switches | |
| Privacy | Read Receipts, "I Message First" switches | |
| Discovery Preferences | Show Me, age range, My Gender, Hide Gender, My Ethnicity, Hide Ethnicity, Ethnicity Preferences, Save | |
| Account | Phone-number change flow (in-place) | |
| Connect | 🤝 Friends → `Friends`; 🎵 Music Mode → `MusicMode`; 🎁 Invite Friends → `InviteFriends` | |
| Safety | 🚫 Blocked Users → `BlockedUsers`; ✓ Verify Identity → `IdVerification`; 🛡️ Emergency Contacts → `EmergencyContacts`; ❤️ Relationship → `RelationshipHub` | |
| Account & Billing | 💳 Manage Subscription → `Billing`; 🎁 Offers & Perks → `BrandOffers` | |
| Help & Legal | ✨ Everything In Nearby → `FeaturesOverview`; Legal → `Legal`; business row (3-way, see Part 5); admin-only rows (Reports/Business Requests/Verifications/Business Dashboard); Request My Data; Sign Out; Delete Account | |

---

## Part 5: The six complaints — full current-behavior answers

**1. "Coffee / Breakfast / Meetup buttons" should discover, not just create.**
Confirmed still true. Home's quick-action row (`HomeScreen.js:217-232`, items from
`getQuickPrompts(period)` in `src/utils/timeContext.js:17-42`) sends a tap straight into
`navigation.navigate('CreateGathering', { quickStartTitle, quickStartCategory })` —
there is no intermediate "here are nearby Coffee gatherings, [Join] / + Start One" step anywhere
in this flow. `CreateHubScreen.js`'s own icon grid behaves identically (`fromQuickPick: true`,
same direct-to-creation navigation).

**2. Quick actions should be personalized, not hardcoded categories.**
Confirmed: the quick-action chip row itself is 100% hardcoded by time-of-day bucket only — see
item 3 below for the literal arrays. A real, genuinely personalized section does exist on Home
("💡 Because You're Into {categories}", driven by the caller's own top-3 most-attended past
categories via `getMyTopGatheringCategories()`) — but it's a separate section further down the
page, shows existing gatherings (not a create shortcut), and doesn't replace or inform the
quick-action chips in any way.

**3. Morning/afternoon/evening should be interest-aware, not just clock-driven.**
Confirmed still true, and fully static. From `src/utils/timeContext.js`:
- `getTimePeriod()` is pure `Date().getHours()` + weekend check — no user data read at all.
- `getQuickPrompts(period)` returns one of 4 fixed arrays: morning → Coffee/Morning Run/
  Breakfast Meetup; afternoon → Lunch/Volunteering/Reading; evening → Dinner/Concert/Walk;
  weekend → Beach Volleyball/Beach Cleanup/Wine Tasting. Same 4 arrays for every user, every day.

**4. Weather message needs to show its reasoning.**
Two separate surfaces, different fidelity:
- The "☀️ Social Forecast" card (`HomeScreen.js:258-264`) **does** show a real one-line reason
  underneath the headline label — e.g. "Rain or storms expected — a better night for something
  indoors." (bucketed from a real OpenWeatherMap call, condition code + temperature). This is
  qualitative, not quantified — no percentage or specific time is shown anywhere.
- The separate, lower-priority "insight" sentence (`getHomeInsight()`,
  `services/homeDashboard.js:499-515`) is conclusion-only when it falls back to the weather
  branch — "Looks like a perfect evening for something outdoors," with zero reasoning shown, and
  only surfaces when no stronger signal (friends' activity, best pick) is available.
So: the standalone weather card already explains itself; the incidental one-line insight
sentence (a different, lower-visibility surface) does not.

**5. Upcoming/attending gatherings belong on Home.**
Already built, and already prominent — this is likely the one item most out of date relative to
the user's current impression. The single soonest real commitment (hosting or attending) renders
as the **first content section on the whole screen** ("Your Next Thing" hero,
`HomeScreen.js:143-163`), immediately after the greeting. Anything *beyond* the first upcoming
plan is real but pushed down: "📅 Also Coming Up" (`HomeScreen.js:413-429`) renders near the
bottom, below the entire "Recommended For You" block, and links to the generic `Gatherings` list
rather than the specific gathering.

**7. Group chat shouldn't read like a generic Inbox message row.**
Already matches the target model described. Group chats (gathering + community) render as a
distinct horizontal chip row inside Inbox's **Messages** tab (`InboxScreen.js:122-147`), visually
and structurally separate from the 1:1 match list below it, and tapping one opens the chat screen
directly (`GatheringChat`/`CommunityChat`) rather than landing on a generic conversation-list row.
Invitations to gatherings/communities are a separate, correctly-distinct thing — they live in the
**Activity** tab's "🤝 Invitations" group, not mixed into Messages at all. This is exactly the
Home/Messages/Activity separation described in the target framework.

---

## Not covered in this pass

Per explicit instruction, no application code was changed to produce this map, and the deeper
per-screen content (e.g. every section inside `GatheringDetailScreen.js`, `CommunityDetailScreen.js`,
`BusinessDashboardScreen.js`, or the 20+ relationship-tool screens under the new `RelationshipHub`)
was intentionally left out of Part 4's detailed tables — those are cross-cutting/deep-link screens,
not one of the 6 primary tab surfaces, and Part 3's route table already places each of them in the
IA bucket they're actually reached from. If the screen-by-screen review needs one of those expanded
to the same section-by-section detail as Part 4, that's a fast, scoped follow-up, not a rebuild of
this document.
