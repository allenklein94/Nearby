-- Rollback for migration 20270373 (user-content screening). Restores every function, policy, trigger, column and grant to
-- what it was before. Refuses (raises, nothing changed) while rolling back would PUBLISH content a person hasn't approved
-- (a held / removed row, a hidden chat message) or drop held text still waiting for a decision. The owner decides those
-- first. The decided-items record is dropped with its table: export it first if it must be kept.
do $$
begin
  if exists (select 1 from public.gatherings where moderation_state <> 'visible')
     or exists (select 1 from public.communities where moderation_state <> 'visible')
     or exists (select 1 from public.gathering_questions where moderation_state <> 'visible')
     or exists (select 1 from public.photo_comments where moderation_state <> 'visible')
     or exists (select 1 from public.community_messages where moderation_state <> 'visible')
     or exists (select 1 from public.gathering_messages where moderation_state <> 'visible') then
    raise exception 'held, removed or hidden content exists (20270373); rolling back would publish it. Decide it first';
  end if;
  if exists (select 1 from private.ugc_held_items where status = 'pending') then
    raise exception 'held content is waiting for a decision (20270373); decide it before rolling back';
  end if;
end $$;

select cron.unschedule('screen-group-chat');
select cron.unschedule('purge-ugc-moderation');

drop trigger if exists zzz_screen_user_content on public.profiles;
drop trigger if exists zzz_screen_user_content on public.gatherings;
drop trigger if exists zzz_screen_user_content on public.communities;
drop trigger if exists zzz_screen_user_content on public.gathering_questions;
drop trigger if exists zzz_screen_user_content on public.photo_comments;
drop trigger if exists zzz_screen_chat_state on public.community_messages;
drop trigger if exists zzz_screen_chat_state on public.gathering_messages;
drop trigger if exists zzz_screen_chat_after_insert on public.community_messages;
drop trigger if exists zzz_screen_chat_after_insert on public.gathering_messages;

drop policy if exists "Held communities only to their creator" on public.communities;
drop policy if exists "Held questions only to their asker" on public.gathering_questions;
drop policy if exists "Held comments only to their author" on public.photo_comments;
drop policy if exists "Hidden community chat only to its sender" on public.community_messages;
drop policy if exists "Hidden gathering chat only to its sender" on public.gathering_messages;

-- the versions before 20270373, verbatim
CREATE OR REPLACE FUNCTION public._gathering_row_visible(g_id uuid, g_host_id uuid, g_visibility text, g_women_only boolean, g_community_id uuid, g_hosting_partner_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_partner uuid;
begin
  if v_uid is null or g_id is null then return false; end if;
  if g_host_id = v_uid then return true; end if;
  -- already part of it (any request state) or personally invited
  if exists (select 1 from gathering_interest where gathering_id = g_id and user_id = v_uid) then return true; end if;
  if exists (select 1 from social_invites where invite_type = 'gathering' and target_id = g_id and invitee_id = v_uid
             and status in ('pending', 'accepted')) then return true; end if;
  -- the business that partners on it, or was asked to
  select managed_partner_id into v_partner from profiles where id = v_uid;
  if v_partner is not null and (
       v_partner = g_hosting_partner_id
       or exists (select 1 from business_partnership_requests r where r.target_type = 'gathering' and r.target_id = g_id
                  and r.partner_id = v_partner and r.status in ('pending', 'approved'))) then
    return true;
  end if;
  -- a suspended host's gatherings stay visible only to the people already in them (above), never to anyone new
  if private.account_suspended(g_host_id) then return false; end if;
  if public.viewer_blocked_either_way(g_host_id) then return false; end if;
  if coalesce(g_women_only, false)
     and lower(coalesce((select gender from profiles where id = v_uid), '')) not in ('female', 'woman') then return false; end if;
  return case g_visibility
    when 'everyone' then true
    when 'friends' then public.viewer_is_friend_of(g_host_id)
    when 'community' then g_community_id is not null
      and exists (select 1 from community_members where community_id = g_community_id and user_id = v_uid)
    else false
  end;
end;
$function$

;

drop trigger if exists zzz_ugc_target_visible on public.social_invites;
drop trigger if exists zzz_ugc_target_visible on public.business_requests;
drop trigger if exists zzz_ugc_target_visible on public.business_partnership_requests;
drop function if exists private.ugc_refuse_while_held();

CREATE OR REPLACE FUNCTION public.get_public_gathering_invite_preview(gathering_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', g.id,
    'title', g.title,
    'interest_tag', g.interest_tag,
    'scheduled_at', g.scheduled_at,
    'host_display_name', p.display_name,
    'attendee_count', (
      select count(*) from public.gathering_interest gi
      where gi.gathering_id = g.id and gi.status = 'approved'
    )
  )
  into v_result
  from public.gatherings g
  join public.profiles p on p.id = g.host_id
  where g.id = gathering_id_param;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.emit_gathering_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._emit_event('GATHERING_CREATED', 'gathering', new.id, new.host_id, 'gathering_insert',
    jsonb_build_object('gathering_id', new.id), 'GATHERING_CREATED:' || new.id);
  return new;
end;
$function$;

drop function if exists public.admin_decide_held_user_content(uuid, boolean, text);
drop function if exists public.admin_list_held_user_content();
drop function if exists public.get_my_held_content();
drop function if exists public.record_ugc_screening(uuid, text, text, boolean, text, text[], text[], text, text);
drop function if exists public.find_ugc_screening(uuid, text, boolean);
drop function if exists public.claim_ugc_chat_batch(integer);
drop function if exists public.record_ugc_chat_screening(bigint, text, text[], text[], text, text);
drop function if exists public.fail_ugc_chat_screening(bigint, text);
drop function if exists private.ugc_record_approval(uuid, text, text, jsonb);
drop function if exists private.purge_ugc_moderation();
drop function if exists private.ugc_chat_kick();
drop function if exists private.ugc_enqueue_chat();
drop function if exists private.ugc_chat_state_guard();
drop function if exists private.ugc_screen_profiles();
drop function if exists private.ugc_screen_two_fields();
drop function if exists private.ugc_screen_questions();
drop function if exists private.ugc_screen_photo_comments();
drop function if exists private.ugc_hold(text, uuid, text, jsonb, text, text);
drop function if exists private.ugc_supersede(text, uuid, text);
drop function if exists private.ugc_writes_exempt();
drop function if exists private.ugc_require_all(text[]);
drop function if exists private.ugc_require(text, boolean);
drop function if exists private.ugc_screening_lookup(uuid, text, boolean);
drop function if exists private.ugc_outcome_for(text, text[], boolean);
drop function if exists private.ugc_basics_text(jsonb);
drop function if exists private.ugc_prompt_answers(jsonb);
drop function if exists private.ugc_text_sha(text);
drop function if exists private.ugc_norm(text);

alter table public.gatherings drop column if exists moderation_state;
alter table public.communities drop column if exists moderation_state;
alter table public.gathering_questions drop column if exists moderation_state;
alter table public.photo_comments drop column if exists moderation_state;
alter table public.community_messages drop column if exists moderation_state;
alter table public.gathering_messages drop column if exists moderation_state;

drop table if exists private.ugc_chat_queue;
drop table if exists private.ugc_held_items;
drop table if exists private.ugc_screenings;
drop table if exists private.ugc_language_calibration;
