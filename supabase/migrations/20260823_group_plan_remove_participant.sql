-- Closes the real, disclosed gap named repeatedly in CLAUDE.md's Group Plans (Phase D) sections:
-- "no 'kick' action for the initiator to remove an already-accepted participant before confirm
-- time outside the exclude-picker." The existing exclude-picker on GroupPlanScreen (toggleExclude
-- / confirmGroupPlan's own exclude_user_ids_param) only ever takes effect at the moment of
-- confirming -- an initiator who wants to remove someone *right now*, while still waiting on
-- other invitees to respond and not yet ready to confirm, has no way to do that today; the
-- "Continue without" toggle is purely staged local state until Confirm is actually pressed.
--
-- Fixed with a new remove_group_plan_participant() RPC, mirroring leave_group_plan()'s own shape
-- (same terminal 'left' status, same real push notification convention every other group-plan
-- transition already uses) but callable by the initiator against someone else, scoped to a still-
-- pending proposal only -- confirm_group_plan()'s own exclude_user_ids_param already covers
-- removal *at* confirm time, this covers removal *before* it, so the initiator isn't forced to
-- choose between "confirm right now" and "wait, with someone in the roster I've already decided
-- to drop."

CREATE OR REPLACE FUNCTION public.remove_group_plan_participant(proposal_id_param uuid, target_user_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_proposal record;
  v_participant record;
  service_key text;
begin
  select * into v_proposal from group_plan_proposals where id = proposal_id_param for update;
  if v_proposal is null then
    raise exception 'Group plan not found.';
  end if;
  if v_proposal.initiator_id <> auth.uid() then
    raise exception 'Only the person who proposed this group plan can remove someone.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This group plan can no longer be edited -- it has already been confirmed, cancelled, or expired.';
  end if;
  if target_user_id_param = auth.uid() then
    raise exception 'You can''t remove yourself -- cancel the group plan instead.';
  end if;

  select * into v_participant from group_plan_participants where proposal_id = proposal_id_param and user_id = target_user_id_param for update;
  if v_participant is null then
    raise exception 'That person is not part of this group plan.';
  end if;
  if v_participant.status = 'left' then
    raise exception 'That person has already left this group plan.';
  end if;

  update group_plan_participants
  set status = 'left', responded_at = coalesce(responded_at, now())
  where id = v_participant.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', target_user_id_param,
        'title', 'You were removed from a group plan',
        'body', 'You''re no longer part of the ' || v_proposal.category || ' group plan.',
        'data', jsonb_build_object('type', 'group_plan_removed', 'proposal_id', proposal_id_param)
      )
    );
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

REVOKE ALL ON FUNCTION public.remove_group_plan_participant(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_plan_participant(uuid, uuid) TO authenticated;
