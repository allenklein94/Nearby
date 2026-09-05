-- "Business Web as an Operating System" plan (CLAUDE.md), Phase 4 -- real
-- media attach on an offer. Adds a nullable media_path/media_type pair to
-- business_request_offers (a business's own response to one specific
-- customer request) and, separately, to business_experiences (a standing
-- Signature Experience's own default creative) -- reuses this app's
-- already-established private-bucket-plus-signed-URL upload convention
-- (matching gathering-photos/profile-photos/stories), not a new storage
-- pattern. One shared bucket, business-offer-media, folder-keyed by the
-- real partner_id the caller's own profiles.managed_partner_id owns -- an
-- offer's own upload and a Signature Experience's own upload are
-- distinguished by filename prefix ('offer-*'/'experience-*'), never two
-- separate buckets, matching the locked storage-bucket design from this
-- plan's own earlier research/prep pass.

alter table business_request_offers add column if not exists media_path text;
alter table business_request_offers add column if not exists media_type text;
alter table business_request_offers drop constraint if exists business_request_offers_media_type_check;
alter table business_request_offers add constraint business_request_offers_media_type_check
  check (media_type is null or media_type in ('image', 'video'));

alter table business_experiences add column if not exists media_path text;
alter table business_experiences add column if not exists media_type text;
alter table business_experiences drop constraint if exists business_experiences_media_type_check;
alter table business_experiences add constraint business_experiences_media_type_check
  check (media_type is null or media_type in ('image', 'video'));

-- Real, private-bucket-plus-signed-URL storage, same posture as
-- gathering-photos/profile-photos/stories -- public: false at the bucket
-- level, a real SELECT RLS policy scoped `to public` (an offer/experience's
-- own promotional media is meant to be seen by whoever the offer card is
-- shown to, same reasoning "Anyone can view gathering cover photos"
-- already established), and INSERT/UPDATE scoped by the real folder-name
-- partner_id the caller's own managed_partner_id matches.
insert into storage.buckets (id, name, public)
values ('business-offer-media', 'business-offer-media', false)
on conflict (id) do nothing;

drop policy if exists "Anyone can view business offer media" on storage.objects;
create policy "Anyone can view business offer media"
  on storage.objects for select
  to public
  using (bucket_id = 'business-offer-media');

drop policy if exists "Business owners can upload their own offer media" on storage.objects;
create policy "Business owners can upload their own offer media"
  on storage.objects for insert
  to public
  with check (
    bucket_id = 'business-offer-media'
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.managed_partner_id::text = (storage.foldername(objects.name))[1]
    )
  );

drop policy if exists "Business owners can replace their own offer media" on storage.objects;
create policy "Business owners can replace their own offer media"
  on storage.objects for update
  to public
  using (
    bucket_id = 'business-offer-media'
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.managed_partner_id::text = (storage.foldername(objects.name))[1]
    )
  );

-- submit_business_offer() gains two new trailing params. Old 6-arg
-- signature explicitly DROP FUNCTIONed first, matching this schema's own
-- repeatedly-stated "an added parameter creates a distinct orphaned
-- overload" rule -- every other line of the live body (pulled fresh via
-- the Management API before writing this migration) is unchanged.
drop function if exists submit_business_offer(uuid, text, text, numeric, timestamptz, uuid);

create or replace function submit_business_offer(
  request_id_param uuid,
  offer_type_param text,
  offer_description_param text,
  offer_price_param numeric default null,
  proposed_time_param timestamptz default null,
  experience_id_param uuid default null,
  media_path_param text default null,
  media_type_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
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
      media_path = media_path_param,
      media_type = media_type_param,
      responded_at = now()
  where id = v_row.id;

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
$function$;

revoke all on function submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text) from public, anon;
grant execute on function submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text) to authenticated;

-- create_business_experience()/update_business_experience() both gain the
-- identical two trailing params -- same drop-then-recreate discipline,
-- every other line of each live body (pulled fresh via the Management API)
-- unchanged.
drop function if exists create_business_experience(uuid, text, text, text, text[], text, text, boolean);

