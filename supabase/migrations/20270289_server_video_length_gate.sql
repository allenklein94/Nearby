-- Server-side video length gate (owner, 2026-10-10, Option A, LOCKED).
--
-- screen-business-content now reads every uploaded video's own timing boxes (MP4 / MOV only) BEFORE content screening and
-- refuses a video over 30 s, or one whose length is missing, contradictory or unreadable. Only a video that passed is
-- recorded here, by the service role. The database then refuses, on every write path:
--   * a VIDEO creative becoming 'ready' without that record (library items, and the offer path's own save);
--   * a VIDEO on an offer without that record, and without either a ready creative for that same file (= it also passed
--     content screening) or the team publishing that held item through the review function.
-- So a direct API call (submit_business_offer is callable by a signed-in owner) can never put an unchecked or unscreened
-- video in front of a customer. Images are unchanged. Offer media files are write-once (20270288), so a checked file cannot
-- be replaced by a different one under the same path. Production has 0 videos on creatives and 0 on offers (checked), so
-- nothing existing is refused.

create table if not exists public.business_video_checks (
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  media_path text not null,
  duration_ms integer not null check (duration_ms > 0 and duration_ms <= 30000),
  checked_at timestamptz not null default now(),
  primary key (partner_id, media_path)
);
alter table public.business_video_checks enable row level security;
revoke all on public.business_video_checks from public, anon, authenticated;
grant select, insert, update, delete on public.business_video_checks to service_role;

create or replace function public._video_length_checked(partner uuid, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from business_video_checks c where c.partner_id = partner and c.media_path = path)
$$;
revoke all on function public._video_length_checked(uuid, text) from public, anon, authenticated;

-- A video creative may only be 'ready' once its length was checked on the server.
create or replace function public._creative_video_must_be_checked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.media_type = 'video' and new.status = 'ready' and not public._video_length_checked(new.partner_id, new.media_path) then
    raise exception 'We couldn''t check this video''s length.';
  end if;
  return new;
end;
$$;
revoke all on function public._creative_video_must_be_checked() from public, anon, authenticated;

drop trigger if exists creative_video_must_be_checked on public.business_creatives;
create trigger creative_video_must_be_checked
  before insert or update of status, media_path, media_type on public.business_creatives
  for each row execute function public._creative_video_must_be_checked();

-- A video on an offer needs the length record AND proof it passed content screening: a ready, live creative of the same
-- business for that same file, or the team publishing that exact held item through admin_review_business_content_screening
-- (which sets app.reviewed_offer_media for its own transaction; being an admin is NOT enough: an admin may also own a
-- business and must not be able to skip screening with a direct call).
create or replace function public._offer_video_must_be_cleared()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.media_type is distinct from 'video' or new.media_path is null then return new; end if;
  if tg_op = 'UPDATE' and new.media_path is not distinct from old.media_path and new.media_type is not distinct from old.media_type then
    return new;
  end if;
  if not public._video_length_checked(new.partner_id, new.media_path) then
    raise exception 'We couldn''t check this video''s length.';
  end if;
  if not exists (
       select 1 from business_creatives c
        where c.partner_id = new.partner_id and c.media_path = new.media_path
          and c.status = 'ready' and c.archived_at is null)
     and coalesce(current_setting('app.reviewed_offer_media', true), '') is distinct from new.media_path then
    raise exception 'That video has not been approved yet.';
  end if;
  return new;
end;
$$;
revoke all on function public._offer_video_must_be_cleared() from public, anon, authenticated;

drop trigger if exists offer_video_must_be_cleared on public.business_request_offers;
create trigger offer_video_must_be_cleared
  before insert or update of media_path, media_type on public.business_request_offers
  for each row execute function public._offer_video_must_be_cleared();

-- The review function, patched from its live body (same signature): one set_config line before it publishes a held offer
-- response.
CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
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
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
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
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
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
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
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
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
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
    v_starts_at := coalesce(nullif(v_row.content_snapshot->>'startsAt', '')::timestamptz, now());
    v_ends_at := case
      when nullif(v_row.content_snapshot->>'endsAt', '') is not null then (v_row.content_snapshot->>'endsAt')::timestamptz
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;
    if v_ends_at <= now() then
      raise exception 'This availability window has already passed -- it could not be published.';
    end if;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components, discount_pct
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
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      ),
      nullif(v_row.content_snapshot->>'discountPct', '')::numeric
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

    if nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz <= now() then
      raise exception 'This offer''s end time has already passed -- it could not be published.';
    end if;
    v_offer_title := nullif(trim(coalesce(v_row.content_snapshot->>'offerTitle', '')), '');

    -- Same trim + blank-filter discipline as submit_business_offer/
    -- create_occasion_package -- never a second, laxer validation rule
    -- for the identical real shape just because it arrived via a
    -- different write path (found live via Test 4 below: an earlier
    -- draft of this branch skipped the filter and let a blank jsonb
    -- array entry survive as a literal empty-string item).
    select array_agg(trim(item)) into v_items
    from jsonb_array_elements_text(coalesce(v_row.content_snapshot->'includedItems', '[]'::jsonb)) as item
    where length(trim(item)) > 0;

    -- 20270289: the team is publishing THIS held item; the offer video gate accepts its (length-checked) media for this
    -- transaction only. Nothing a client can call sets this.
    perform set_config('app.reviewed_offer_media', coalesce(v_row.content_snapshot->>'mediaPath', ''), true);

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_title = v_offer_title,
        included_items = coalesce(v_items, '{}'::text[]),
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        price_is_per_person = coalesce((v_row.content_snapshot->>'priceIsPerPerson')::boolean, false),
        discount_pct = nullif(v_row.content_snapshot->>'discountPct', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        media_poster_path = case when v_row.content_snapshot->>'mediaType' = 'video' then nullif(v_row.content_snapshot->>'posterPath', '') else null end,
        redemption_instructions = nullif(trim(coalesce(v_row.content_snapshot->>'redemptionInstructions', '')), ''),
        creative_id = nullif(v_row.content_snapshot->>'creativeId', '')::uuid,
        valid_until = nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz,
        available_from = nullif(v_row.content_snapshot->>'availableFrom', '')::time,
        available_until = nullif(v_row.content_snapshot->>'availableUntil', '')::time,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    perform set_config('app.reviewed_offer_media', '', true);

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    -- Item 125: the same BUSINESS_OFFER_SENT event as a direct reply.
    perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', o.id, null,
      'admin_review_business_content_screening',
      jsonb_build_object('request_id', o.request_id, 'partner_id', o.partner_id, 'offer_id', o.id),
      'BUSINESS_OFFER_SENT:' || o.id)
    from business_request_offers o
    where o.request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid and o.partner_id = v_row.partner_id;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;
