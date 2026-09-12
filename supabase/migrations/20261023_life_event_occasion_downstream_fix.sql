-- Real bug found while generalizing occasion nudges to all 11
-- occasions.occasion_type values (20261022_occasion_planning_nudges_
-- generalized.sql): 'life_event' is one of the original 6 values that
-- table has always allowed (20260914_occasions.sql), but was never added
-- to the wizard's own downstream vocabulary when
-- 20261016_celebrate_occasion_vocabulary_expansion.sql widened everything
-- else (business_requests.occasion / brand_partners.priority_occasions)
-- and 20261020_occasion_group_plans.sql built occasion_group_plans.
-- occasion_type -- both CHECK constraints still reject 'life_event'.
--
-- That was harmless while nothing ever nudged about a life_event occasion
-- (the only way its value could reach the wizard at all). Now that
-- send_occasion_planning_nudges() proactively nudges about EVERY occasion
-- type, a real recipient can tap a life_event push, land in
-- CelebrateSomethingScreen pre-seeded with occasion='life_event', pick a
-- business-destined activity (dinner/night_out/activity) or "Let the
-- Group Vote," and hit a real INSERT failure -- occasion state flows
-- straight from the push payload into submitBusinessRequest()/
-- createOccasionGroupPlan() regardless of whether 'life_event' happens to
-- be one of the wizard's own selectable occasion chips.
--
-- Fixes exactly that gap, nothing broader: adds 'life_event' to both
-- CHECK constraints so the downstream pipeline accepts it. Deliberately
-- does NOT add 'life_event' to CELEBRATE_OCCASION_KEYS/
-- CALENDAR_SAVEABLE_OCCASION_KEYS (celebrateSomething's own wizard occasion
-- picker) -- it stays what it always was, a personal-record-only catch-all
-- a user can log via OccasionsScreen's manual form or receive a nudge
-- about, never something picked from scratch mid-wizard; this migration
-- only makes the pipeline it can already reach (via a nudge deep link)
-- actually work rather than crash.

alter table public.business_requests drop constraint if exists business_requests_occasion_check;
alter table public.business_requests
  add constraint business_requests_occasion_check
  check (occasion is null or occasion in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ));

alter table public.brand_partners drop constraint if exists brand_partners_priority_occasions_check;
alter table public.brand_partners
  add constraint brand_partners_priority_occasions_check
  check (priority_occasions <@ array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ]::text[]);

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_occasion_type_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_occasion_type_check
  check (occasion_type in (
    'birthday', 'anniversary', 'graduation', 'baby_shower', 'engagement',
    'housewarming', 'promotion', 'farewell', 'milestone', 'life_event', 'other'
  ));
