# Product Overview — Nearby

_Compiled from direct codebase inspection (screens, navigation, schema, services) as of 2026-08-08. This document is analysis, not marketing copy — it describes what the code indicates the product is and is trying to become, not what any pitch deck claims._

## What the app does

Nearby is a mobile app (React Native / Expo, iOS + Android, Supabase backend) that blends three things that are usually separate products:

1. **A proximity-based dating app.** Users report coarse presence ("crossed paths" — server-computed, geohash-bucketed, never exact GPS shared to any client), send one-sided "notices" to people they've encountered, and get a real match when a notice is mutual. Swipe/browse discovery, compatibility scoring, chat, icebreakers, and relationship-maintenance tools (see below) all sit on top of this core.
2. **A local social/gathering platform.** Any user can host a "gathering" (coffee, dinner, a walk, sports, a game night, etc.), publish it with a visibility scope (everyone / friends / a specific community / invite-only), and other users join — either auto-approved or host-approved, with an optional capacity + waitlist. A parallel "communities" feature lets users form or join standing topic-based groups (not gatherings) with their own membership, roles (creator/leader/member), chat, and calendar of upcoming gatherings.
3. **A local-business partner network.** Businesses ("brand partners") can be linked to a Nearby account, run limited-quantity discount offers ("perks"), sponsor/host gatherings and communities, and get an analytics dashboard (followers, redemptions, growth, attendee breakdown, top-member leaderboard). A billing layer computes what each business owes Nearby (per-redemption / flat-monthly / hybrid contracts) on a monthly cron job — but no payment processor is wired up, so nothing actually charges yet.

On top of all three, the app carries a large, mostly-separate layer of **relationship-maintenance tools** for people already matched/dating on the app: a shared Memory Vault per match, a Chemistry Diary, Shared Decisions, Shared Playlist, Trip Planning, a Relationship Constitution, an Emergency Kit, a "Stress Test" (what-if scenario planning), a Rehearsal Room (practice difficult conversations), a Timeline Planner, and a Goodbye Archive / Relationship Legacy pair for reflecting on or closing out a relationship. These are not documented anywhere in the project's own running build notes (`CLAUDE.md`) — they predate the currently-tracked work — and this audit package treats them as first-class product surface that needs the same scrutiny as anything else.

## Who the target users are

Inferred from the actual feature set, not stated anywhere explicitly in the code:

- **Consumers**, specifically people using this in a fairly small geographic radius (the whole proximity/"crossed paths" mechanic, fuzzed coordinates, and 50-mile offer radius all imply a metro-area or city-scale product, not a global app). The product spans singles looking to date, and — via the gatherings/communities layer — people just looking to make friends or do things locally, not exclusively daters. The onboarding, discovery, and matching mechanics are dating-app-shaped; the gatherings/communities mechanics are meetup-app-shaped; the same account does both.
- **Local businesses** (cafes, restaurants, activity venues) that want foot traffic from a specific, opted-in local audience and are willing to run limited-quantity discounts and/or sponsor gatherings in exchange for exposure and (eventually) a fee.
- Implicitly, a **third population the product explicitly protects against surfacing to consumers**: businesses are never allowed to see individual attendee identity/location beyond what redemption and gathering-attendance data already exposes, and the "Community Perk" / gathering-linked offer model is the seam between the consumer and business sides.

## Core value proposition

For a consumer: *"Meet people and do things nearby, without broadcasting your exact location, and without dating being the only lens — the same app that finds you a date can also fill your Tuesday night."* The differentiator over a pure swipe app is the gatherings/communities layer; the differentiator over a pure meetup app is the proximity/dating mechanic and the relationship tools once something forms.

For a business: *"Get discovered by a real local audience already looking for things to do nearby, host or sponsor real gatherings, and get analytics on who's actually engaging with you — pay based on redemptions, not a flat ad buy."*

## The consumer experience

