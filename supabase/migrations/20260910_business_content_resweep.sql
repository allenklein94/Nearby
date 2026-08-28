-- Decision 6 (CLAUDE.md's Aug 27 2026 plan), Phase 5: the periodic
-- re-sweep job. Closes the locked design's own explicit gap -- everything
-- built in Phases 1-4 is real-time-on-write only ("a legitimate business
-- later edits its own description/offer into something prohibited...
-- nothing in this app currently re-checks for") -- this adds the genuine
-- defense-in-depth re-check on a real schedule.
--
-- Real design decisions locked in CLAUDE.md's own Phase 5 plan text,
-- restated briefly here so this migration is legible on its own:
--   1. What gets re-swept: business_profile, experience, offer,
--      availability -- the four genuinely ongoing, currently-live content
--      types. `update` (an already-delivered broadcast) and
--      `offer_response` (a committed reply to one specific request) are
--      both real, one-time messages, not ongoing published state --
--      deliberately excluded, not an oversight.
--   2. "Due for re-screening": the most recent screening row for that
--      target (of either source, submission or resweep) is more than 30
--      real days old, or doesn't exist at all (prioritized first). A
--      real bounded batch (25 rows) per run.
--   3. Cadence: submit runs daily (04:00 UTC), apply runs every 5
--      minutes, matching the weather job's own established apply cadence.
--   4. Enforcement -- the one real, safety-motivated departure from the
--      plan's own literal "HIGH -> block/quarantine outright" wording:
--      for a re-sweep result specifically, every non-LOW tier
--      (medium/high/uncertain) is held for a real human decision -- none
--      auto-quarantines already-live content, HIGH included. Automatically
--      taking down a real business's real, already-serving listing on a
--      periodic AI re-check, with no human in the loop for the takedown
--      itself, is exactly the kind of consequential, false-positive-prone
--      automated action Decision 6's own core "AI is a screening signal,
--      never the final legal authority" principle argues against.
--   5. Admin approve/deny for a re-sweep row is genuinely inverted from a
--      submission row's semantics: a re-sweep row's snapshot IS the
--      current live content -- there's nothing new to publish, and
--      blindly re-applying an older re-sweep snapshot risks silently
--      reverting a genuinely newer edit the business made in the
--      meantime. Neither approve nor deny ever writes to the live
--      business-content table for a re-sweep row -- "approve" means
--      "false alarm, dismiss," "deny" means "confirmed real problem,
--      needs manual follow-up outside this automated system."

-- ---------- business_content_screening_results: real `source` column ----------
alter table business_content_screening_results
  add column if not exists source text not null default 'submission';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_content_screening_results_source_check'
  ) then
    alter table business_content_screening_results
      add constraint business_content_screening_results_source_check
      check (source in ('submission', 'resweep'));
  end if;
end $$;

-- ---------- record_business_content_screening(): gains source_param ----------
-- An added parameter changes the function's signature -- a bare
-- `create or replace` would leave the old 8-arg overload orphaned rather
-- than truly replacing it (this schema's own repeatedly-learned lesson,
-- e.g. update_business_profile's own trailing-param addition) -- so the
-- old signature is explicitly dropped first.
drop function if exists record_business_content_screening(uuid, text, uuid, uuid, jsonb, text, text[], text);

create function record_business_content_screening(
  partner_id_param uuid,
  target_type_param text,
  target_id_param uuid,
  submitted_by_param uuid,
  content_snapshot_param jsonb,
  risk_tier_param text,
  matched_categories_param text[],
  model_reasoning_param text,
  source_param text default 'submission'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_review_outcome text;
begin
  -- Locked decision 4 above: only a submission-source HIGH result
  -- auto-resolves at insert time (nothing was ever live, rejecting it
  -- costs nothing). A re-sweep HIGH means already-live content just got
  -- flagged -- stays genuinely un-auto-resolved (review_outcome null) so
  -- it reaches the real admin queue instead.
  v_review_outcome := case when risk_tier_param = 'high' and source_param = 'submission' then 'auto_blocked' else null end;

  insert into business_content_screening_results (
    partner_id, target_type, target_id, submitted_by, content_snapshot,
    risk_tier, matched_categories, model_reasoning, review_outcome,
    reviewed_at, source
  ) values (
    partner_id_param, target_type_param, target_id_param, submitted_by_param, content_snapshot_param,
    risk_tier_param, matched_categories_param, model_reasoning_param, v_review_outcome,
    case when v_review_outcome is not null then now() else null end,
    source_param
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_business_content_screening(uuid, text, uuid, uuid, jsonb, text, text[], text, text) from public, anon, authenticated;
grant execute on function record_business_content_screening(uuid, text, uuid, uuid, jsonb, text, text[], text, text) to service_role;

-- ---------- admin_get_pending_content_screenings(): widened filter + source column ----------
-- Adding a real output column changes the function's return type -- same
-- "drop before create, don't leave an orphaned overload" discipline as
-- above (this one's own precedent: get_aggregated_demand_for_partner()'s
-- own drop-before-create when it gained more return columns).
drop function if exists admin_get_pending_content_screenings();

create function admin_get_pending_content_screenings()
returns table (
  id uuid,
  partner_id uuid,
  partner_name text,
  target_type text,
  target_id uuid,
  content_snapshot jsonb,
  risk_tier text,
  matched_categories text[],
  model_reasoning text,
  created_at timestamptz,
  source text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view the content review queue';
  end if;

  return query
  select
    s.id, s.partner_id, bp.name, s.target_type, s.target_id, s.content_snapshot,
    s.risk_tier, s.matched_categories, s.model_reasoning, s.created_at, s.source
  from business_content_screening_results s
  join brand_partners bp on bp.id = s.partner_id
  -- Widened per locked decision 4: a resweep-source HIGH row now also
  -- belongs in this queue (never auto-resolved, per the function above),
  -- alongside the existing medium/uncertain rows from either source.
  where s.review_outcome is null
    and (s.risk_tier in ('medium', 'uncertain') or (s.risk_tier = 'high' and s.source = 'resweep'))
  order by s.created_at asc;
end;
$$;

revoke all on function admin_get_pending_content_screenings() from public, anon;
grant execute on function admin_get_pending_content_screenings() to authenticated;

-- ---------- admin_review_business_content_screening(): resweep short-circuit ----------
-- Pulled the *live* function body fresh via the Management API before
-- editing (confirmed byte-identical to the committed Phase 3 migration) --
-- every line of the existing business_profile/experience/offer/
-- availability/update/offer_response branches and the closing status
-- update is unchanged; the only real addition is the new short-circuit
-- block, inserted right after the existing double-review guard. Args are
-- unchanged (still screening_id_param uuid, approve_param boolean), so
-- `create or replace` genuinely replaces this one -- no drop needed.
create or replace function admin_review_business_content_screening(
  screening_id_param uuid,
  approve_param boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  -- Locked decision 5 above -- a re-sweep row's own content_snapshot IS
  -- the current live content, so neither approve nor deny ever writes to
  -- the live business-content table here. "Approve" = false alarm,
  -- dismiss. "Deny" = confirmed real problem, needs manual follow-up
  -- outside this automated system (a real admin using their own existing
  -- tools -- contacting the business, or a future dedicated per-row
  -- quarantine action, explicitly not built this pass). Short-circuits
  -- every target-type-specific write branch below, regardless of
  -- approve_param.
  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := now();
    v_ends_at := case
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15)
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select name into v_partner_name from brand_partners where id = v_row.partner_id;
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester_id,
        'title', 'New offer for your request!',
        'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"',
        'data', jsonb_build_object('type', 'business_offer_received', 'request_id', nullif(v_row.content_snapshot->>'requestId', '')::uuid)
      )
    );
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$$;

revoke all on function admin_review_business_content_screening(uuid, boolean) from public, anon;
grant execute on function admin_review_business_content_screening(uuid, boolean) to authenticated;

-- ---------- business_content_resweep_queue ----------
-- Same real shape/posture as weather_dependent_policy_refresh_queue:
-- RLS enabled, zero policies, cron/SECURITY-DEFINER-only -- nothing here
-- is ever meant to be readable by a real client.
create table if not exists public.business_content_resweep_queue (
  id bigint generated by default as identity primary key,
  target_type text not null,
  target_id uuid,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  request_id bigint not null,
  submitted_at timestamptz not null default now()
);

alter table public.business_content_resweep_queue enable row level security;

-- ---------- submit_business_content_resweeps() ----------
-- Cron-only, once daily. Selects the real due batch (locked decision 2
-- above -- most recent screening row of either source more than 30 real
-- days old, or none at all, prioritized first; a real bounded batch of
-- 25), fires one real net.http_post per row to the new
-- resweep-business-content Edge Function (the real service_role_key
-- vault secret as the Bearer token, same pattern notify_video_call_
-- started() already established for an internal Edge Function call from
-- SQL), records the pending request, and returns immediately -- never
-- polls inside its own transaction (this codebase's own already-learned
-- lesson: a single Postgres transaction can't reliably wait on a
-- synchronous external HTTP call). A candidate already sitting in the
-- queue from a still-resolving prior submission is skipped, so a normal
-- run can never duplicate an in-flight request.
create or replace function public.submit_business_content_resweeps()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  service_key text;
  v_candidate record;
  v_request_id bigint;
  v_submitted_count integer := 0;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_candidate in
    with candidates as (
      select 'business_profile'::text as target_type, null::uuid as target_id, bp.id as partner_id
      from brand_partners bp
      where bp.active = true

      union all

      select 'experience'::text, be.id, be.partner_id
      from business_experiences be
      where be.active = true

      union all

      select 'offer'::text, bo.id, bo.partner_id
      from brand_offers bo
      where bo.active = true

      union all

      select 'availability'::text, ba.id, ba.partner_id
      from business_availability ba
      where ba.status = 'active'
    ),
    latest_screening as (
      select distinct on (c.target_type, c.target_id, c.partner_id)
        c.target_type, c.target_id, c.partner_id, s.created_at as last_screened_at
      from candidates c
      left join business_content_screening_results s
        on s.partner_id = c.partner_id
        and s.target_type = c.target_type
        and s.target_id is not distinct from c.target_id
      order by c.target_type, c.target_id, c.partner_id, s.created_at desc nulls last
    )
    select ls.target_type, ls.target_id, ls.partner_id, ls.last_screened_at
    from latest_screening ls
    where (ls.last_screened_at is null or ls.last_screened_at < now() - interval '30 days')
      and not exists (
        select 1 from business_content_resweep_queue q
        where q.target_type = ls.target_type
          and q.partner_id = ls.partner_id
          and q.target_id is not distinct from ls.target_id
      )
    order by ls.last_screened_at asc nulls first
    limit 25
  loop
    select net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/resweep-business-content',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'targetType', v_candidate.target_type,
        'targetId', v_candidate.target_id,
        'partnerId', v_candidate.partner_id
      )
    ) into v_request_id;

    insert into business_content_resweep_queue (target_type, target_id, partner_id, request_id, submitted_at)
    values (v_candidate.target_type, v_candidate.target_id, v_candidate.partner_id, v_request_id, now());

    v_submitted_count := v_submitted_count + 1;
  end loop;

  return v_submitted_count;
end;
$function$;

revoke all on function public.submit_business_content_resweeps() from public, anon, authenticated;

-- ---------- apply_business_content_resweeps() ----------
-- Cron-only, every 5 minutes (matching the weather job's own established
-- apply cadence -- cheap when nothing's pending). The real classify-and-
-- log write already happens inside resweep-business-content itself, so
-- this only needs to know a request finished (any response, success or
-- failure, means pg_net's worker has resolved it) so it can clear the
-- queue. A genuinely stale (>10 real minutes) pending row is discarded
-- without further action, same "stale, never silently wrong" convention
-- the weather job already established -- a still-due target just gets
-- picked up again on a future daily submit run, since no new screening
-- row was ever written for it.
create or replace function public.apply_business_content_resweeps()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pending record;
  v_resolved boolean;
  v_applied_count integer := 0;
begin
  for v_pending in
    select * from business_content_resweep_queue
  loop
    select exists(select 1 from net._http_response where id = v_pending.request_id) into v_resolved;

    if v_resolved then
      delete from business_content_resweep_queue where id = v_pending.id;
      v_applied_count := v_applied_count + 1;
    elsif v_pending.submitted_at <= now() - interval '10 minutes' then
      delete from business_content_resweep_queue where id = v_pending.id;
    end if;
  end loop;

  return v_applied_count;
end;
$function$;

revoke all on function public.apply_business_content_resweeps() from public, anon, authenticated;

select cron.schedule(
  'submit-business-content-resweeps',
  '0 4 * * *',
  $$select public.submit_business_content_resweeps();$$
);

select cron.schedule(
  'apply-business-content-resweeps',
  '*/5 * * * *',
  $$select public.apply_business_content_resweeps();$$
);
