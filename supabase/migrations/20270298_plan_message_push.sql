-- Plan group chat push (owner, 2026-10-11: "plan messages send no push -- investigate and fix").
--
-- Cause: not a broken path. Item 89 (20261109_plan_group_chat.sql) shipped plan_messages live-while-open only and disclosed
-- the push as a fast-follow; no trigger was ever added, so a message reached nobody whose chat screen was closed.
--
-- Fix, following the one 1:1 chat push (notify_new_message on messages) and the notification rules:
--   * one AFTER INSERT trigger; every push goes through _send_push (outbox, dedupe, retry, the person's mutes);
--   * new type 'plan_message' in the existing 'messages' group: the one Messages switch now covers plan chats too
--     (notification_type_groups row below = NOTIFICATION_GROUP_BY_TYPE, test-enforced);
--   * recipients = the plan's real participants (host, organizers, accepted guests), minus the sender, minus anyone
--     blocked either way with the sender (is_blocked; the trigger runs as the sender's own insert). A surprise-excluded
--     person is never a participant (20261114), so is never a recipient;
--   * one source for the roster: _plan_participant_rows(), now read by get_plan_participants() too (same rows, roles and
--     order as before), so the chat header and the push recipients cannot drift;
--   * a busy chat does not buzz someone per line: at most one push per person per plan per 2 minutes (outbox dedupe
--     key); the push names the message that opened the window;
--   * payload: type + plan_id + business_request_id (the id PlanChat opens from); nothing else.

create or replace function public._plan_participant_rows(plan_id_param uuid)
returns table (user_id uuid, role text, prio int)
language sql
security definer
stable
set search_path = public
as $$
  select distinct on (x.user_id) x.user_id, x.role, x.prio
  from (
    select p.created_by as user_id, 'host'::text as role, 1 as prio
    from plans p where p.id = plan_id_param
    union all
    select po.user_id, 'organizer', 2
    from plan_organizers po where po.plan_id = plan_id_param
    union all
    select gpp.user_id, 'guest', 3
    from plans p
    join group_plan_participants gpp on gpp.status = 'accepted'
    where p.id = plan_id_param
      and p.resulting_business_request_id is not null
      and gpp.proposal_id in (
        select gpp2.proposal_id from group_plan_participants gpp2
        where gpp2.source_request_id = p.resulting_business_request_id
        union
        select br.group_plan_id from business_requests br
        where br.id = p.resulting_business_request_id and br.group_plan_id is not null
      )
  ) x
  where x.user_id is not null
  order by x.user_id, x.prio;
$$;

revoke all on function public._plan_participant_rows(uuid) from public, anon, authenticated;

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

  select coalesce(jsonb_agg(jsonb_build_object('id', r.user_id, 'displayName', pr.display_name, 'role', r.role) order by r.prio), '[]'::jsonb)
  into v_participants
  from public._plan_participant_rows(v_plan.id) r
  join profiles pr on pr.id = r.user_id;

  return jsonb_build_object('planId', v_plan.id, 'title', v_plan.title, 'participants', v_participants);
end;
$$;

insert into public.notification_type_groups (type, group_key) values
  ('plan_message', 'messages')
on conflict (type) do update set group_key = excluded.group_key;

create or replace function public.notify_plan_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_sender_name text;
  v_body text;
  r record;
begin
  select id, title, resulting_business_request_id into v_plan from plans where id = new.plan_id;
  if v_plan.id is null then
    return new;
  end if;
  select display_name into v_sender_name from profiles where id = new.sender_id;
  v_body := coalesce(v_sender_name, 'Someone') || ': ' ||
    case when new.body is not null and btrim(new.body) <> '' then left(new.body, 100) else 'Sent a message' end;

  for r in select p.user_id from public._plan_participant_rows(new.plan_id) p where p.user_id <> new.sender_id loop
    if public.is_blocked(new.sender_id, r.user_id) then
      continue;
    end if;
    perform public._send_push(
      r.user_id,
      coalesce(nullif(btrim(v_plan.title), ''), 'Your plan'),
      v_body,
      jsonb_build_object('type', 'plan_message', 'plan_id', v_plan.id,
        'business_request_id', v_plan.resulting_business_request_id),
      'plan_message:' || v_plan.id || ':' || r.user_id || ':' || floor(extract(epoch from new.created_at) / 120)::bigint
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.notify_plan_message() from public, anon, authenticated;

drop trigger if exists on_plan_message_created on public.plan_messages;
create trigger on_plan_message_created
  after insert on public.plan_messages
  for each row execute function public.notify_plan_message();
