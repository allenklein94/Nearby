-- A gathering keeps the activity the person picked (owner, 2026-10-27): Activity != Category != Title.
--   activity     = the Home Quick Pick the gathering was started from ("Dinner"), stored as the pick's English label key
--                  (the client translates it with quickOptionLabel; never shown raw)
--   interest_tag = the category that matches and routes (Foodie), unchanged
--   title        = freely editable; editing it never changes activity
-- Before this, the word was re-read from the title, so "Dinner" retitled "Sam's Birthday" fell back to "Foodie".
-- Rules (trigger gathering_activity_guard):
--   * only a pick that belongs to the gathering's category is kept; anything else on INSERT is dropped (never refused: a
--     stale client still publishes);
--   * set when the gathering is created, never changed afterwards by a direct UPDATE;
--   * cleared when the category changes to one the pick doesn't belong to (the check constraint backs this up).
-- The pairs mirror QUICK_PROMPTS_BY_PERIOD in src/utils/timeContext.js (guard src/utils/gatheringActivity.test.js).
-- Existing gatherings stay NULL: the client then reads the title as before (no backfill: nothing is reconstructed from text).

alter table public.gatherings add column if not exists activity text;

alter table public.gatherings drop constraint if exists gatherings_activity_matches_category;
alter table public.gatherings add constraint gatherings_activity_matches_category check (
  activity is null or (interest_tag, activity) in (
    ('Coffee', 'Coffee'),
    ('Fitness', 'Morning Run'),
    ('Foodie', 'Breakfast'),
    ('Foodie', 'Lunch'),
    ('Foodie', 'Dinner'),
    ('Volunteering', 'Volunteering'),
    ('Reading', 'Reading'),
    ('Concerts', 'Concert'),
    ('Outdoors', 'Walk'),
    ('Outdoors', 'Beach Cleanup'),
    ('Sports', 'Beach Volleyball'),
    ('Wine', 'Wine Tasting')
  )
);

create or replace function public._gathering_activity_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ok boolean;
begin
  v_ok := new.activity is null or (new.interest_tag, new.activity) in (
    ('Coffee', 'Coffee'), ('Fitness', 'Morning Run'), ('Foodie', 'Breakfast'), ('Foodie', 'Lunch'), ('Foodie', 'Dinner'),
    ('Volunteering', 'Volunteering'), ('Reading', 'Reading'), ('Concerts', 'Concert'), ('Outdoors', 'Walk'),
    ('Outdoors', 'Beach Cleanup'), ('Sports', 'Beach Volleyball'), ('Wine', 'Wine Tasting'));
  if tg_op = 'INSERT' then
    if not v_ok then new.activity := null; end if;
    return new;
  end if;
  if new.activity is distinct from old.activity and new.activity is not null then
    raise exception 'A gathering''s activity is set when it is created and cannot be changed.' using hint = 'gathering_activity_fixed';
  end if;
  if not v_ok then new.activity := null; end if;
  return new;
end;
$$;

revoke all on function public._gathering_activity_guard() from public, anon, authenticated;

-- Runs after a_taxonomy_normalize_tags (alphabetical), so it judges the normalized category.
drop trigger if exists gathering_activity_guard on public.gatherings;
create trigger gathering_activity_guard
  before insert or update of activity, interest_tag on public.gatherings
  for each row execute function public._gathering_activity_guard();

-- Item 146: gatherings SELECT is column-level; a new column needs its own grant.
grant select (activity) on public.gatherings to anon, authenticated;
