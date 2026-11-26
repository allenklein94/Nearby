-- Rollback for 20270417: drops the two preference columns (their values are lost; the app treats a missing column as
-- no preference).
alter table public.profiles
  drop constraint if exists profiles_dating_pref_tattoos_check,
  drop constraint if exists profiles_dating_pref_piercings_check,
  drop column if exists dating_pref_tattoos,
  drop column if exists dating_pref_piercings;
