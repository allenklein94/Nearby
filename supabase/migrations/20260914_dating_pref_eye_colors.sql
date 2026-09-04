-- Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
-- plan, follow-up to Phase B) -- the second appearance-based matching
-- filter, mirroring dating_pref_hair_colors' own exact shape verbatim.
-- Unlike hair_color, basicsFields.js's `eye_color` entry was already a
-- real, curated 6-value select (Brown/Blue/Green/Hazel/Gray/Other), not
-- free text -- so, unlike height (Phase F), there was no promote-out-of-
-- basics step needed here, only the missing preference/filter half.
--
-- A plain, self-editable text[] with no trusted_update guard, same
-- posture as dating_pref_hair_colors/ethnicity_preferences -- a
-- preference about who the caller wants to see, not a privileged
-- column.
alter table public.profiles
  add column if not exists dating_pref_eye_colors text[] not null default '{}';
