-- Dating tattoo + piercing preferences (owner, 2026-11-14). STAGED on post-tier1/browse-global-ranking, NOT deployed;
-- deploys in number order (after 20270416) with its own approval.
--
-- The person's own soft preference about whom they'd like to see ranked higher in Dating Browse: NULL = no preference,
-- 'with' = prefers someone with tattoos / piercings, 'without' = prefers someone without. Ordering only, never a filter:
-- the app's capped appearance rule (utils/datingAppearance.js, total within +/- 6) reads them. The traits themselves are
-- optional self-described profile basics (profiles.basics.tattoos / .piercings, existing jsonb): no column for them.
--
-- Same posture as dating_pref_hair_colors / dating_pref_eye_colors (20260913 / 20260914): plain self-editable columns on
-- the caller's own row, no trusted_update guard (a preference about who the caller wants to see, not a privileged
-- column). Privacy: under 20270348 (staged) other people get no SELECT on these columns (they are not in its public
-- column grant) and the owner reads them through get_my_profile() (returns the whole row); before 20270348 they are as
-- readable as the other dating preferences. No client read of another person's preference exists.
-- Until this is live the app reads and writes without these columns (utils/optionalProfileColumns.js).

alter table public.profiles
  add column if not exists dating_pref_tattoos text
    constraint profiles_dating_pref_tattoos_check check (dating_pref_tattoos is null or dating_pref_tattoos in ('with', 'without')),
  add column if not exists dating_pref_piercings text
    constraint profiles_dating_pref_piercings_check check (dating_pref_piercings is null or dating_pref_piercings in ('with', 'without'));
