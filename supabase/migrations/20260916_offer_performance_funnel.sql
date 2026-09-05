-- "Business Web as an Operating System" Phase 3 (see CLAUDE.md's own plan,
-- and the Sep 15 2026 research-prep pass's own locked resolution for the
-- real design gap it found): a per-template offer-performance funnel --
-- viewed/accepted/completed counts grouped by which real
-- business_experiences row (or offer type, for an offer with no linked
-- template) generated the offer.
--
-- This needed one real, small, additive schema change first: nothing
-- linked business_request_offers back to the business_experiences row a
-- suggestion was actually applied from -- tapping a ranked Signature
-- Experience suggestion in the Make-an-Offer modal only ever prefilled the
-- description/offer-type text, the chosen experienceId (already present on
-- every suggestion object via rankExperiencesForOpportunity()) was never
-- carried through to submit_business_offer()/business_request_offers in
-- any form. Recording which already-real template was used, not
-- fabricating a new engagement metric.

alter table business_request_offers
  add column experience_id uuid references business_experiences(id) on delete set null;

-- submit_business_offer() gains a new trailing experience_id_param -- an
-- added parameter creates a distinct orphaned overload, per this schema's
-- own repeatedly-stated house rule, so the old 5-arg signature is dropped
-- first rather than left as a silent second overload. Every other line of
-- the function's real body (pulled fresh from production before writing
-- this) is unchanged.
drop function if exists submit_business_offer(uuid, text, text, numeric, timestamptz);

create or replace function submit_business_offer(
  request_id_param uuid,
  offer_type_param text,
  offer_description_param text,
  offer_price_param numeric default null,
  proposed_time_param timestamptz default null,
  experience_id_param uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_price = offer_price_param,
      proposed_time = proposed_time_param,
      experience_id = experience_id_param,
      responded_at = now()
  where id = v_row.id;

  -- Notify the consumer a real offer came in -- not gated on a dedicated
  -- notify_* preference, since none exists for this new event type;
  -- follows the same unconditional-send precedent already established for
  -- business_partner_approved/denied pushes.
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into v_partner_name from brand_partners where id = v_partner_id;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', v_requester_id,
      'title', 'New offer for your request!',
      'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(v_raw_text, 60) || '"',
      'data', jsonb_build_object('type', 'business_offer_received', 'request_id', request_id_param, 'offer_id', v_row.id)
    )
  );

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$$;

revoke all on function submit_business_offer(uuid, text, text, numeric, timestamptz, uuid) from public, anon;
grant execute on function submit_business_offer(uuid, text, text, numeric, timestamptz, uuid) to authenticated;

-- admin_review_business_content_screening()'s own offer_response approve
-- branch does a raw UPDATE on business_request_offers directly (not via
-- submit_business_offer(), since the caller there is the reviewing admin,
-- not the business owner) -- it gains the same experience_id carry-through,
-- read back from the real staged content_snapshot. Same 2-arg signature,
-- pulled fresh from its live body first -- every other line is byte-for-
-- byte unchanged, only the one new assignment in the offer_response branch
-- was added.
create or replace function admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
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
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
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

-- The real, new rollup itself: viewed/accepted/completed counts grouped by
-- which real business_experiences row (or offer type, when no template was
-- linked) generated the offer. Owner-only -- returns nothing for a caller
-- who doesn't manage partner_id_param, matching every sibling business RPC
-- in this schema, rather than raising. Only counts a real offer that
-- actually reached the business owner's own response (status in
-- 'offered'/'accepted'/'declined'/'expired'/'cancelled'/'completed') --
-- a still-'pending' opportunity has no real offer_type/description yet, so
-- including it would misattribute an unanswered opportunity to the
-- 'standard' offer-type bucket.
create or replace function get_partner_offer_performance(partner_id_param uuid)
returns table (
  group_key text,
  group_label text,
  offer_count bigint,
  viewed_count bigint,
  accepted_count bigint,
  completed_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select
    coalesce(bro.experience_id::text, 'offer_type:' || coalesce(bro.offer_type, 'standard')) as group_key,
    -- min(bro.offer_type) rather than a bare column reference -- an
    -- experience-linked group can legitimately have offers of different
    -- offer_type across separate submissions (the same template used with
    -- a different offer shape each time), so this branch of the coalesce
    -- is only ever actually reached (and only ever meaningful) once every
    -- row in the group already shares one real offer_type -- the
    -- no-template ('offer_type:*') branch, where the aggregate is a no-op.
    coalesce(be.title, initcap(replace(coalesce(min(bro.offer_type), 'standard'), '_', ' '))) as group_label,
    count(*)::bigint as offer_count,
    count(*) filter (where bro.viewed_at is not null)::bigint as viewed_count,
    count(*) filter (where bro.status in ('accepted', 'completed'))::bigint as accepted_count,
    count(*) filter (where bro.status = 'completed')::bigint as completed_count
  from business_request_offers bro
  left join business_experiences be on be.id = bro.experience_id
  where bro.partner_id = partner_id_param
    and bro.status in ('offered', 'accepted', 'declined', 'expired', 'cancelled', 'completed')
  group by
    coalesce(bro.experience_id::text, 'offer_type:' || coalesce(bro.offer_type, 'standard')),
    be.title
  order by offer_count desc;
end;
$$;

revoke all on function get_partner_offer_performance(uuid) from public, anon;
grant execute on function get_partner_offer_performance(uuid) to authenticated;
