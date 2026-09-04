-- Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
-- plan, Phase H) -- a general consumer Occasions object, closing the one
-- real design question the plan's own locked text left open before this
-- phase could be picked up: does an anniversary need a real second
-- confirmed person, the way a Date does (Aug 17 2026, "Match != Date")?
--
-- Resolved directly, not re-asked, since the shape of the right answer
-- is clear once compared against the one Occasion type this app already
-- has real, live infrastructure for: birthdays
-- (get_upcoming_connected_birthdays, a Home nudge only -- no table row,
-- no consent object). An Occasion is a factual record of a real shared
-- date, never an invitation someone has to accept -- unlike a Date
-- Proposal, which asks "will you actually do this with me," an Occasion
-- only ever asks "is this date real." So: no consent gate, no
-- date_proposals-shaped accept/decline flow. A user creates their own
-- occasion (optionally naming a real connected person it's shared
-- with -- an anniversary, say), and the *action* on it ("let's plan
-- something") flows through the exact same already-real mechanism the
-- birthday nudge already uses -- a Home nudge that prefills
-- CreateGathering, never auto-creates anything, never requires the other
-- person's confirmation to exist as a record.
--
-- Deliberately additive, not a replacement for the existing birthday
-- nudge: profiles.birthdate + get_upcoming_connected_birthdays() are
-- left completely untouched, still the one live, already-verified path
-- for birthdays specifically. This table is real infrastructure for the
-- other 5 named types (anniversary/graduation/milestone/life_event/
-- other), which had zero infrastructure before this migration.

create table if not exists public.occasions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connected_user_id uuid references public.profiles(id) on delete cascade,
  occasion_type text not null check (occasion_type in (
    'birthday', 'anniversary', 'graduation', 'milestone', 'life_event', 'other'
  )),
  title text not null,
  occasion_date date not null,
  recurs_annually boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists occasions_user_id_idx on public.occasions(user_id);

alter table public.occasions enable row level security;

-- A plain, self-editable personal record, same posture as
-- emergency_contacts/date_checkins -- no RPC needed for the owner's own
-- CRUD. Visibility to a real connected person (connected_user_id) is
-- deliberately NOT a second raw RLS policy on this table -- it's gated
-- entirely inside get_upcoming_occasions() below, which re-checks the
-- real connected relationship at read time (the same defense-in-depth
-- reasoning get_upcoming_connected_birthdays() already established: a
-- friendship/match removed later must stop surfacing the signal, not
-- just at creation time).
drop policy if exists "Users manage their own occasions" on public.occasions;
create policy "Users manage their own occasions"
  on public.occasions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.get_upcoming_occasions(days_ahead_param integer default 30)
returns table(
  occasion_id uuid,
  owner_id uuid,
  owner_display_name text,
  connected_user_id uuid,
  occasion_type text,
  title text,
  occasion_date date,
  days_until integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  r record;
  v_year int;
  v_month int;
  v_day int;
  v_next_date date;
  v_days_until int;
begin
  if v_caller is null then
    return;
  end if;

  for r in
    select o.id, o.user_id, p.display_name as owner_display_name, o.connected_user_id,
           o.occasion_type, o.title, o.occasion_date, o.recurs_annually
    from occasions o
    join profiles p on p.id = o.user_id
    where o.user_id = v_caller
       or (
         o.connected_user_id = v_caller
         and (
           exists (
             select 1 from friendships f
             where f.status = 'accepted'
               and ((f.user_a = v_caller and f.user_b = o.user_id) or (f.user_b = v_caller and f.user_a = o.user_id))
           )
           or exists (
             select 1 from matches m
             where (m.user_a = v_caller and m.user_b = o.user_id) or (m.user_b = v_caller and m.user_a = o.user_id)
           )
         )
       )
  loop
    if r.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from r.occasion_date)::int;
      v_day := extract(day from r.occasion_date)::int;

      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;

      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;

      v_days_until := v_next_date - current_date;
    else
      v_next_date := r.occasion_date;
      v_days_until := v_next_date - current_date;
      if v_days_until < 0 then
        continue;
      end if;
    end if;

    if v_days_until between 0 and days_ahead_param then
      occasion_id := r.id;
      owner_id := r.user_id;
      owner_display_name := r.owner_display_name;
      connected_user_id := r.connected_user_id;
      occasion_type := r.occasion_type;
      title := r.title;
      occasion_date := v_next_date;
      days_until := v_days_until;
      return next;
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.get_upcoming_occasions(integer) from public, anon;
grant execute on function public.get_upcoming_occasions(integer) to authenticated;
