-- CLAUDE.md item 8: real "Call"/"Video" between two matched people. Not
-- built as actual custom WebRTC infrastructure (no paid signaling/TURN
-- vendor exists for this app) -- both participants open the same
-- deterministic room on Jitsi Meet's real, free, no-account public server
-- (meet.jit.si), via an in-app browser session (expo-web-browser, the
-- same pattern this schema's Stripe onboarding already uses). This RPC
-- is only the notify step (mirrors notify_screenshot_taken's own real
-- shape) -- it never creates or joins anything itself, and is gated the
-- same way as every other match-scoped action: only a real participant
-- in the match can fire it, and it only ever notifies the match's other
-- real participant, never a stranger.
create or replace function notify_video_call_started(match_id_param uuid, call_kind text default 'video')
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  service_key text;
  v_caller_id uuid := auth.uid();
  v_recipient uuid;
  v_caller_name text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  select case when m.user_a = v_caller_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = match_id_param and (m.user_a = v_caller_id or m.user_b = v_caller_id);

  if v_recipient is null then
    return;
  end if;

  select display_name into v_caller_name from profiles where id = v_caller_id;

  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_recipient,
      'title', coalesce(v_caller_name, 'Someone') || (case when call_kind = 'voice' then ' started a voice call' else ' started a video call' end),
      'body', 'Tap to join.',
      'data', jsonb_build_object('type', 'video_call', 'match_id', match_id_param, 'call_kind', call_kind)
    )
  );
end;
$function$;

revoke all on function notify_video_call_started(uuid, text) from public, anon;
grant execute on function notify_video_call_started(uuid, text) to authenticated;