Five bottom tabs: **Home** (a daily-dashboard/digest), **Discover** (unified search/browse across gatherings, communities, places, and perks — deliberately excludes people, to avoid a stranger-search/stalking vector), **Create** (an icon-grid "what do you want to do today" entry point into gathering/community/business-partnership creation, with an AI-assisted free-text fallback), **Inbox** (messages, friend requests, gathering/community invites, activity), and **Profile** ("You" — identity, stats, achievements, and the jumping-off point for every relationship-tool and account-management screen).

Once matched or joined into a gathering, the experience shifts into a "Gathering Hub" (a live, day-of experience distinct from the pre-join "Gathering Detail" persuasion screen) and a chat/match surface layered with the relationship-maintenance tools described above.

## The business experience

A business owner (identified via `profiles.managed_partner_id`, not a separate account type) gets a "Switch to Business" entry point (from Profile or Settings) into a `BusinessDashboardScreen` with: aggregate stats and month-over-month growth, per-gathering attendee breakdown (new vs. returning), a "most engaged" member leaderboard with drill-in visit history and direct-message outreach, offer/perk creation (including group-unlock thresholds tied to a community's membership or a gathering's attendance), and a billing/insights view showing estimated amount owed under their contract. A separate, more structured path — `RequestBusinessPartnerScreen` — lets a gathering host or community leader propose a specific business as a sponsor/partner for their specific gathering or community, subject to that business's approval.

## The primary product flywheel

As best represented in the code (see `PRODUCT_FLYWHEEL.md` for the detailed trace): **Discover something nearby → join/attend → meet people → form connections (friends or a match) → host your own gathering or join/lead a community → invite the connections you've made → a business perk or sponsorship sweetens the gathering/community → return for the next one.** Momentum, Rewards, and Insights screens exist specifically to make the "return" loop legible to the user (streaks, tier badges, aggregate stats) without fabricating any signal the underlying data doesn't actually support.

## Major differentiators

- **Fuzzed-location-only privacy model, enforced at the schema level**, not just the UI — `profiles` has no lat/lng column at all; presence is bucketed server-side. This is a real, structural choice, not a policy statement, and it constrains several other features (no real "people" layer on the map, no true GPS-verified attendance).
- **Two distinct social containers (gatherings = one-off events, communities = standing groups)** with a shared visibility/discovery funnel and increasingly-shared mechanics (capacity/waitlist for gatherings, leader roles and calendars for communities).
- **A local-business layer with real redemption-based billing math**, not just a directory listing — offers have scarcity (redemption limits), targeting (interest tag, radius, and now group-unlock thresholds), and a monthly invoice-generation cron job, even though the actual money-movement (Stripe or similar) isn't built yet.
- **A large post-match relationship-tooling suite** (Memory Vault, Chemistry Diary, Shared Decisions, Trip Planning, Constitution, Emergency Kit, Stress Test, Rehearsal Room, Timeline Planner, Goodbye Archive/Legacy) that goes well past "match and chat" into ongoing relationship support — unusual scope for a dating app, and a large surface area to keep discoverable and coherent.

## What I believe the app is trying to become

Based on the shape and sequencing of what's been built (per the app's own iteration history in `CLAUDE.md`, and independently visible in how tightly gatherings/communities/business/AI-assist have all been elaborated recently relative to the dating core): **a local social operating system anchored in proximity, where dating is one entry point among several** (the others being "do something nearby tonight" and "find your people/community"), with a monetization layer built on local-business partnerships rather than (or in addition to) subscription revenue. The heavy investment in Discover-as-a-mini-app, Create-as-a-guided-flow, gatherings capacity/waitlist mechanics, and business CRM/billing infrastructure — relative to comparatively little recent investment in the core swipe/match mechanic itself — suggests the product's center of gravity has been actively shifting from "dating app" toward "proximity-based community and events platform with dating as one mode," even though the app's original bones (profiles, notices, matches) and its onboarding framing are still dating-app-first. Whether that shift is intentional strategy or organic feature accretion is not something the code can answer — flagged here as a real question for the product owner, not resolved by this audit.
