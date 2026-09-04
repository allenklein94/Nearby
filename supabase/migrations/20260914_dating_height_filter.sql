-- Phase F of the "global onboarding -> product wiring" master plan
-- (CLAUDE.md, Sep 3 2026 -- locked build order). Promotes height out of
-- the generic, free-text basics jsonb blob into a real first-class
-- column, exactly matching the precedent already set for gender/
-- ethnicity: a real feet/inches picker replaces the free-text input,
-- plus a real dating_pref_min/max_height_inches preference pair wired
-- into proximity.js the same way Phase B's dating_pref_hair_colors
-- filter already was.
--
-- Existing free-text basics.height values are left exactly as they
-- are, per the master plan's own explicit "disclosed limitation" --
-- display-only, never silently converted. Someone who already typed a
-- height only gets the real filter once they re-enter it via the new
-- picker. basicsFields.js's own `height` entry is deliberately
-- untouched by this migration -- the free-text field itself is not
-- being removed, just no longer the only place a height can live.
--
-- All three columns are plain, self-editable columns -- no
-- trusted_update guard, matching dating_pref_hair_colors' own exact
-- posture (a preference about who the caller wants to see, or a fact
-- about themselves, not a privileged column prevent_self_premium_edit()
-- needs to protect).
--
-- The 48-84 bound is a real, generous, honest range (4'0" to 7'0") --
-- rejects only a value that could never be a real adult height (a
-- picker mis-tap producing 0 or a garbage number), never second-guesses
-- a real unusual-but-real height inside it. Matches the "no invented
-- numbers, but a real generous bound" convention this schema already
-- uses elsewhere (e.g. the search_active_business_availability window).

alter table public.profiles
  add column if not exists height_inches integer,
  add column if not exists dating_pref_min_height_inches integer,
  add column if not exists dating_pref_max_height_inches integer;

alter table public.profiles
  add constraint profiles_height_inches_check
    check (height_inches is null or (height_inches between 48 and 84));

alter table public.profiles
  add constraint profiles_dating_pref_min_height_inches_check
    check (dating_pref_min_height_inches is null or (dating_pref_min_height_inches between 48 and 84));

alter table public.profiles
  add constraint profiles_dating_pref_max_height_inches_check
    check (dating_pref_max_height_inches is null or (dating_pref_max_height_inches between 48 and 84));
