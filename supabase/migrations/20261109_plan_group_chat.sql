-- Item 89 (CLAUDE.md, "Give the occasion a single shared conversation"):
-- "Rather than Messages -> individual chats -> trying to coordinate, the
-- occasion itself can have a lightweight group conversation: Sarah's
-- Birthday, 8 people, Plan / Chat / Guests / Business."
--
-- Audited first, before writing anything: a GATHERING-destined occasion
-- (a party) already has exactly this -- gathering_messages/
-- GatheringChatScreen, a real, already-shipped group chat for the host and
-- every approved attendee. Building a second one for that destination
-- would be pure duplication. The genuine, concrete gap is the OTHER real
-- occasion destination: a business_request-destined plan (dinner/night
-- out/activity), which -- especially since Item 88's plan_organizers and
-- Item 81's multi-request "Your Plan" timeline -- can now have a real
-- host, co-organizers, and several invited people (via
-- invite_to_business_request/propose_group_plan), all of whom today can
-- only coordinate via scattered 1:1 DMs. This migration scopes Item 89 to
-- exactly that gap, hung off the already-unified `plans` object (Phase G)
-- rather than a gathering-specific or occasion-specific copy -- so any
-- future plan-type this app adds inherits the same mechanism for free.
--
-- Deliberate posture choice, DIFFERENT from plan_organizers/
-- occasion_group_plans' own "zero client policies, RPC-only" convention:
-- Supabase Realtime's postgres_changes delivery evaluates every change
-- against the SUBSCRIBING client's own RLS policies (not a service-role
-- bypass) -- a table with RLS enabled and zero policies can never deliver
-- a live event to an ordinary authenticated client, since RLS defaults to
-- deny with no policies present. A shared conversation's entire value is
-- messages arriving live while the screen is open, so plan_messages
-- instead follows gathering_messages/community_messages' own older,
-- already-proven-live direct-policy shape: real SELECT/INSERT policies,
-- gated by the same kind of SECURITY DEFINER predicate plan_organizers
-- already established (is_plan_organizer), called safely from inside the
-- policy expression -- the same reason is_match_participant/
-- is_group_plan_participant exist as functions instead of inline policy
-- subqueries (see plan_organizers' own migration comment for the exact,
-- live-verified RLS-recursion trap this sidesteps).
--
-- No push notification is sent for a new plan_messages row in this first
-- increment -- matches the existing, already-shipped precedent for
-- gathering_messages/community_messages (live-while-open only, no push) --
-- a real, disclosed fast-follow candidate, not an oversight.

