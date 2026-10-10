-- Owner item 16 (2026-10-10, LOCKED): "Coastal Coffee is responding…" on the customer's request, driven ONLY by the real
-- backend workflow: a business pressed Send and Nearby is checking that reply (business_offer_submissions.status =
-- 'reviewing', item 83). It never comes from a business opening the request or the offer editor (item 39 stands: no
-- composing indicator, no business-viewing telemetry exists or is added here).
--
-- Shown only while the check is really running: 'reviewing', not dismissed, updated within the last 3 minutes (the same
-- stall boundary item 83 uses; a stalled check is retryable for the business, never "still responding" to the customer),
-- on the caller's own OPEN request that has not passed its deadline. A held reply ('in_review', the team decides), a
-- refused one, an outage and a published one all leave it, quietly. Requester only.
--
-- Live delivery: business_offer_submissions stays closed to clients. A trigger touches one row per request in
-- request_responding_pings (request id + time, nothing else), which only the requester can read and which is in the
-- realtime publication; the app treats a ping as "re-read" and asks get_responding_businesses, which is the truth.

create table if not exists public.request_responding_pings (
  request_id uuid primary key references public.business_requests(id) on delete cascade,
  changed_at timestamptz not null default now()
);
alter table public.request_responding_pings enable row level security;
revoke all on public.request_responding_pings from public, anon, authenticated;
grant select on public.request_responding_pings to authenticated;
drop policy if exists "Requester reads own responding pings" on public.request_responding_pings;
create policy "Requester reads own responding pings" on public.request_responding_pings
  for select to authenticated
  using (exists (select 1 from public.business_requests br where br.id = request_id and br.requester_id = auth.uid()));

create or replace function public._ping_request_responding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into request_responding_pings (request_id, changed_at) values (new.request_id, now())
  on conflict (request_id) do update set changed_at = excluded.changed_at;
  return null;
exception when others then
  return null; -- a ping is a convenience; it never blocks the business's submission
end;
$$;
revoke all on function public._ping_request_responding() from public, anon, authenticated;

drop trigger if exists trg_ping_request_responding on public.business_offer_submissions;
create trigger trg_ping_request_responding
  after insert or update of status, updated_at, dismissed_at on public.business_offer_submissions
  for each row execute function public._ping_request_responding();

create or replace function public.get_responding_businesses(request_id_param uuid)
returns table (partner_id uuid, name text, stale_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.partner_id, bp.name, s.updated_at + interval '3 minutes'
  from business_offer_submissions s
  join business_requests br on br.id = s.request_id
  join brand_partners bp on bp.id = s.partner_id
  where s.request_id = request_id_param
    and br.requester_id = auth.uid()
    and br.status = 'open'
    and (br.expires_at is null or br.expires_at > now())
    and s.status = 'reviewing'
    and s.dismissed_at is null
    and s.updated_at > now() - interval '3 minutes'
  order by s.updated_at
  limit 10;
$$;
revoke all on function public.get_responding_businesses(uuid) from public, anon;
grant execute on function public.get_responding_businesses(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'request_responding_pings'
     ) then
    execute 'alter publication supabase_realtime add table public.request_responding_pings';
  end if;
end $$;
