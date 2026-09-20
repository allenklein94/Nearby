-- Item 77 follow-ups (owner-approved, 2026-09-20).
-- (1) "Free tonight": an OPT-IN, expiring flag. It is stored in its own table (no client grants, RPC-only). Nobody can
--     read it directly; `get_mutual_free_tonight` returns, from a list of candidates the caller already has, only those
--     who ALSO set the flag -- and returns nothing at all unless the caller set it too. So "Both free tonight" is a fact
--     only two consenting people can see, never a public status.
-- (2) Approximate distance to a MATCH only (mutual interest = a `matches` row). Uses the coarse notification areas
--     (~0.7 mi cells, 48 h TTL, exist only while the person has Discovery notifications on, cleared on opt-out), so the
--     answer is whole miles ("about 3 mi"), never a coordinate, cell or exact figure. A stranger never gets one.

create table if not exists public.free_tonight (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  until_at timestamptz not null
);
alter table public.free_tonight enable row level security;
revoke all on public.free_tonight from public, anon, authenticated;

create or replace function public.set_free_tonight(until_param timestamptz)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if until_param is null then
    delete from free_tonight where user_id = auth.uid();
    return null;
  end if;
  -- "Tonight" is at most 14 hours; the client sends the device-local end of the night, the server only clamps it.
  v_until := least(until_param, now() + interval '14 hours');
  if v_until <= now() then raise exception 'That time has already passed.'; end if;
  insert into free_tonight (user_id, until_at) values (auth.uid(), v_until)
  on conflict (user_id) do update set until_at = excluded.until_at;
  return v_until;
end $$;
revoke all on function public.set_free_tonight(timestamptz) from public, anon;
grant execute on function public.set_free_tonight(timestamptz) to authenticated;

create or replace function public.get_my_free_tonight()
returns timestamptz language sql stable security definer set search_path = public as $$
  select until_at from free_tonight where user_id = auth.uid() and until_at > now();
$$;
revoke all on function public.get_my_free_tonight() from public, anon;
grant execute on function public.get_my_free_tonight() to authenticated;

create or replace function public.get_mutual_free_tonight(candidate_ids uuid[])
returns table(user_id uuid) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if candidate_ids is null or coalesce(array_length(candidate_ids, 1), 0) = 0 then return; end if;
  if not exists (select 1 from free_tonight f where f.user_id = auth.uid() and f.until_at > now()) then return; end if;
  return query
    select f.user_id from free_tonight f
    where f.user_id = any (candidate_ids[1:200])
      and f.user_id <> auth.uid()
      and f.until_at > now()
      and not public.viewer_blocked_either_way(f.user_id);
end $$;
revoke all on function public.get_mutual_free_tonight(uuid[]) from public, anon;
grant execute on function public.get_mutual_free_tonight(uuid[]) to authenticated;

create or replace function public.get_match_distance(match_id_param uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_other uuid; v_a text; v_b text; v_miles double precision;
  la double precision; lo double precision; lb double precision; lob double precision;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select case when m.user_a = auth.uid() then m.user_b else m.user_a end into v_other
  from matches m
  where m.id = match_id_param and (m.user_a = auth.uid() or m.user_b = auth.uid());
  if v_other is null or public.viewer_blocked_either_way(v_other) then return null; end if;
  select n.area into v_a from notification_areas n where n.user_id = auth.uid() and n.updated_at > now() - interval '48 hours';
  select n.area into v_b from notification_areas n where n.user_id = v_other and n.updated_at > now() - interval '48 hours';
  if v_a is null or v_b is null then return null; end if;
  la := split_part(v_a, ',', 1)::double precision;  lo := split_part(v_a, ',', 2)::double precision;
  lb := split_part(v_b, ',', 1)::double precision;  lob := split_part(v_b, ',', 2)::double precision;
  v_miles := 3958.8 * acos(least(1.0, greatest(-1.0,
    cos(radians(la)) * cos(radians(lb)) * cos(radians(lob) - radians(lo)) + sin(radians(la)) * sin(radians(lb)))));
  -- Cells are ~0.7 mi wide, so anything finer than a whole mile would be false precision. 0 means "within about a mile".
  return case when v_miles < 1.5 then 0 else round(v_miles)::integer end;
end $$;
revoke all on function public.get_match_distance(uuid) from public, anon;
grant execute on function public.get_match_distance(uuid) to authenticated;
