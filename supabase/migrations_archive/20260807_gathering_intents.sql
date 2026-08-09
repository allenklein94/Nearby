-- Gathering detail redesign, part 3: the private pre-join "what are you
-- hoping for tonight?" micro-question. This is the one dataset in the whole
-- app that must never surface to the host, not even in aggregate — modeled
-- on chemistry_diary_entries' strict own-row-only privacy, not on
-- gathering_feedback (which does get a host-facing aggregate RPC). No
-- update/delete policy and no aggregate RPC exist for this table on purpose;
-- a future recommendation feature reading across users would need its own
-- explicit, separately-reviewed access path, not a broadened policy here.

create table if not exists public.gathering_intents (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  intent text not null check (intent in (
    'meet_someone_new', 'get_out_of_house', 'good_conversations', 'be_active', 'relax_unwind'
  )),
  created_at timestamptz not null default now(),
  unique (gathering_id, user_id)
);

alter table public.gathering_intents enable row level security;

drop policy if exists "Users can record their own gathering intent" on public.gathering_intents;
create policy "Users can record their own gathering intent"
  on public.gathering_intents for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own gathering intent" on public.gathering_intents;
create policy "Users can update their own gathering intent"
  on public.gathering_intents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can view their own gathering intent" on public.gathering_intents;
create policy "Users can view their own gathering intent"
  on public.gathering_intents for select
  using (auth.uid() = user_id);
