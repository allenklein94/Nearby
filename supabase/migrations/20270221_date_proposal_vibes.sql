-- Date vibes travel with the plan (owner decision 2026-09-26, follow-up to item 85). The person proposing a plan to a match can
-- say what KIND of date it is (romantic, quiet, cozy... the "What kind of date?" chips, DATE_VIBES in constants/businessVibes.js).
-- They are stored on the proposal so, when the match accepts and Nearby asks businesses on the pair's behalf, the request carries
-- exactly those qualities in its existing attributes column (create_business_request_for_match already accepts them, 20270220).
-- Nothing is inferred: a plan with no picked vibes carries none, and a date never implies Romantic. No plan kind, identity or
-- match detail reaches a business. propose_date gains a trailing attributes_param (old overload dropped, single overload).
alter table public.date_proposals add column if not exists attributes text[] not null default '{}';
alter table public.date_proposals drop constraint if exists date_proposals_attributes_check;
alter table public.date_proposals add constraint date_proposals_attributes_check
  check (attributes <@ array['casual','upscale','romantic','lively','quiet','trendy','relaxed','cozy']::text[] and cardinality(attributes) <= 8);

drop function if exists public.propose_date(uuid, text, uuid, text);

CREATE OR REPLACE FUNCTION public.propose_date(match_id_param uuid, plan_text_param text, availability_id_param uuid DEFAULT NULL::uuid, category_param text DEFAULT NULL::text, attributes_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_match record;
  v_other_id uuid;
  v_proposal_id uuid;
  v_availability_still_live boolean;
  service_key text;
  v_proposer_name text;
  v_attributes text[];
begin
  if plan_text_param is null or length(trim(plan_text_param)) = 0 then
    raise exception 'Tell your match what you have in mind.';
  end if;

  select * into v_match from matches where id = match_id_param;
  if v_match is null then
    raise exception 'Match not found.';
  end if;
  if auth.uid() <> v_match.user_a and auth.uid() <> v_match.user_b then
    raise exception 'You are not part of this match.';
  end if;
  v_other_id := case when v_match.user_a = auth.uid() then v_match.user_b else v_match.user_a end;
  if is_blocked(auth.uid(), v_other_id) then
    raise exception 'This match is no longer available.';
  end if;

  if exists (select 1 from date_proposals where match_id = match_id_param and status = 'proposed') then
    raise exception 'There is already a plan awaiting a response for this match.';
  end if;

  -- A basic, honest existence/liveness check -- not the full feasibility
  -- re-check (party size, exact distance) create_business_request_for_
  -- match's own _match_request_to_availability() call does later at
  -- actual claim time. This just stops a proposer from inviting someone
  -- to a place that's already gone by the time they hit "Propose Plan."
  if availability_id_param is not null then
    select exists (
      select 1 from business_availability
      where id = availability_id_param and status = 'active' and ends_at > now()
    ) into v_availability_still_live;
    if not v_availability_still_live then
      raise exception 'That place is no longer available -- try finding something else nearby.';
    end if;
  end if;

  -- What kind of date the proposer picked (romantic, quiet, cozy...): only what they tapped, distinct; the column CHECK refuses
  -- anything outside the date vibes. Never filled for them.
  select coalesce(array_agg(distinct a), '{}') into v_attributes from unnest(coalesce(attributes_param, '{}')) a where a is not null and length(trim(a)) > 0;

  insert into date_proposals (match_id, proposed_by, plan_text, availability_id, category, attributes)
  values (match_id_param, auth.uid(), trim(plan_text_param), availability_id_param, category_param, v_attributes)
  returning id into v_proposal_id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_proposer_name from profiles where id = auth.uid();
  if service_key is not null and coalesce((select notify_planning from profiles where id = v_other_id), true) then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_other_id,
        'title', 'A plan for you two 💌',
        'body', coalesce(v_proposer_name, 'Your match') || ' proposed a plan: "' || left(trim(plan_text_param), 60) || '"',
        'data', jsonb_build_object('type', 'date_proposal', 'proposal_id', v_proposal_id, 'match_id', match_id_param)
      )
    );
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'status', 'proposed');
end;
$function$;

revoke all on function public.propose_date(uuid, text, uuid, text, text[]) from public, anon;
grant execute on function public.propose_date(uuid, text, uuid, text, text[]) to authenticated;
