# Nearby — Product Coherence Audit REFRESH (2026-08-24)

**Read-only. No application code was touched to produce this.** Same rule as the original pass:
findings are recommendations for a future, separately-authorized fix, not something this session
acts on unilaterally. This is a **refresh**, not a from-scratch redo — it re-verifies the Aug 23
audit's own findings against current code, audits the one real structural change that's happened
since (today's Discover/People tab merge), and looks for anything genuinely new. It does not
re-derive content that's provably unchanged; every section below states explicitly what was
re-checked and how.

Companion to `PRODUCT_AUDIT/PRODUCT_COHERENCE_AUDIT_2026-08-23.md` (the original 4-layer pass) —
read that file for the full original detail on anything not restated here.

---

## What changed since the Aug 23 audit, and what didn't

**Real, structural change**: Discover moved from a pushed screen reachable only via a single
hyperlink (Home's "Continue Browsing," Create's "Browse what's already out there") to a real
fourth-position... second-position bottom tab — **Home | Discover | Create | Activity**. People
(previously its own tab: Stories + a Dating/Friends launcher) was folded into Discover as a mode
toggle ("🔎 Things to Do" / "👥 People"), remembered locally across visits. `PeopleScreen.js` no
longer exists. Full detail: CLAUDE.md's "Aug 24 2026 — Discover becomes a real bottom tab" entry.

**Also landed since Aug 23, but pure bug fixes with no coherence-relevant surface**: the
`crypto.randomUUID()` Hermes crash fix, and the "seven real UI/UX issues from live usage" pass
(Stories de-duplication on People/Friends, Circles decluttering, a community-level "Ask Local
Businesses" broadcast RPC, a community-chat info panel, hideable gathering-chat chips, and
Discovery's header/subtitle tracking its actual mode) — read directly, none of these introduce a
new duplication, terminology drift, or navigation inconsistency; several (the Stories dedup) are
themselves convergence fixes of exactly the shape this audit cares about, already done.

**Re-verified, not just assumed, that nothing regressed**: all three of the Aug 23 audit's own
P1/P2 fixes (the "Confirmed"→"Locked In" reword in `GroupPlanScreen.js`, the explicit
`GatheringsScreen`/`PlansScreen` split comment + "Manage your hosted gatherings" link in
`PlansScreen.js`) are still present in code, byte-for-byte, untouched by anything since.

**The "Start Something / Make a Date Plan / Your Life on Nearby" IA pass** (Create's "With
people" row — Invite Friends/Plan a Date/Meet New People; Matches' 💌 "Plan" button;
Profile's Your-Plans-leads-Your-Story reorder) **predates the Aug 23 audit**, not new since — it
was already live when that audit ran, and its flows (Person → Date via the 💌 button) trace
identically to what Audit 3's flow 2 already described as clean. Re-confirmed present and
unchanged; not re-traced as "new" since it isn't.

---

## Re-verification, layer by layer

### Layer 1 — 30-Second / Comprehension

**A real, worth-stating-honestly finding: the original audit's own blind spot.** Audit 1 (Aug 23)
reviewed the 4-tab shape and called it "a real, already-converged shape — better than most apps
this scope reaches," without ever questioning whether a core surface (Discover) being reachable
only via a buried hyperlink was itself a comprehension problem. It wasn't flagged as a P0, a P1,
or even a P2 — it wasn't flagged at all. The very next day, a direct user report (not this audit)
caught it: *"the only way to access discover screen... is from the home tab's one hyperlink...
I completely feel like this hides discover mode."* That's a real methodology lesson worth keeping
for future passes, not just a footnote: **auditing a screen's own internal correctness (Discover's
search/filter/map logic was fine) is a different question from auditing whether the screen is
reachable at all** — this audit's own convergence and UI/UX layers checked the former
exhaustively and never asked the latter. A future coherence pass should explicitly add "is every
tier-1 surface actually reachable in ≤2 taps from a cold app open" as its own checklist item, not
assume it if the screen itself reads clean.

**Now fixed, re-verified directly against current code**: Discover is a real tab, second position,
right after Home. The mode toggle inside it is large and immediately visible (not buried in a
settings-style list) — a first-time opener sees "🔎 Things to Do / 👥 People" before anything
else on the screen. This closes the specific gap named above.

**A new, small, honest trade-off introduced by the fix — disclosed, not hidden**: reaching Dating
or Friends now costs one more tap on a *cold* Discover visit (Discover tab → tap "People" mode →
tap Dating/Friends row) than the old dedicated People tab did (People tab → tap Dating/Friends
row). The mode is remembered locally (`AsyncStorage`) across visits, so this only costs the extra
tap the first time since the redesign, or whenever a session's last-used mode happened to be
Things-to-Do — not a P0/P1 regression (it's the accepted, disclosed cost of a deliberate,
already-made decision, and the underlying People-content itself lost nothing), but worth stating
plainly rather than only counting the win. **P2, folded below.**

**Home's length** — unchanged since Aug 23 (same 5 major sections + banner cluster + quick-stats
row, re-confirmed via a direct grep of every `sectionHeader`-styled title in `HomeScreen.js`: Your
Plans, Nearby Right Now, Quick Picks, Happening Near You, Your Communities, Quick Stats, Because
You Like…). Same finding as before: real, justified content, but the *cumulative* first scroll
still reads as "a lot." Not re-litigated further here — nothing changed to justify revisiting the
prior verdict.

**The required onboarding wizard** — unchanged, still a real strength (3 steps, progress dots,
Sign Out safety valve). Not re-checked in detail since nothing has touched it.

### Layer 2 — Convergence

Re-checked every item on the Aug 23 "Already converged — cite these, don't touch them" list
against current code, since two of the five explicitly named a screen that's since changed shape:

- **`AskBusinessScreen`, `RequestBusinessPartnerScreen`, `GroupPlanScreen`** — untouched by
  anything since Aug 23, still true as described. Not re-verified line-by-line (no plausible
  reason they'd have drifted), spot-checked via grep that all three still exist with the same
  entry-point call sites named.
- **"People tab already matches the target model"** — **stale**, since `PeopleScreen.js` no
  longer exists as its own tab. **Updated**: the target "People → Friends / Dating" shape is now
  real *inside* Discover's People mode instead of at the top level — the underlying convergence
  claim (Dating and Friends are two separate matching engines under one shared entry model, never
  merged into one candidate pool) still holds exactly as before; only its container changed.
- **"`DiscoverHubScreen` — one browse/search/map surface... not duplicated anywhere"** — **still
  true, and now stronger**: it's no longer just "not duplicated," it's the actual second-position
  tab. The convergence claim improves; nothing to flag.

**No new convergence issues found.** Checked specifically whether today's mode-toggle pattern
(Things to Do / People) introduces any duplicate-destination risk with anything else in the app —
it doesn't: `DiscoveryScreen` (`Nearby`) and `FriendDiscoveryScreen` are each reached from exactly
one place (Discover's People mode), matching the "one canonical destination, multiple entry
contexts" pattern this audit's own methodology already treats as the bar to measure against.

**P1 (`GatheringsScreen` vs. `PlansScreen`) and the Rewards/Your Activity framing** — both
confirmed still fixed as described in the "What changed" section above. Nothing further to add.

### Layer 3 — One-Product / Ecosystem

**Re-ran the three flow traces most plausibly affected by today's change** (the other 9 — business
offer/reservation/date/birthday/weather/recommendation/transportation/post-visit flows — don't
touch Discover or People at all and weren't re-run, since nothing in their own code paths
changed):

1. **Person → Friend.** Re-checked: `FriendsScreen` (the real friend list/request-management
   screen) was never part of the old People tab or the new Discover People mode at all — it's
   reached independently from Profile's quick-stat, Home's quick-stats card, Settings' Connect
   section, and Messages' own link. **Unaffected by today's change, still Clean.**
2. **Person → Date.** `DiscoveryScreen` is now reached via Discover → People mode → Dating, one
   tap deeper on a cold visit than before (see Layer 1's disclosed trade-off above). The
   underlying flow itself — swipe → mutual like → real `matches` row → `ChatScreen` — is
   completely unchanged. **Still Clean; the only change is entry-point depth, already disclosed.**
3. **Person → Gathering.** The intent resolver's Tier 2 (a connected friend/match's own open ask)
   and direct invites are both independent of the tab structure entirely — neither routes through
   Discover or People at any point. **Unaffected, still Clean.**

**The core object (`business_requests`) and the 12-flow verdict from Aug 23 stand unchanged** —
nothing in today's change touches any business/offer/plan/reservation code path. Not re-derived.

### Layer 4 — UI/UX

**Terminology**: re-checked specifically whether "Discover" as a tab name now collides with any
other user-facing use of the word "discover" elsewhere in the app (a real risk any time a common
word becomes a proper-noun destination name). Grepped every screen for the string — every other
occurrence is a lowercase, generic verb ("discover this gathering," "discover people," "discover
places nearby") describing an action, never a second thing called "Discover." **No collision.**

**States/interaction consistency**: not re-checked in this pass — nothing plausibly affected by a
pure navigation-hierarchy change, and the Aug 23 pass already found this layer mature.

**A new, real, small finding**: the mode toggle's remembered-state behavior (`discover_last_mode`
in `AsyncStorage`) has never been exercised on a real device — this sandbox can't verify that a
real app restart actually restores the right mode, only that the code correctly reads/writes the
key. Flagged here as a concrete, checkable item for the next real device pass, not assumed working
by inspection alone (matches this file's own standing "no manual simulator/device run-through"
disclosure convention, restated specifically for this one piece since it's new).

---

## Updated prioritization

### P0 — Fix immediately
*(None found, same as Aug 23.)* Today's real structural change (Discover/People) closed the one
gap that came closest to P0-severity in practice (a core surface effectively invisible) — and it
was closed by direct user report, not by this audit catching it, which is itself the headline
methodology finding above.

### P1 — Fix before adding more major features
*(None new. The two Aug 23 P1s are both already fixed and re-confirmed intact — see "What
changed" above.)*

### P2 — Polish later
1. **The one-extra-tap cost to reach Dating/Friends on a cold Discover visit** (Layer 1/3 above)
   — real, disclosed, low-stakes given the remembered-mode mitigation. If ever revisited: the
   honest fix isn't defaulting Discover to People mode (that would just invert the same cost onto
   Things-to-Do), it's confirming on a real device that the remembered-mode behavior genuinely
   holds across a real app restart, not just a same-session tab switch — see Layer 4's finding.
2. *(Carried forward from Aug 23, not yet touched, still real, still low-stakes)*: none — all
   three of Aug 23's own P2 items were already fixed same-day, before this refresh started.

### DEFERRED — do not touch yet
*(Both Aug 23 items — Activity/Messages re-merge, the weather forecast-API ceiling — remain
untouched and still correctly deferred; nothing in today's change bears on either.)*

---

## Direct answers, updated

**A. Can a brand-new user understand Nearby in 30 seconds?** Yes, more clearly than on Aug 23 —
the single biggest comprehension gap the original pass missed (Discover effectively hidden) is
now closed. The same honest caveat as before still applies: Home's cumulative length means
"understand the pitch" and "see everything at a glance" are still two different bars, and only
the first is cleanly met in 30 seconds.

**B. Does Nearby currently feel like one product?** Yes, and slightly more so than Aug 23 — a
core exploration surface no longer reads as an afterthought relative to the tabs that do have
permanent bottom-bar real estate. The one real trade-off (Layer 1/3) is disclosed, not hidden.

**C. What are the biggest remaining sources of cognitive load?** Home's cumulative length
(unchanged verdict). The Discover mode-toggle's own remembered state hasn't been proven on a real
device yet — a small, checkable unknown, not a known problem.

**D. What are the biggest duplicate/converging user jobs?** None found, same as Aug 23 — this
refresh's own review of the "already converged" list turned up zero new duplications, only two
stale citations (both updated above, not overlaps).

**E. If feature development stopped today, what would be fixed before launch?** A real device
confirmation that Discover's remembered mode actually survives a real app restart (the one
genuinely new open question this refresh surfaced) — everything else flagged by either audit pass
is already fixed or deliberately deferred pending real usage data.
