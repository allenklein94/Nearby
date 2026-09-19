-- Broad interest: the interest GROUPS a user picked in onboarding ("What are you into?"), kept as their own signal.
-- A group with no tags means "broad interest in this category", NOT "every tag under it" -- tags stay in profiles.interests and
-- remain the stronger, specific signal. Editable/removable independently; never expands into tag selections.
alter table public.profiles
  add column if not exists interest_groups text[] not null default '{}';

comment on column public.profiles.interest_groups is 'Broad interest groups (CATEGORY_GROUPS keys). Weak ranking signal; never implies specific tags.';
