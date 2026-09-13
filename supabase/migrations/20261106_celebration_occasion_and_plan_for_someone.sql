-- Item 83 (CLAUDE.md, direct user request): "Plan for Someone" -- rename
-- Create's "Occasion" card to "Plan for Someone" (pure client-side label
-- change, no schema impact) and give the wizard's own occasion step a
-- real 5-tile quick-pick front door (Birthday / Anniversary / Celebration
-- / Surprise / Custom) in front of the existing 24-value grouped picker,
-- per the user's own locked answer: "Simple front door, full capability
-- behind it... don't sacrifice the existing 24-value capability just to
-- make the first screen simpler."
--
-- Four of those five tiles map onto occasion keys the wizard already
-- fully supports (birthday/anniversary/other, plus 'celebration' driving
-- business_requests.occasion since 20260912_business_request_occasion.sql).
-- "Surprise" is not a new occasion type -- it maps to occasion='celebration'
-- with Item 65's already-real surprise_mode turned on, so it needs no new
-- vocabulary value either.
--
-- The one real gap: 'celebration' was deliberately excluded from every
-- OCCASION_GROUPS group (businessAttributes.js) because it was never a
-- legal occasions.occasion_type or occasion_group_plans.occasion_type
-- value -- only business_requests.occasion/brand_partners.priority_
-- occasions/business_occasion_packages.occasion_type ever accepted it.
-- Making 'celebration' a real wizard-selectable occasion (Item 83's own
-- "Celebration" tile) means a user picking it can now reach both of those
-- previously-closed gates: the wizard's own optional "save to calendar"
-- step (occasions table) and "Let the Group Vote" (occasion_group_plans
-- table). Per this repo's own standing "widen every occasion vocabulary
-- gate together" discipline (Item 73's own lesson, CLAUDE.md), both are
-- widened here rather than left to fail at INSERT time later.
--
-- Audited and confirmed already fine, no change needed: business_requests_
-- occasion_check, brand_partners_priority_occasions_check,
-- business_partner_requests_priority_occasions_check, business_occasion_
-- packages_occasion_type_check, and every function with its own inline
-- 'celebration'-inclusive occasion list (create_business_request/
-- create_business_request_for_gathering/create_business_request_for_match/
-- create_occasion_package/update_occasion_package/
-- set_business_priority_occasions) -- all already accept 'celebration'
-- (confirmed live via pg_get_functiondef / information_schema before
-- writing this migration).

alter table public.occasions drop constraint if exists occasions_occasion_type_check;
alter table public.occasions
  add constraint occasions_occasion_type_check
  check (occasion_type = any (array[
    'birthday', 'anniversary', 'celebration', 'graduation', 'milestone',
    'life_event', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'other'
  ]));

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_occasion_type_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_occasion_type_check
  check (occasion_type = any (array[
    'birthday', 'anniversary', 'celebration', 'graduation', 'baby_shower',
    'engagement', 'wedding', 'housewarming', 'new_job', 'promotion',
    'retirement', 'achievement', 'moving', 'farewell', 'reunion', 'welcome',
    'holiday_gathering', 'milestone', 'life_event', 'other'
  ]));

-- Item 78's shared emoji/noun helpers (20261102_occasion_aware_notifications.sql)
-- fall back to a generic 📅/'Occasion' for any occasion_type not explicitly
-- listed -- harmless, but 'celebration' already has a real, specific
-- icon/label everywhere else (OCCASION_OPTIONS: 🎉 Celebration), so give
-- send_occasion_planning_nudges() the same specific push copy for it.
create or replace function public._occasion_emoji(occasion_type_param text)
returns text
language sql
immutable
as $$
  select case occasion_type_param
    when 'birthday' then '🎂'
    when 'anniversary' then '💍'
    when 'celebration' then '🎉'
    when 'graduation' then '🎓'
    when 'baby_shower' then '🍼'
    when 'engagement' then '💒'
    when 'housewarming' then '🏠'
    when 'promotion' then '📈'
    when 'farewell' then '👋'
    when 'milestone' then '🏆'
    when 'life_event' then '🌟'
    else '📅'
  end;
$$;

create or replace function public._occasion_noun(occasion_type_param text)
returns text
language sql
immutable
as $$
  select case occasion_type_param
    when 'birthday' then 'Birthday'
    when 'anniversary' then 'Anniversary'
    when 'celebration' then 'Celebration'
    when 'graduation' then 'Graduation'
    when 'baby_shower' then 'Baby Shower'
    when 'engagement' then 'Engagement'
    when 'housewarming' then 'Housewarming'
    when 'promotion' then 'Promotion'
    when 'farewell' then 'Farewell'
    when 'milestone' then 'Milestone'
    when 'life_event' then 'Life Event'
    else 'Occasion'
  end;
$$;
