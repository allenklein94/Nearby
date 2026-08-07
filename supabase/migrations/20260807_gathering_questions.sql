-- Gathering detail redesign, part 2: public Q&A on a gathering ("Can I bring
-- my dog?", "Is parking easy?") that the host answers. Anyone authenticated
-- may ask (blocks are checked client-side before insert, same convention as
-- expressInterest()); only the gathering's host may set the answer.

create table if not exists public.gathering_questions (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  asker_id uuid not null references public.profiles(id) on delete cascade,
  question_body text not null,
  answer_body text,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_gathering_questions_gathering_created
  on public.gathering_questions(gathering_id, created_at);

alter table public.gathering_questions enable row level security;

drop policy if exists "Anyone can view gathering questions" on public.gathering_questions;
create policy "Anyone can view gathering questions"
  on public.gathering_questions for select
  using (true);

drop policy if exists "Users can ask their own gathering questions" on public.gathering_questions;
create policy "Users can ask their own gathering questions"
  on public.gathering_questions for insert
  with check (auth.uid() = asker_id);

-- Full-row "using"/"with check" (not a column-scoped policy — Postgres RLS
-- can't restrict UPDATE to specific columns) means the host could in theory
-- rewrite question_body via the client too; the client only ever sends
-- {answer_body, answered_at} in its update() call, matching how this
-- codebase already relies on "the client only ever sends X" plus a
-- same-shape full-row policy elsewhere (e.g. gathering_interest's approve
-- policy). Good enough for a first-party host UI, not a public write API.
drop policy if exists "Hosts can answer questions on their own gatherings" on public.gathering_questions;
create policy "Hosts can answer questions on their own gatherings"
  on public.gathering_questions for update
  using (auth.uid() = (select host_id from public.gatherings where id = gathering_id))
  with check (auth.uid() = (select host_id from public.gatherings where id = gathering_id));