create or replace function create_business_experience(
  partner_id_param uuid,
  title_param text,
  description_param text default null,
  icon_param text default null,
  attributes_param text[] default '{}'::text[],
  price_level_param text default null,
  party_type_param text default null,
  ai_suggested_param boolean default false,
  media_path_param text default null,
  media_type_param text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_entitlement jsonb;
  v_current_count integer;
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if title_param is null or char_length(trim(title_param)) = 0 then
    raise exception 'Title cannot be empty';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if price_level_param is not null and price_level_param not in ('free', '$', '$$', '$$$') then
    raise exception 'Invalid price level';
  end if;

  if party_type_param is not null and party_type_param not in ('solo', 'friends', 'groups', 'date') then
    raise exception 'Invalid party type';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select public.check_business_entitlement(partner_id_param, 'signature_experiences') into v_entitlement;
  if (v_entitlement ->> 'limit_value') is not null then
    select count(*) into v_current_count from business_experiences where partner_id = partner_id_param;
    if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
      raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
    end if;
  end if;

  insert into business_experiences (
    partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
  ) values (
    partner_id_param, trim(title_param), nullif(trim(coalesce(description_param, '')), ''),
    icon_param, coalesce(attributes_param, '{}'), price_level_param, party_type_param, coalesce(ai_suggested_param, false),
    media_path_param, media_type_param
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) from public, anon;
grant execute on function create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) to authenticated;

drop function if exists update_business_experience(uuid, text, text, text, text[], text, text, boolean);

create or replace function update_business_experience(
  experience_id_param uuid,
  title_param text,
  description_param text default null,
  icon_param text default null,
  attributes_param text[] default '{}'::text[],
  price_level_param text default null,
  party_type_param text default null,
  active_param boolean default true,
  media_path_param text default null,
  media_type_param text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_partner_id uuid;
begin
  select partner_id into v_partner_id from business_experiences where id = experience_id_param;

  if v_partner_id is null then
    raise exception 'Experience not found';
  end if;

  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = v_partner_id
  ) then
    raise exception 'You do not manage this business';
  end if;

  if title_param is null or char_length(trim(title_param)) = 0 then
    raise exception 'Title cannot be empty';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if price_level_param is not null and price_level_param not in ('free', '$', '$$', '$$$') then
    raise exception 'Invalid price level';
  end if;

  if party_type_param is not null and party_type_param not in ('solo', 'friends', 'groups', 'date') then
    raise exception 'Invalid party type';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  update business_experiences
  set title = trim(title_param),
      description = nullif(trim(coalesce(description_param, '')), ''),
      icon = icon_param,
      attributes = coalesce(attributes_param, '{}'),
      price_level = price_level_param,
      party_type = party_type_param,
      active = coalesce(active_param, true),
      media_path = media_path_param,
      media_type = media_type_param,
      ai_suggested = false,
      updated_at = now()
  where id = experience_id_param;
end;
$function$;

revoke all on function update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) from public, anon;
grant execute on function update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) to authenticated;

-- admin_review_business_content_screening()'s own signature is unchanged
-- (still 2 args) -- media travels via the already-jsonb content_snapshot
-- column, so this is a plain CREATE OR REPLACE, not a drop-then-recreate.
-- Every line outside the two touched branches (experience, offer_response)
-- is byte-for-byte the live body pulled fresh before writing this.
create or replace function admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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

  -- Phase 4 -- media_path/media_type now carried through both real
  -- experience write branches, from the same real content_snapshot every
  -- other field already comes from.
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

  -- Phase 4 -- media_path/media_type carried through the offer_response
  -- write too, from the same real content_snapshot every other field
  -- already comes from.
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
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
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
$function$;

revoke all on function admin_review_business_content_screening(uuid, boolean) from public, anon;
grant execute on function admin_review_business_content_screening(uuid, boolean) to authenticated;
