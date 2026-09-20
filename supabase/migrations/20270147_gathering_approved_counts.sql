-- The real number of approved attendees per gathering, for capacity/"N going"
-- displays. Reading gathering_interest directly is filtered by RLS, and since
-- migration 20270138 hides a blocked person in either direction, so a client
-- count can be short by a hidden blocked attendee. join_gathering counts every
-- approved row, so "Full" / "spots left" must too. Count only: no identities.
create or replace function public.get_gathering_approved_counts(gathering_ids uuid[])
returns table (gathering_id uuid, approved_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(array_length(gathering_ids, 1), 0) > 500 then
    raise exception 'Too many gatherings';
  end if;
  return query
    select gi.gathering_id, count(*)::integer
    from public.gathering_interest gi
    where gi.gathering_id = any (gathering_ids)
      and gi.status = 'approved'
    group by gi.gathering_id;
end;
$$;

revoke all on function public.get_gathering_approved_counts(uuid[]) from public, anon;
grant execute on function public.get_gathering_approved_counts(uuid[]) to authenticated, service_role;
