# Home Visual Hierarchy Audit — Aug 14 2026

Read-only, per direct instruction: no code changed to produce this. Scope, exactly as given:
"Identify the current vertical order, approximate visual prominence, card sizes, spacing,
headings, and CTA density of every Home section. Determine whether the new intent box is
visually dominant, whether Your Plans is clearly the secondary priority, and which lower
sections compete most strongly for attention. Recommend only hierarchy/spacing/visual-weight
changes; do not recommend removing existing sections yet."

Source: `src/screens/HomeScreen.js` (full file read, JSX + styles) and `src/theme.js` (real
color/spacing/typography/shadow values), both read directly, not inferred from memory.

## Context this audit is scored against

The user's own locked target hierarchy (given directly, not to be re-litigated):

```
HERO         What do you want to do?        (intent box)
PRIMARY      Your Plans
CONTEXT      Happening Near You / Your Communities
PERSONALIZATION   Because You Like… / Weekly Recap
EXPLORE      Browse
```

Explicit constraints: no section removed, Your Plans stays immediately below the intent box,
no new tab, no second AI entry point, Discover/business engine untouched. This audit only
checks whether the *visual* hierarchy already matches that model — it does not propose
removing anything.

## 1. Real vertical order (top to bottom, every block)

| # | Block | Conditional? |
|---|---|---|
| 1 | Greeting + period subtitle | Always |
| 2 | **Intent box** ("What do you want to do?") | Always |
| 3 | Insight line (one sentence, primary-colored text) | Conditional (real signal only) |
| 4 | Banner cluster: pending-invites banner → perks banner → weather/forecast card (+ indoor-suggestions sub-list) → since-you-were-away banner | Conditional per-banner, cluster wrapper conditional |
| 5 | **Your Plans** (Going / Hosting sub-groups) + "See All Plans →" | Conditional (only if plans exist) |
| 6 | Quick Picks header + horizontal chip row | Always |
| 7 | Happening Near You (chip row) | Conditional |
| 8 | Your Communities (cards) | Conditional |
| 9 | Quick-stats card (people nearby / gatherings today / crossed paths / unread / friends) | Always (5 static rows, no empty state) |
| 10 | Because You Like… cluster (Because You're Into / Best Pick / Trending / Friends' Activity) | Conditional, sub-parts independently conditional |
| 11 | Weekly Recap → "View Momentum" | Conditional |
| 12 | Quiet-night fallback | Conditional (mutually exclusive-ish with #10) |
| 13 | Continue Browsing button | Always |
| 14 | FAB "+ Start Something" (floating, persistent, not part of scroll order) | Always |

**Finding A — real, measurable, ordering-level conflict with the target model**: the banner
cluster (#4 — up to 4 stacked cards: pending invites, perks, weather, since-away) sits
*between* the intent box and Your Plans. A user who has any pending invite, any perk, a
readable weather signal, and any since-away activity scrolls past **4 full-width cards** before
reaching Your Plans at all. The target model says Your Plans should be the thing immediately
after the intent box ("What do you want to do? / What are you already doing?" as a paired
one-two) — today, up to 4 unrelated banners physically sit between that pair.

## 2. Visual prominence, by actual style values (not by section name)

Real style tokens from `theme.js`, applied per block:

| Block | Background | Border | Corner radius | Padding | Heading typography | Shadow |
|---|---|---|---|---|---|---|
| **Intent box** | `colors.surface` (plain white/dark) | `colors.border` 1px (neutral gray) | `radius.lg` (20) | `spacing.md` (12) | `typography.headline` (20/700) | none |
| Pending-invites banner | `colors.primaryMuted` (colored tint) | `colors.primary` 1px | `radius.lg` | `spacing.md` | 13px/700, `colors.primary` | none |
| Perks banner | `colors.primaryMuted` | `colors.primary` 1px | `radius.lg` | `spacing.md` | 13px/700, `colors.primary` | none |
| Weather card | `colors.surface` | `colors.border` (neutral) | `radius.lg` | `spacing.md` | `typography.headline` (forecastValue) | none |
| Since-away banner | `colors.surfaceElevated` | none | `radius.md` (14) | `spacing.md` | 12px/700 uppercase | none |
| **Your Plans card** | `colors.surface` | `colors.border` (neutral) | `radius.lg` | `spacing.md` | `sectionHeader`: 13px caption, uppercase, `textTertiary` (lightest text color on the page) | none |
| Quick Picks header | — | — | — | — | Same `sectionHeader` style as Your Plans — **identical weight** | — |
| Happening Near You header | — | — | — | — | `sectionHeaderText`: same caption/uppercase/`textTertiary`, just with a 14px icon prefixed | — |
| Your Communities header | — | — | — | — | 11px uppercase `textTertiary` — **smaller than every other header on the page** | — |
| Quick-stats card | `colors.surface` | `colors.border` | `radius.lg` | — (per-row `spacing.md`) | **No header/label at all** | none |
| Because You Like… header | — | — | — | — | Same `sectionHeaderText` as Happening Near You — identical weight | — |
| **Best Pick card** | `colors.primaryMuted` (colored tint) | `colors.primary` **1.5px** (thickest border on the screen) | `radius.lg` | `spacing.lg` (18 — largest padding on the screen) | `typography.headline` (20/700 — same size as the intent box's own heading) | none |
| Weekly Recap | `colors.surfaceElevated` | none | `radius.md` | `spacing.md` | plain 13px body text | none |
| FAB | `colors.primary` (solid, opaque) | none | `radius.full` | `spacing.md`/`spacing.lg` | white text, 15px/700 | **`shadow.button` — the only shadow anywhere on this screen** |

**Finding B — the intent box has the least visually distinctive card styling of any card-styled
element below it.** Plain `colors.surface` + plain `colors.border` (a neutral 1px gray/dark
line) is the exact same treatment used by the Quick-stats card, `trendingCard`, and
`continueCommunityCard` — ordinary content cards, not a hero. Meanwhile **three separate
elements below the intent box use a strictly louder treatment** (`primaryMuted` colored
background + `colors.primary` border): the pending-invites banner, the perks banner, and the
Best Pick card. The Best Pick card in particular matches the intent box's own heading size
(`typography.headline`) while using a thicker border (1.5px vs. the intent box's 1px) and the
single largest padding value on the page. Nothing about the intent box's own styling
distinguishes it as the screen's hero.

**Finding C — Your Plans has no visual elevation over Quick Picks/Happening Near You,
contradicting the target "primary vs. context" split.** "Your Plans" and "Quick Picks" render
their headers with the byte-identical `sectionHeader` style (13px caption, uppercase,
`textTertiary` — the *lightest*, lowest-contrast text color in the palette). "Happening Near
You" and "Because You Like…" use a near-identical `sectionHeaderText` style (same size/color,
just with a small icon prefixed). There is currently no style-level distinction anywhere on
this screen between a "primary" heading and a "context" heading — every section header on Home
uses the same muted, uppercase, tertiary-colored caption treatment regardless of the tier the
target model assigns it.

**Finding D — Your Communities' header is the smallest text on the entire screen** (11px,
`continueCommunityLabel`) — smaller than every other section header (13px) despite sitting at
the same "context" tier as Happening Near You (which uses 13px). This looks like drift, not a
deliberate demotion.

## 3. CTA density per section (real tap targets, not counting `TouchableOpacity` wrappers that
never render, e.g. an empty list)

| Section | Typical real CTA count |
|---|---|
| Intent box | 1 (Find it) + 1 text field |
| Banner cluster | Up to 2 full-row taps (invites, perks) + N indoor-suggestion rows inside the weather card; since-away banner is not tappable at all |
| Your Plans | Up to 4 gathering rows (2 Going + 2 Hosting, each capped) + "See All Plans" |
| Quick Picks | Up to 5 chips + Edit link |
| Happening Near You | N chips (unbounded by any visible cap in this file) |
| Your Communities | N community cards (unbounded) |
| Quick-stats card | 5 fixed rows, always tappable |
| Because You Like… | Up to 6 (Because You're Into) + 1 (Best Pick) + N (Trending) + N (Friends' Activity) — the single densest cluster on the page |
| Weekly Recap | 1 |
| Continue Browsing | 1 |

**Finding E**: CTA density does not track the target tiers either. "Because You Like…" (tier
4, "personalization") is the single highest-density cluster on the whole screen — routinely
more tappable rows than Your Plans (tier 2, meant to read as primary). Nothing about density
signals "this is secondary/optional" vs. "this matters."

## 4. Direct answers to the three questions asked

**Is the intent box visually dominant?** No. It uses the plainest card treatment on the screen
(neutral surface + neutral border), the same weight as ordinary content cards further down, and
several *lower*-tier elements (pending-invites banner, perks banner, Best Pick) are styled
*louder* than it is.

**Is Your Plans clearly the secondary priority?** No, not visually — its header style is
pixel-identical to Quick Picks' header style, and its card styling is identical to several
lower-tier cards. Its *position* is correct relative to most content, but the banner cluster
(Finding A) currently sits between it and the intent box, breaking the "hero, then primary"
adjacency the target model calls for.

**Which lower sections compete most strongly for attention?**
1. **Best Pick card** (tier 4, "personalization") — the loudest-styled card on the entire
   screen by every measured axis (color, border weight, padding, heading size).
2. **Pending-invites / perks banners** — colored, bordered, positioned *before* Your Plans in
   scroll order despite not mapping to any of the 4 target tiers.
3. **Weather card** — uses the same heading-level typography as the intent box's own heading.
4. **Quick-stats card** — has no label/header at all, so it doesn't visually announce itself as
   lower-priority utility content the way every other section's (admittedly uniform) caption
   header at least gestures toward.

## 5. Recommendations — hierarchy/spacing/visual-weight only, nothing removed or reordered
   across sections that aren't already adjacent to a real ordering conflict

Per the explicit instruction, these are recommendations only — not built, not to be built
without a separate go-ahead:

1. **Give the intent box a real hero treatment.** Distinguish it from ordinary content cards —
   e.g. a filled/colored surface (matching the weight `primaryMuted` + `colors.primary` border
   already establishes elsewhere on this exact screen, so it'd be visually consistent, not a
   new color introduced), or the same shadow treatment currently reserved for the FAB
   (`shadow.button`/`shadow.card`), or simply a larger heading (`typography.title`, matching the
   greeting above it, instead of the lower-weight `typography.headline` it uses today).
2. **Resolve Finding A — move the banner cluster to after Your Plans, or visually shrink it.**
   Two independent options, either closes the "4 cards between hero and primary" gap without
   removing any banner: (a) reorder the banner cluster to render after Your Plans instead of
   before it, preserving the hero→primary adjacency the target model calls for while keeping
   every banner exactly as-is; or (b) leave the order but shrink the cluster's visual footprint
   (smaller padding, no border, a single-line collapsed-by-default treatment) so it reads as a
   quick aside rather than 4 full-weight cards standing between hero and primary.
3. **Give Your Plans a heavier header than Quick Picks/Happening Near You/Because You Like…**
   — introduce one real "primary" heading style, distinct from the existing uniform
   `sectionHeader`/`sectionHeaderText` caption treatment every other section uses, and apply it
   only to "Your Plans" — makes the primary/context split from the target model visually real
   instead of implied only by position.
4. **Dial down the Best Pick card specifically**, since it's the one clear case of a
   "personalization"-tier element outstyling both the hero and the primary section — either
   reduce its border weight/padding to match ordinary `trendingCard` styling (letting its
   *content*, not its *chrome*, carry the "this is a strong recommendation" signal), or keep its
   current treatment but only once Your Plans/the intent box are each given something visually
   heavier still, so the ordering (hero > primary > personalization) holds at every tier.
5. **Give the Quick-stats card a real (even minimal) label**, matching the caption style every
   other section uses, so it doesn't read as unexplained dense content — smallest, lowest-risk
   fix in this list.
6. **Fix Your Communities' 11px header** to match the 13px caption size used by its own tier
   siblings (Happening Near You) — a one-line, no-judgment-call correction, not a design
   decision.

Ranked by leverage-to-risk: #2 (the banner-cluster ordering conflict) and #1 (a real hero
treatment for the intent box) are the two changes that most directly address what the user
asked to fix; #3 gives "primary" real visual meaning; #4-6 are smaller polish once the first
three land.

**Not done**: no code changed to produce this audit, per the explicit instruction. Waiting on a
go-ahead before building any of the 6 recommendations above.

**Update, Aug 14 2026, same day**: recommendations #1 and #2 were explicitly approved and built
that same day (see CLAUDE.md's own "Aug 15 2026 — Phase D..." section and the earlier Home
hierarchy write-up for the exact diff).

**Update, Aug 17 2026**: recommendations #3-6 were built as Phase 5 of the "Scorecard to 10"
initiative — see CLAUDE.md's own Phase 5 section for the exact diff. All 6 of this audit's
recommendations are now built.
