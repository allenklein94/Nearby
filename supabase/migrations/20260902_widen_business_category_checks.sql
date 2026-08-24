-- Category/filter taxonomy pass (CLAUDE.md) -- AskBusinessScreen.js's own
-- CATEGORY_OPTIONS (business_requests/business_availability's category
-- vocabulary) is being consolidated onto the same shared 26-tag canonical
-- list every other gathering-category surface now uses
-- (src/constants/gatheringCategories.js). That list already includes
-- 'Faith & Spirituality' (a real, pre-existing drift this file already
-- flagged once -- AskBusinessScreen's own 24-tag copy never had it) and
-- the new 'Dating' tag this pass adds. Both CHECK constraints below were
-- still locked to the old 24-tag list -- widening them here so nothing
-- the consolidated UI can now offer gets silently rejected server-side.
-- Widen the CHECK, never repurpose a value -- matches this schema's own
-- established convention (e.g. business_requests_status_check's own
-- 'merged' addition).

alter table public.business_requests drop constraint business_requests_category_check;
alter table public.business_requests add constraint business_requests_category_check
  check (category is null or category in (
    'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
    'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
    'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
    'Volunteering', 'Meditation', 'Running', 'Faith & Spirituality', 'Dating'
  ));

alter table public.business_availability drop constraint business_availability_category_check;
alter table public.business_availability add constraint business_availability_category_check
  check (category is null or category in (
    'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
    'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
    'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
    'Volunteering', 'Meditation', 'Running', 'Faith & Spirituality', 'Dating'
  ));
