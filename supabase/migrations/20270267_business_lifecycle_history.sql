-- Owner item 147 follow-up (2026-10-03): the request/offer lifecycle keeps its history. The dashboard shows each booking
-- in ONE current stage (utils/businessPipeline.js), but analytics must be able to say independently when a request was
-- created, when an offer was made, accepted, redeemed, declined, withdrawn, expired or closed.
--
-- Audit of what the existing columns already keep (unchanged by this migration): business_requests.created_at;
-- business_request_offers.created_at (reached the business), responded_at (offer made / declined, with decline_reason),
-- accepted_at, completed_at (never cleared by any function); business_reservations.confirmed_at; cancellation_events
-- (root cancels). What was LOST: a request's expired / fulfilled / cancelled moment (status only), its original deadline
-- when reopened (expires_at is overwritten), an offer's expired / not-chosen / cancelled moment, and the offer-made time
-- of a withdrawn offer (withdraw_business_offer overwrites responded_at).
--
-- Fix, additive only: one append-only table written by a trigger on every INSERT and every status change of both
-- tables, whatever function made it. No writer, column or status rule changes. Internal (RLS on, no client grants), like
-- request_journey. Rows cascade with their request/offer (account deletion removes them). Expiry rows carry the sweep's
-- time (the hourly sweep may record up to an hour after the deadline); `deadline` keeps the expires_at in force at the
-- moment of each change, so a reopened request's original deadline survives.
create table if not exists public.business_lifecycle_events (
  id bigserial primary key,
  object_kind text not null check (object_kind in ('request', 'offer')),
  request_id uuid not null references public.business_requests(id) on delete cascade,
  offer_id uuid references public.business_request_offers(id) on delete cascade,
  from_status text,
  to_status text not null,
  deadline timestamptz,
  at timestamptz not null default now(),
  check ((object_kind = 'offer') = (offer_id is not null))
);
create index if not exists business_lifecycle_events_request_idx on public.business_lifecycle_events (request_id, at);
create index if not exists business_lifecycle_events_offer_idx on public.business_lifecycle_events (offer_id, at) where offer_id is not null;
alter table public.business_lifecycle_events enable row level security;
revoke all on public.business_lifecycle_events from public, anon, authenticated;
revoke all on sequence public.business_lifecycle_events_id_seq from public, anon, authenticated;

create or replace function public._record_business_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_table_name = 'business_requests' then
    insert into business_lifecycle_events (object_kind, request_id, from_status, to_status, deadline)
      values ('request', new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
              case when tg_op = 'UPDATE' then old.expires_at else new.expires_at end);
  else
    insert into business_lifecycle_events (object_kind, request_id, offer_id, from_status, to_status, deadline)
      values ('offer', new.request_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
              coalesce(new.valid_until, new.expires_at));
  end if;
  return new;
end;
$$;
revoke all on function public._record_business_lifecycle_event() from public, anon, authenticated;

drop trigger if exists business_requests_lifecycle_history on public.business_requests;
create trigger business_requests_lifecycle_history
  after insert or update of status on public.business_requests
  for each row execute function public._record_business_lifecycle_event();

drop trigger if exists business_request_offers_lifecycle_history on public.business_request_offers;
create trigger business_request_offers_lifecycle_history
  after insert or update of status on public.business_request_offers
  for each row execute function public._record_business_lifecycle_event();

-- Existing rows: one baseline row each, stamped with the time it was recorded (now) and the state they are in, since
-- their earlier transitions were never captured (the timestamps above still hold what they kept). Idempotent: only rows with no history yet.
insert into public.business_lifecycle_events (object_kind, request_id, from_status, to_status, deadline, at)
  select 'request', r.id, null, r.status, r.expires_at, now()
    from public.business_requests r
   where not exists (select 1 from public.business_lifecycle_events e where e.object_kind = 'request' and e.request_id = r.id);
insert into public.business_lifecycle_events (object_kind, request_id, offer_id, from_status, to_status, deadline, at)
  select 'offer', o.request_id, o.id, null, o.status, coalesce(o.valid_until, o.expires_at), now()
    from public.business_request_offers o
   where not exists (select 1 from public.business_lifecycle_events e where e.offer_id = o.id);