create table if not exists public.plan_messages (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists plan_messages_plan_id_created_at_idx on public.plan_messages(plan_id, created_at desc);

alter table public.plan_messages enable row level security;

-- Generic "who's really coordinating this plan" predicate. Deliberately
-- scoped in THIS pass to business_request-destined plans only (see header
-- comment above) -- a future gathering-chat-adjacent need can extend this
-- same function rather than inventing a second one, exactly like
-- is_plan_organizer's own generic, plan-type-agnostic shape.
--
-- Two different, real mechanisms can put a second person on a business-
-- request-destined plan, and a participant's own group_plan_participants
-- row is found differently under each one:
--   1. invite_to_business_request (Item 36) -- the plan's own primary
--      request id IS the proposal's own initiator row's source_request_id
--      forever; nothing is ever merged/replaced. Found via a participant
--      row whose source_request_id equals this plan's primary request.
--   2. propose_group_plan / confirm_group_plan (the older Phase D flow,
--      GroupPlanScreen) -- confirming creates a brand-new MERGED request
--      and marks every original participant's own source_request_id row
--      'merged', without ever updating source_request_id to point at the
--      new merged row -- so mechanism 1's lookup alone would find nothing
--      once a plan has gone through this older flow. The merged request
--      itself carries the real proposal id directly on its own
--      group_plan_id column, so that's used as the second, independent
--      way to resolve the same proposal.
create or replace function public.is_plan_participant(plan_id_param uuid, user_id_param uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.plans p
    where p.id = plan_id_param
    and (
      public.is_plan_organizer(p.id, user_id_param)
      or (
        p.resulting_business_request_id is not null
        and exists (
          select 1 from public.group_plan_participants gpp
          where gpp.status = 'accepted'
            and gpp.user_id = user_id_param
            and gpp.proposal_id in (
              select gpp2.proposal_id from public.group_plan_participants gpp2
              where gpp2.source_request_id = p.resulting_business_request_id
              union
              select br.group_plan_id from public.business_requests br
              where br.id = p.resulting_business_request_id and br.group_plan_id is not null
            )
        )
      )
    )
  );
$$;

revoke all on function public.is_plan_participant(uuid, uuid) from public, anon;
grant execute on function public.is_plan_participant(uuid, uuid) to authenticated;

drop policy if exists "Plan participants can view plan chat" on public.plan_messages;
create policy "Plan participants can view plan chat"
  on public.plan_messages for select
  using (public.is_plan_participant(plan_id, auth.uid()));

drop policy if exists "Plan participants can send plan chat" on public.plan_messages;
create policy "Plan participants can send plan chat"
  on public.plan_messages for insert
  with check (auth.uid() = sender_id and public.is_plan_participant(plan_id, auth.uid()));

-- The client can never read the `plans` table directly for a plan it
-- didn't create (RLS there is `created_by = auth.uid()` only) -- this is
-- the one resolver a co-organizer/invited guest needs: given a business
-- request id they can already see (the primary or one of its add-ons),
-- find the real plan behind it, confirm real participant access, and
-- return the header info + roster the Chat screen needs in one call.
create or replace function public.get_plan_participants(plan_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_participants jsonb;
begin
  select * into v_plan from plans where id = plan_id_param;
  if v_plan.id is null then
    raise exception 'Plan not found.';
  end if;
  if not public.is_plan_participant(plan_id_param, auth.uid()) then
    raise exception 'You do not have access to this plan.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', z.user_id, 'displayName', z.display_name, 'role', z.role) order by z.prio), '[]'::jsonb)
  into v_participants
  from (
    select distinct on (x.user_id) x.user_id, x.display_name, x.role, x.prio
    from (
      select v_plan.created_by as user_id, pr.display_name, 1 as prio, 'host' as role
      from profiles pr where pr.id = v_plan.created_by
      union all
      select po.user_id, pr.display_name, 2, 'organizer'
      from plan_organizers po join profiles pr on pr.id = po.user_id
      where po.plan_id = v_plan.id
      union all
      select gpp.user_id, pr.display_name, 3, 'guest'
      from group_plan_participants gpp join profiles pr on pr.id = gpp.user_id
      where v_plan.resulting_business_request_id is not null
        and gpp.status = 'accepted'
        and gpp.proposal_id in (
          select gpp2.proposal_id from group_plan_participants gpp2
          where gpp2.source_request_id = v_plan.resulting_business_request_id
          union
          select br.group_plan_id from business_requests br
          where br.id = v_plan.resulting_business_request_id and br.group_plan_id is not null
        )
    ) x
    order by x.user_id, x.prio
  ) z;

  return jsonb_build_object('planId', v_plan.id, 'title', v_plan.title, 'participants', v_participants);
end;
$$;

revoke all on function public.get_plan_participants(uuid) from public, anon;
grant execute on function public.get_plan_participants(uuid) to authenticated;

-- Entry point the client actually calls: resolve a plan's chat from a
-- business_request id it already has on screen (primary or any of its
-- add-ons -- same coalesce(parent_request_id, id) convention
-- get_plan_organizers already established), then return everything the
-- Chat screen's header needs in one round trip.
create or replace function public.get_plan_chat_info(business_request_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_id uuid;
  v_plan record;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;
  if not public.is_plan_participant(v_plan.id, auth.uid()) then
    raise exception 'You do not have access to this plan''s chat.';
  end if;

  return jsonb_build_object('planId', v_plan.id, 'title', v_plan.title)
    || jsonb_build_object('participants', public.get_plan_participants(v_plan.id) -> 'participants');
end;
$$;

revoke all on function public.get_plan_chat_info(uuid) from public, anon;
grant execute on function public.get_plan_chat_info(uuid) to authenticated;

-- Realtime: plan_messages needs the same publication membership every
-- other live-subscribed table already has (20260815_v5_realtime_
-- publication_fix.sql's own idempotent, conditional-add shape, since a
-- bare ALTER PUBLICATION ... ADD TABLE errors on a from-scratch replay
-- that runs this file a second time).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.plan_messages';
  end if;
end $$;
