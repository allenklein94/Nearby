-- Item 143 (owner, 2026-10-16, approved): the waitlist promotion moment. Being moved from the waitlist into Attending is a
-- confirmed change of attendance, so GatheringDetail shows item 31's "~~On waitlist~~ -> ✓ Attending" row once, the first time
-- the person opens that gathering afterwards. The moment must rest on a real, persisted promotion, never an inference, so
-- this records one:
--   - `gathering_waitlist_promotions`: one row per attendance row that went waitlisted -> approved (every path: the automatic
--     `_promote_from_waitlist`, a capacity change, a host approving a waitlisted person), written ONLY by the trigger below.
--     Its own table, not a column on gathering_interest: attendee rows are readable by other viewers, and who was waitlisted
--     is the person's own business. No client grants; read and marked seen only through the two RPCs, own rows only.
--   - Any other status change of that attendance row (approved -> anything, or a later re-entry) removes the record; leaving or
--     being removed deletes the attendance row, and the record goes with it (on delete cascade). So a normal join, a join
--     request, and waitlisted -> pending (an approval-needed gathering: "Requested") never create one.
--   - `seen_at` makes it once per gathering: `mark_my_waitlist_promotion_seen` stamps it when the screen shows the moment.
-- Nothing else changes: promotion order, capacity, the "A spot opened up" pushes, the approval flow and the waitlist path.
create table if not exists public.gathering_waitlist_promotions (
  interest_id uuid primary key references public.gathering_interest(id) on delete cascade,
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  promoted_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists gathering_waitlist_promotions_user_gathering on public.gathering_waitlist_promotions (user_id, gathering_id);
alter table public.gathering_waitlist_promotions enable row level security;
revoke all on public.gathering_waitlist_promotions from public, anon, authenticated;

create or replace function public.record_waitlist_promotion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'waitlisted' and new.status = 'approved' then
    insert into gathering_waitlist_promotions (interest_id, gathering_id, user_id, promoted_at, seen_at)
    values (new.id, new.gathering_id, new.user_id, now(), null)
    on conflict (interest_id) do update set promoted_at = excluded.promoted_at, seen_at = null;
  else
    delete from gathering_waitlist_promotions where interest_id = new.id;
  end if;
  return new;
end;
$function$;
revoke all on function public.record_waitlist_promotion() from public, anon, authenticated;

drop trigger if exists on_gathering_interest_waitlist_promotion on public.gathering_interest;
create trigger on_gathering_interest_waitlist_promotion
  after update of status on public.gathering_interest
  for each row execute function public.record_waitlist_promotion();

-- The viewer's own promotion for one gathering, only while that attendance is still approved. No row = no moment.
create or replace function public.get_my_waitlist_promotion(gathering_id_param uuid)
 returns table (promoted_at timestamptz, seen_at timestamptz)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p.promoted_at, p.seen_at
    from gathering_waitlist_promotions p
    join gathering_interest gi on gi.id = p.interest_id
   where p.gathering_id = gathering_id_param
     and p.user_id = auth.uid()
     and gi.status = 'approved';
$function$;
revoke all on function public.get_my_waitlist_promotion(uuid) from public, anon;
grant execute on function public.get_my_waitlist_promotion(uuid) to authenticated;

-- Marks the viewer's own promotion seen (idempotent: the first stamp stays). Returns whether a row was stamped now.
create or replace function public.mark_my_waitlist_promotion_seen(gathering_id_param uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  update gathering_waitlist_promotions set seen_at = now()
   where gathering_id = gathering_id_param and user_id = auth.uid() and seen_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;
revoke all on function public.mark_my_waitlist_promotion_seen(uuid) from public, anon;
grant execute on function public.mark_my_waitlist_promotion_seen(uuid) to authenticated;
