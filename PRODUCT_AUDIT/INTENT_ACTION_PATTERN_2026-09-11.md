# Item 36 — "One intent → action pattern everywhere"

Status: IN PROGRESS, started 2026-09-11.

## User's framing (verbatim)

> I want something → Nearby understands → Nearby shows me options → I choose → Nearby helps me
> make it happen.

This is the whole Thursday plan's underlying goal restated as one architecture principle: when a
new user touches Nearby for the first time, nothing should make them stop and wonder "why did it
do that?" Everything else in the app should support this one loop.

## The four example chains, as given

1. "I want dinner." → restaurants → friends/match → availability → plan → reservation
2. "I want something to do tonight." → events/activities → options → invite people → plan
3. "I want to meet people." → Dating/Friends → relevant people → connect → plan something
4. "I want to build something." → Community/Gathering → create → attract people → connect
   businesses where appropriate

## What already exists (from prior sessions, per CLAUDE.md / memory `project_intent_engine_vision`)

- `resolveIntent()` / `intentResolver.js` — Home's ask-box free-text → categorized results
  (gatherings, business_availability, communities, perks, etc.), taxonomy-driven
  (`gatheringCategories.js`'s 19-group/75-tag vocabulary), scored (`intentResolverScoring.js`).
- `experienceAssembly.js` — regroups already-resolved candidates into an assembled multi-step
  experience (e.g. dinner → activity → dessert) for occasion-shaped asks, including business
  self-declared bundles.
- `dateProposals.js` / `DateProposalScreen.js` — "Plan" flow with a real "Find something nearby"
  business-availability search bound into the invite (2026-09-10, item 4).
- "Surprise Me" (item 28) — mood-based one-shot suggestion with a "you could go with {friend}"
  enrichment when real interest-overlap exists.
- Dating/Friends discovery, relationship-state standardization (items 32/33), Plan-Together entry
  points from match celebration/profile/gathering/business screens (item 21).
- CreateHubScreen mirroring Discover's own taxonomy (item 20), with a "With businesses" ask path.

## What this audit is actually checking

Not whether intent resolution exists (it does) — whether each of the 4 chains above completes
end-to-end without the user being dropped onto a disconnected screen or having to manually
re-discover the next step. Specifically per chain:

1. Dinner: does resolving "dinner" actually offer a path to (a) inviting a friend/match and
   (b) something that behaves like a reservation/commitment, or does it stop at "here are some
   restaurants"?
2. Tonight: does "something to do tonight" flow into a real invite-people step, or just show a
   list?
3. Meet people: does connecting (friend accept / match) actually surface "plan something" as a
   next step inline, or does the user have to go hunting?
4. Build something: after creating a community/gathering, is there any real guided next step
   toward attracting people / connecting a business, or does it just drop the user on the new
   empty community page?

## Rules for this pass

- Audit first. Fix contained routing/copy/missing-next-step gaps directly (same standard as items
  25/26/34).
- Do NOT redesign the intent engine or restructure navigation architecture unilaterally. If a gap
  requires real structural work, write it up as a proposal here and stop — don't execute it.
- Standing conventions apply: no fabricated signals, no stranger discovery via intent, AI never
  assigns date/time, migration/verification discipline, incremental commits.

## Findings / fixes so far

(pending)
