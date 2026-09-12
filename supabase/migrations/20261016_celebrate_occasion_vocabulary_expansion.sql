-- Item 61 ("Celebrate Something" life-events wizard, CLAUDE.md) -- widens the real occasion
-- vocabulary to cover a genuine life-events list (graduation, baby shower, engagement,
-- housewarming, promotion/new job, farewell, milestone) that this schema previously had no
-- values for at all, beyond the generic "celebration" catch-all.
--
-- Three real constraints touched, each verified live via pg_get_constraintdef() before writing
-- this migration (per this repo's own migration discipline):
--
-- 1. business_requests.occasion (business_requests_occasion_check) -- the WHY-signal on a single
--    consumer ask. Gains all 7 new values.
-- 2. brand_partners.priority_occasions (brand_partners_priority_occasions_check) -- a business's
--    own occasion-appetite. Gains the same 7 new values, so a business can genuinely say "I want
--    more graduation-party/baby-shower customers" and have that matter to occasionBonus() scoring.
-- 3. occasions.occasion_type (occasions_occasion_type_check) -- the personal recurring-date
--    calendar (Phase H, Sep 14 2026). Gains only the 5 genuinely new, calendar-worthy values
--    (baby_shower, engagement, housewarming, promotion, farewell) -- 'graduation' and 'milestone'
--    already existed here. Deliberately does NOT gain 'date_night'/'celebration'/'casual_hangout'/
--    'business_meal'/'family_gathering' -- those are moods for a single ask, never a real
--    recurring/one-time calendar date, consistent with this table's own original design comment.
--
-- Deliberately NOT touched: business_availability.bundle_occasion
-- (business_availability_bundle_occasion_check) -- scoped intentionally to only the 5 occasions
-- that have a real experienceTemplates.js template (date_night/anniversary/birthday/celebration/
-- family_gathering); no template exists yet for the new life-event types, so widening this
-- constraint would let a business claim a bundle with no real component list behind it. A real,
-- disclosed follow-up if/when those templates get built, not assumed in scope here.

alter table public.business_requests drop constraint if exists business_requests_occasion_check;
alter table public.business_requests
  add constraint business_requests_occasion_check
  check (occasion is null or occasion in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'other'
  ));

alter table public.brand_partners drop constraint if exists brand_partners_priority_occasions_check;
alter table public.brand_partners
  add constraint brand_partners_priority_occasions_check
  check (priority_occasions <@ array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'housewarming',
    'promotion', 'farewell', 'milestone', 'other'
  ]::text[]);

alter table public.occasions drop constraint if exists occasions_occasion_type_check;
alter table public.occasions
  add constraint occasions_occasion_type_check
  check (occasion_type in (
    'birthday', 'anniversary', 'graduation', 'milestone', 'life_event',
    'baby_shower', 'engagement', 'housewarming', 'promotion', 'farewell', 'other'
  ));
