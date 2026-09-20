-- "Interested" state for gatherings: a private, non-committal "I might go" that sits BEFORE attending.
-- Deliberately a separate table from gathering_interest (which is the join request / attendance row: pending,
-- approved, waitlisted) so an Interested person never appears in attendee lists, never counts toward capacity,
-- never gets a match with the host and never enters the gathering chat. Interested -> "I'm going" simply calls the
-- existing join_gathering; a trigger then clears the Interested row so the two states can never coexist.

create table if not exists public.gathering_interested (
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (gathering_id, user_id)
);
create index if not exists gathering_interested_user_idx on public.gathering_interested (user_id, created_at desc);

alter table public.gathering_interested enable row level security;

-- Owner-only read; every write goes through the RPC below (no insert/update/delete policy on purpose).
drop policy if exists "Users see own interested gatherings" on public.gathering_interested;
create policy "Users see own interested gatherings" on public.gathering_interested
  for select using (user_id = auth.uid());

create or replace function public.set_gathering_interested(gathering_id_param uuid, interested_param boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
  v_visibility text;
  v_women_only boolean;
  v_scheduled timestamptz;
  v_gender text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select host_id, visibility, women_only, scheduled_at
    into v_host, v_visibility, v_women_only, v_scheduled
    from gatherings where id = gathering_id_param;
  if v_host is null then raise exception 'Gathering not found'; end if;

  if not interested_param then
    delete from gathering_interested where gathering_id = gathering_id_param and user_id = v_uid;
    return jsonb_build_object('interested', false);
  end if;

  if v_host = v_uid then raise exception 'This is your own gathering'; end if;
  if v_scheduled < now() then raise exception 'This gathering has already happened'; end if;
  if exists (select 1 from blocks
              where (blocker_id = v_host and blocked_id = v_uid) or (blocker_id = v_uid and blocked_id = v_host)) then
    raise exception 'Cannot mark interest in this gathering';
  end if;
  if v_visibility = 'invite_only' and not exists (
       select 1 from social_invites
        where invite_type = 'gathering' and target_id = gathering_id_param
          and invitee_id = v_uid and status = 'accepted') then
    raise exception 'This gathering is invite-only. Ask the host for an invite.';
  end if;
  if v_women_only then
    select gender into v_gender from profiles where id = v_uid;
    if lower(coalesce(v_gender, '')) not in ('female', 'woman') then
      raise exception 'This gathering is women-only';
    end if;
  end if;
  -- Already attending / requested / waitlisted: that state wins, Interested is not stored alongside it.
  if exists (select 1 from gathering_interest where gathering_id = gathering_id_param and user_id = v_uid) then
    return jsonb_build_object('interested', false, 'already_joined', true);
  end if;

  insert into gathering_interested (gathering_id, user_id) values (gathering_id_param, v_uid)
  on conflict do nothing;
  return jsonb_build_object('interested', true);
end;
$$;
revoke all on function public.set_gathering_interested(uuid, boolean) from public, anon;
grant execute on function public.set_gathering_interested(uuid, boolean) to authenticated;

-- Host-only, count only: no identities (an Interested person has not asked to be seen by the host).
create or replace function public.get_gathering_interested_count(gathering_id_param uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from gatherings where id = gathering_id_param and host_id = auth.uid()) then
    raise exception 'Not your gathering';
  end if;
  return (select count(*)::int from gathering_interested where gathering_id = gathering_id_param);
end;
$$;
revoke all on function public.get_gathering_interested_count(uuid) from public, anon;
grant execute on function public.get_gathering_interested_count(uuid) to authenticated;

-- Going supersedes Interested: any join/request/waitlist row clears the person's Interested row.
create or replace function public.clear_interested_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from gathering_interested where gathering_id = new.gathering_id and user_id = new.user_id;
  return new;
end;
$$;
revoke all on function public.clear_interested_on_join() from public, anon, authenticated;

drop trigger if exists gathering_interest_clears_interested on public.gathering_interest;
create trigger gathering_interest_clears_interested
  after insert on public.gathering_interest
  for each row execute function public.clear_interested_on_join();
