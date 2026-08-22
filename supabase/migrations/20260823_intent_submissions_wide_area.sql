-- Closes Gap 9 from CLAUDE.md's Section D findings ledger ("connect existing consumer-intent +
-- business systems"): "intent_submissions has no location column of any kind ... no lat/lng, no
-- city/area text. This is a real prerequisite gap for any future attempt to roll up 'unmet
-- intent near this business' directly from intent_submissions."
--
-- Deliberately reuses the exact coarse-bucketing convention already established and already
-- decided elsewhere in this schema (profiles.wide_area, gatherings.wide_area) -- a plain
-- "lat,lng" text bucket rounded to one decimal place (~6-7 mile grid), never a precise
-- coordinate -- rather than inventing a new precision/privacy tradeoff for this table. The same
-- convention already backs Friend Discovery's coarse distance bucket and Gatherings' wide-radius
-- tier; applying it here is a straightforward extension of an already-made decision, not a new
-- one. Nullable and fully additive -- every existing row backfills to null, zero behavior change
-- for anything already recorded.

ALTER TABLE public.intent_submissions
  ADD COLUMN IF NOT EXISTS wide_area text;

CREATE INDEX IF NOT EXISTS intent_submissions_wide_area_idx ON public.intent_submissions (wide_area);
