-- Phase 3 of the "build everything" plan (see CLAUDE.md): progressive/
-- contextual settings. Moves "Looking For" + "Discovery Preferences"
-- (dating intent, show-me, age range, discovery gender) from Settings-only
-- to a real first-open prompt inside DiscoveryScreen.js, gated on a real
-- signal rather than the columns' own always-non-null defaults.
--
-- Checked live before writing this: discovery_gender/show_me/
-- preferred_min_age/preferred_max_age all already have real, non-null
-- defaults ('Prefer not to say' / 'Everyone' / 18 / 99) -- there is no
-- true NULL state to gate on. Rather than treat "still at the default"
-- as a fragile proxy (a user could legitimately want 'Everyone'/18-99),
-- this adds one real boolean flag, the same established pattern as
-- profiles.seen_browse_callout (same table, same "shown once, flip a
-- flag, never again" shape DiscoveryScreen.js already uses for its
-- browse-mode callout).
alter table public.profiles
  add column if not exists dating_preferences_set boolean not null default false;

-- Honest backfill, not a blanket false for every existing row: a profile
-- whose discovery_gender/show_me/age-range/relationship_intention already
-- differ from their untouched defaults has, by definition, already
-- explicitly engaged with these preferences at some point (via the
-- existing Settings form, before this prompt existed) -- correctly marked
-- as already-set, not re-asked. A profile still sitting at every default
-- value has never touched them, so the new first-open prompt is genuinely
-- new signal for that account, not a re-ask.
update public.profiles
set dating_preferences_set = true
where discovery_gender is distinct from 'Prefer not to say'
   or show_me is distinct from 'Everyone'
   or preferred_min_age is distinct from 18
   or preferred_max_age is distinct from 99
   or relationship_intention is not null;
