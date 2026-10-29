-- Rollback for migration 20270359 (trusted-write flag scope): puts back the 24 definitions exactly as they were after
-- 20270358 (the transaction-long flag, i.e. the leak described in 20270359). Only if a function misbehaves with the restore;
-- re-apply 20270359 as soon as possible. Grants are untouched by CREATE OR REPLACE.

-- _claim_web_business_requests(uuid)
CREATE OR REPLACE FUNCTION public._claim_web_business_requests(profile_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  profile_phone text;
  req record;
begin
  select phone into profile_phone from auth.users where id = profile_id_param;
  if profile_phone is null then
    return;
  end if;

  for req in
    select * from business_partner_requests
    where source = 'web'
      and status = 'approved'
      and claimed_at is null
      and resulting_partner_id is not null
      and applicant_phone = profile_phone
  loop
    perform set_config('app.trusted_update', 'true', true);
    update profiles set managed_partner_id = req.resulting_partner_id where id = profile_id_param;
    update gatherings set hosting_partner_id = req.resulting_partner_id where host_id = profile_id_param and hosting_partner_id is null;
    update communities set hosting_partner_id = req.resulting_partner_id where creator_id = profile_id_param and hosting_partner_id is null;
    update business_partner_requests set claimed_at = now() where id = req.id;
  end loop;
end;
$function$;

-- admin_approve_id_verification(uuid,boolean)
CREATE OR REPLACE FUNCTION public.admin_approve_id_verification(submission_id_param uuid, approved boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can review verification submissions';
  end if;

  if exists (select 1 from id_verification_submissions where id = submission_id_param and user_id = auth.uid()) then
    raise exception 'You can''t review your own verification' using errcode = '42501', hint = 'own_submission';
  end if;

  update id_verification_submissions
  set status = case when approved then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = submission_id_param and status = 'pending'
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Submission not found or already reviewed';
  end if;

  if approved then
    perform set_config('app.trusted_update', 'true', true);
    update profiles set id_verified = true, id_verified_at = now() where id = v_user_id;
    perform set_config('app.trusted_update', 'false', true);
  end if;
end;
$function$;

-- admin_map_business_category(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.admin_map_business_category(request_id_param uuid, category_param text, subcategory_param text DEFAULT NULL::text, alias_phrase_param text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  alias_phrase text := nullif(lower(btrim(coalesce(alias_phrase_param, ''))), '');
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can map business categories';
  end if;
  if not exists (select 1 from category_tag_groups where group_key = category_param)
     and category_param not in ('home_local_services', 'auto_transportation', 'health_personal_care') then
    raise exception 'Unknown category';
  end if;
  if subcategory_param is not null
     and not exists (select 1 from category_tag_groups where tag = subcategory_param and group_key = category_param) then
    raise exception 'That subcategory does not belong to this category';
  end if;
  if alias_phrase is not null and char_length(alias_phrase) not between 2 and 60 then
    raise exception 'A remembered phrase must be 2 to 60 characters';
  end if;

  select * into req from business_partner_requests where id = request_id_param;
  if req is null then
    raise exception 'Request not found';
  end if;

  update business_partner_requests
  set category = category_param, subcategory = subcategory_param
  where id = request_id_param;

  if req.resulting_partner_id is not null then
    perform set_config('app.trusted_update', 'true', true);
    update brand_partners
    set category = category_param, subcategory = subcategory_param
    where id = req.resulting_partner_id;
  end if;

  if alias_phrase is not null then
    insert into category_aliases (phrase, category, subcategory, created_by)
    values (alias_phrase, category_param, subcategory_param, auth.uid())
    on conflict (phrase) do update
      set category = excluded.category, subcategory = excluded.subcategory, created_by = excluded.created_by;
  end if;
end;
$function$;

-- admin_reinstate_user(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_reinstate_user(user_id_param uuid, reason_param text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := auth.uid();
  v_suspended_at timestamptz;
  v_prev_hidden boolean;
  v_reason text := nullif(btrim(coalesce(reason_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Only admins can reinstate accounts' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A reason is required' using errcode = '22023', hint = 'reason_required';
  end if;

  select suspended_at into v_suspended_at from profiles where id = user_id_param for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_suspended_at is null then
    return jsonb_build_object('suspended', false, 'already', true);
  end if;

  select previous_profile_hidden into v_prev_hidden from account_moderation_actions
  where user_id = user_id_param and action = 'suspend' order by created_at desc limit 1;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set suspended_at = null, profile_hidden = coalesce(v_prev_hidden, false) where id = user_id_param;
  perform set_config('app.trusted_update', 'false', true);
  update auth.users set banned_until = null where id = user_id_param;

  insert into account_moderation_actions (user_id, action, reason, admin_id)
  values (user_id_param, 'reinstate', v_reason, v_admin);

  return jsonb_build_object('suspended', false, 'already', false);
end;
$function$;

-- admin_resolve_emerging_category(text,text,text)
CREATE OR REPLACE FUNCTION public.admin_resolve_emerging_category(phrase_key_param text, tag_param text, group_key_param text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text := btrim(lower(coalesce(phrase_key_param, '')));
  v_tag text := regexp_replace(btrim(coalesce(tag_param, '')), '\s+', ' ', 'g');
  v_existing record;
  v_count int;
  v_keys text[];
  v_words text[];
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can resolve category suggestions';
  end if;
  -- The threshold is enforced here too: only a currently flagged candidate can be resolved.
  if not exists (select 1 from public.admin_get_emerging_categories() e where e.phrase_key = v_key) then
    raise exception 'This suggestion has not reached the threshold, or was already handled';
  end if;
  select tag, group_key into v_existing from category_tag_groups where lower(tag) = lower(v_tag);
  if v_existing.tag is not null then
    if v_existing.group_key <> group_key_param then
      raise exception 'That category already exists under a different group';
    end if;
    v_tag := v_existing.tag;
  else
    v_tag := public.admin_add_category_tag(v_tag, group_key_param);
  end if;

  select array_agg(distinct own_key), array_agg(distinct wording) into v_keys, v_words from public._category_candidate_rows() where cluster_key = v_key;
  perform set_config('app.trusted_update', 'true', true);
  update brand_partners set category = group_key_param, subcategory = v_tag
  where id in (select r.resulting_partner_id from business_partner_requests r
               join public._category_candidate_rows() c on c.request_id = r.id
               where c.cluster_key = v_key and r.resulting_partner_id is not null);
  with u as (
    update business_partner_requests r set category = group_key_param, subcategory = v_tag
    from public._category_candidate_rows() c
    where c.request_id = r.id and c.cluster_key = v_key
    returning 1
  ) select count(*) into v_count from u;

  -- Remember every wording key that was in the cluster, so future text gets the suggestion.
  insert into category_aliases (phrase, category, subcategory, created_by)
  select distinct left(k, 60), group_key_param, v_tag, auth.uid()
  from unnest(array_append(v_keys, v_key)) as k
  where k <> ''
  on conflict (phrase) do update set category = excluded.category, subcategory = excluded.subcategory;
  -- Add once, understood everywhere: the wordings the businesses used become search synonyms of the new tag too.
  insert into category_synonyms (phrase, tag)
  select distinct public._category_search_key(w), v_tag from unnest(v_words) w
  where char_length(public._category_search_key(w)) between 2 and 60
    and public._category_search_key(w) <> public._category_search_key(v_tag)
  on conflict do nothing;
  return v_count;
end $function$;

-- admin_suspend_user(uuid,text,uuid,boolean)
CREATE OR REPLACE FUNCTION public.admin_suspend_user(user_id_param uuid, reason_param text, report_id_param uuid DEFAULT NULL::uuid, end_sessions_param boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := auth.uid();
  v_prev_hidden boolean;
  v_suspended_at timestamptz;
  v_reason text := nullif(btrim(coalesce(reason_param, '')), '');
begin
  if v_admin is null or not check_is_admin(v_admin) then
    raise exception 'Only admins can suspend accounts' using errcode = '42501';
  end if;
  if user_id_param = v_admin then
    raise exception 'You can''t suspend your own account' using errcode = '42501', hint = 'own_account';
  end if;
  if v_reason is null then
    raise exception 'A reason is required' using errcode = '22023', hint = 'reason_required';
  end if;
  if report_id_param is not null and not exists (select 1 from reports where id = report_id_param and reported_id = user_id_param) then
    raise exception 'That report is not about this account' using errcode = '22023', hint = 'report_mismatch';
  end if;

  select coalesce(profile_hidden, false), suspended_at into v_prev_hidden, v_suspended_at
  from profiles where id = user_id_param for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_suspended_at is not null then
    return jsonb_build_object('suspended', true, 'already', true, 'suspended_at', v_suspended_at);
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set suspended_at = now(), profile_hidden = true where id = user_id_param
  returning suspended_at into v_suspended_at;
  perform set_config('app.trusted_update', 'false', true);

  if end_sessions_param then
    update auth.users set banned_until = now() + interval '100 years' where id = user_id_param;
    delete from auth.sessions where user_id = user_id_param;
  end if;

  insert into account_moderation_actions (user_id, action, reason, report_id, admin_id, sessions_ended, previous_profile_hidden)
  values (user_id_param, 'suspend', v_reason, report_id_param, v_admin, end_sessions_param, v_prev_hidden);

  return jsonb_build_object('suspended', true, 'already', false, 'suspended_at', v_suspended_at, 'sessions_ended', end_sessions_param);
end;
$function$;

-- approve_business_partner_request(uuid)
CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  new_partner_id uuid;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory, categories, location_source, google_place_id)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory, req.categories,
          case when req.latitude is null then null else req.location_source end, req.google_place_id)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_partner_id = new_partner_id
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  if req.source = 'web' and req.applicant_phone is not null then
    select id into matched_profile_id from auth.users where phone = req.applicant_phone limit 1;
    if matched_profile_id is not null then
      perform public._claim_web_business_requests(matched_profile_id);
    end if;
  end if;

  if true then
    perform public._send_push(req.requester_id, 'You''re approved as a partner! 🎉', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id));
  end if;

  return new_partner_id;
end;
$function$;

-- cancel_community(uuid)
CREATE OR REPLACE FUNCTION public.cancel_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_name text;
  member_row record;
  v_accepted_offer record;
  v_cancel_result jsonb;
  v_request record;
  v_managing_profiles uuid[];
begin
  select status, name into v_status, v_name from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This community is already cancelled.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'cancelled' where id = community_id_param;
  perform _record_cancellation('community', community_id_param, null, 'host');


  for v_accepted_offer in
    select o.id as offer_id, o.partner_id, o.request_id
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where r.community_id = community_id_param and o.status = 'accepted'
  loop
    select * into v_request from business_requests where id = v_accepted_offer.request_id;
    v_cancel_result := _cancel_reservation_by_offer(v_accepted_offer.offer_id);
    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_accepted_offer.partner_id;

    if (v_cancel_result->>'cancelled')::boolean then
      if v_request.requester_id <> auth.uid() and coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled', 'The community "' || v_name || '" was cancelled, so your reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'A reservation was cancelled', 'The community "' || v_name || '" was cancelled, so the reservation for "' || left(v_request.raw_text, 60) || '" was cancelled too.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    elsif v_cancel_result->>'reason' = 'payment_captured' then
      if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation', 'The community "' || v_name || '" was cancelled, but you already paid for "' || left(v_request.raw_text, 60) || '" -- contact the business directly to arrange a refund.', jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
      end if;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'A community was cancelled', 'The community behind an already-paid reservation for "' || left(v_request.raw_text, 60) || '" was cancelled -- the customer may reach out about a refund.', jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_accepted_offer.offer_id));
        end loop;
      end if;
    end if;
  end loop;

  update business_requests set status = 'cancelled'
    where community_id = community_id_param and status = 'open';
  update business_request_offers set status = 'cancelled'
    where request_id in (select id from business_requests where community_id = community_id_param)
      and status in ('pending', 'offered');

  for member_row in
    select user_id from community_members where community_id = community_id_param and user_id <> auth.uid()
  loop
    continue when not coalesce((select notify_community from profiles where id = member_row.user_id), true);
    perform public._send_push(member_row.user_id, 'A community was cancelled', '"' || v_name || '" has been cancelled by its creator.', jsonb_build_object('type', 'community_cancelled'));
  end loop;

  return jsonb_build_object('success', true);
end;
$function$;

-- check_and_increment_ai_use(uuid,integer)
CREATE OR REPLACE FUNCTION public.check_and_increment_ai_use(user_id_param uuid, daily_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
begin
  if auth.uid() is not null and auth.uid() <> user_id_param then
    return false;
  end if;
  select ai_uses_today, ai_uses_date, coalesce(timezone, 'UTC') into v_current_count, v_current_date, v_timezone
  from profiles where id = user_id_param for update;
  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;
  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;
  if v_current_count >= daily_limit then
    return false;
  end if;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set ai_uses_today = v_current_count + 1, ai_uses_date = v_today_in_user_tz
  where id = user_id_param;
  return true;
end;
$function$;

-- enforce_community_daily_limit()
CREATE OR REPLACE FUNCTION public.enforce_community_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 3;
begin
  select communities_created_today, communities_created_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.creator_id for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can create up to % communities per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set communities_created_today = v_current_count + 1, communities_created_date = v_today_in_user_tz
  where id = new.creator_id;

  return new;
end;
$function$;

-- enforce_friend_request_daily_limit()
CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 15;
begin
  if coalesce(current_setting('app.trusted_update', true), '') = 'true' then
    return new;
  end if;

  select friend_requests_sent_today, friend_requests_sent_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.requested_by for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can send up to % friend requests per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set friend_requests_sent_today = v_current_count + 1, friend_requests_sent_date = v_today_in_user_tz
  where id = new.requested_by;
  perform set_config('app.trusted_update', 'false', true);

  return new;
end;
$function$;

-- enforce_gathering_daily_limit()
CREATE OR REPLACE FUNCTION public.enforce_gathering_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 10;
begin
  select gatherings_created_today, gatherings_created_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.host_id for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can create up to % gatherings per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set gatherings_created_today = v_current_count + 1, gatherings_created_date = v_today_in_user_tz
  where id = new.host_id;

  return new;
end;
$function$;

-- enforce_story_daily_limit()
CREATE OR REPLACE FUNCTION public.enforce_story_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
  v_daily_limit integer := 20;
begin
  select stories_posted_today, stories_posted_date, coalesce(timezone, 'UTC')
  into v_current_count, v_current_date, v_timezone
  from profiles where id = new.user_id for update;

  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;

  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;

  if v_current_count >= v_daily_limit then
    raise exception 'You can post up to % stories per day. Try again tomorrow.', v_daily_limit;
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set stories_posted_today = v_current_count + 1, stories_posted_date = v_today_in_user_tz
  where id = new.user_id;

  return new;
end;
$function$;

-- grant_referral_bonus(text)
CREATE OR REPLACE FUNCTION public.grant_referral_bonus(code_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_referrer_id uuid;
begin
  select id into v_referrer_id from profiles where referral_code = upper(trim(code_param));
  if v_referrer_id is null then
    raise exception 'That code doesn''t match any account.';
  end if;
  if v_referrer_id = auth.uid() then
    raise exception 'You can''t use your own referral code.';
  end if;

  -- Unique constraint on referred_id raises 23505 (propagated to the
  -- caller as-is) if this user has already redeemed a code -- same
  -- anti-fraud gate the old client code relied on.
  insert into referral_redemptions (referrer_id, referred_id) values (v_referrer_id, auth.uid());

  perform set_config('app.trusted_update', 'true', true);
  update profiles set referred_by = v_referrer_id where id = auth.uid();
  update profiles set bonus_notices = coalesce(bonus_notices, 0) + 3 where id = v_referrer_id;
  update profiles set bonus_notices = coalesce(bonus_notices, 0) + 3 where id = auth.uid();
end;
$function$;

-- increment_browse_views(uuid,integer,integer)
CREATE OR REPLACE FUNCTION public.increment_browse_views(user_id_param uuid, count_param integer, daily_limit integer)
 RETURNS TABLE(allowed boolean, current_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
begin
  if auth.uid() is distinct from user_id_param then
    return query select false, 0;
    return;
  end if;

  select browse_views_today, browse_views_date, coalesce(timezone, 'UTC') into v_current_count, v_current_date, v_timezone
  from profiles where id = user_id_param for update;
  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;
  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;
  if v_current_count >= daily_limit then
    return query select false, v_current_count;
    return;
  end if;
  v_current_count := v_current_count + count_param;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set browse_views_today = v_current_count, browse_views_date = v_today_in_user_tz
  where id = user_id_param;
  return query select true, v_current_count;
end;
$function$;

-- match_contacts_to_users(text[])
CREATE OR REPLACE FUNCTION public.match_contacts_to_users(phone_numbers text[])
 RETURNS TABLE(id uuid, display_name text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_calls_today integer;
  v_call_date date;
begin
  if array_length(phone_numbers, 1) > 3000 then
    raise exception 'Too many contacts submitted at once.';
  end if;

  select p.contacts_matched_calls_today, p.contacts_matched_date
    into v_calls_today, v_call_date
    from profiles p
    where p.id = auth.uid()
    for update;

  if v_call_date is distinct from current_date then
    v_calls_today := 0;
  end if;

  if v_calls_today >= 10 then
    raise exception 'Too many contact-matching requests today -- try again tomorrow.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles p
    set contacts_matched_calls_today = v_calls_today + 1,
        contacts_matched_date = current_date
    where p.id = auth.uid();

  return query
    select p.id, p.display_name, p.photo_url
    from profiles p
    join auth.users u on u.id = p.id
    where u.phone = any(phone_numbers)
    and p.id != auth.uid();
end;
$function$;

-- pause_community(uuid)
CREATE OR REPLACE FUNCTION public.pause_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active community can be paused.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'paused' where id = community_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

-- record_friend_discovery_swipe(uuid,text)
CREATE OR REPLACE FUNCTION public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 RETURNS TABLE(is_mutual_match boolean, match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  v_friendship_id uuid;
  v_match_id uuid;
  v_reverse_like_exists boolean;
  v_i_opted_in boolean;
  v_they_opted_in boolean;
  v_already_connected boolean;
  v_my_name text;
  v_recipient_wants_notif boolean;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_me = target_user_id then
    raise exception 'You cannot swipe on yourself';
  end if;
  if direction_param not in ('like', 'pass') then
    raise exception 'Invalid direction';
  end if;

  perform id from profiles where id in (least(v_me, target_user_id), greatest(v_me, target_user_id)) order by id for update;

  select open_to_friend_discovery into v_i_opted_in from profiles where id = v_me;
  select open_to_friend_discovery into v_they_opted_in from profiles where id = target_user_id;
  if not coalesce(v_i_opted_in, false) or not coalesce(v_they_opted_in, false) then
    return query select false, null::uuid;
    return;
  end if;

  if is_blocked(v_me, target_user_id) then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friendships f
    where (f.user_a = v_me and f.user_b = target_user_id) or (f.user_a = target_user_id and f.user_b = v_me)
  ) or exists (
    select 1 from matches m
    where (m.user_a = v_me and m.user_b = target_user_id) or (m.user_a = target_user_id and m.user_b = v_me)
  ) into v_already_connected;

  if v_already_connected then
    return query select false, null::uuid;
    return;
  end if;

  insert into friend_discovery_swipes (from_user, to_user, direction)
  values (v_me, target_user_id, direction_param)
  on conflict (from_user, to_user) do nothing;

  if direction_param = 'pass' then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friend_discovery_swipes
    where from_user = target_user_id and to_user = v_me and direction = 'like'
  ) into v_reverse_like_exists;

  if not v_reverse_like_exists then
    return query select false, null::uuid;
    return;
  end if;

  v_user_a := least(v_me, target_user_id);
  v_user_b := greatest(v_me, target_user_id);

  perform set_config('app.trusted_update', 'true', true);

  insert into friendships (user_a, user_b, status, requested_by)
  values (v_user_a, v_user_b, 'accepted', v_me)
  on conflict (user_a, user_b) do update set status = 'accepted'
  where friendships.status <> 'accepted'
  returning id into v_friendship_id;

  if v_friendship_id is null then
    select id into v_friendship_id from friendships where user_a = v_user_a and user_b = v_user_b;
  end if;

  insert into matches (user_a, user_b, source_friendship_id)
  values (v_user_a, v_user_b, v_friendship_id)
  on conflict (user_a, user_b) do update
    set source_friendship_id = coalesce(matches.source_friendship_id, excluded.source_friendship_id)
  returning id into v_match_id;

  perform set_config('app.trusted_update', 'false', true);

  select coalesce(notify_social, true) into v_recipient_wants_notif from profiles where id = target_user_id;
  if v_recipient_wants_notif then
    select display_name into v_my_name from profiles where id = v_me;
    perform public._send_push(target_user_id, 'New friend!', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id));
  end if;

  return query select true, v_match_id;
end;
$function$;

-- record_photo_screening(uuid,uuid,text,uuid,boolean)
CREATE OR REPLACE FUNCTION public.record_photo_screening(p_user uuid, p_extra uuid, p_path text, p_object_id uuid, p_safe boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_path text;
  v_current_object uuid;
begin
  if p_extra is not null then
    select photo_url into v_current_path from profile_photos where id = p_extra and user_id = p_user for update;
  else
    select photo_url into v_current_path from profiles where id = p_user for update;
  end if;
  if v_current_path is null or v_current_path is distinct from p_path then return false; end if;
  select o.id into v_current_object from storage.objects o where o.bucket_id = 'profile-photos' and o.name = p_path;
  if p_safe and (p_object_id is null or v_current_object is distinct from p_object_id) then return false; end if;

  perform set_config('app.trusted_update', 'true', true);
  if p_extra is not null then
    update profile_photos set photo_verified = p_safe, screened_object_id = case when p_safe then p_object_id end
      where id = p_extra;
  else
    update profiles set photo_verified = p_safe, photo_object_id = case when p_safe then p_object_id end
      where id = p_user;
  end if;
  perform set_config('app.trusted_update', 'false', true);
  return p_safe;
end;
$function$;

-- respond_to_business_partnership_request(uuid,boolean)
CREATE OR REPLACE FUNCTION public.respond_to_business_partnership_request(request_id_param uuid, approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request record;
  v_business_name text;
  v_target_title text;
begin
  select * into v_request from business_partnership_requests where id = request_id_param;
  if v_request is null then
    raise exception 'Request not found';
  end if;

  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = v_request.partner_id) then
    raise exception 'Only the target business owner can respond to this request';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;

  update business_partnership_requests
  set status = case when approve then 'approved' else 'declined' end, reviewed_at = now()
  where id = request_id_param;

  if approve then
    perform set_config('app.trusted_update', 'true', true);
    if v_request.target_type = 'gathering' then
      update gatherings set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    else
      update communities set hosting_partner_id = v_request.partner_id where id = v_request.target_id;
    end if;
  end if;

  select name into v_business_name from brand_partners where id = v_request.partner_id;
  if v_request.target_type = 'gathering' then
    select title into v_target_title from gatherings where id = v_request.target_id;
  else
    select name into v_target_title from communities where id = v_request.target_id;
  end if;

  if coalesce((select notify_business from profiles where id = v_request.requester_id), true) then
    perform public._send_push(v_request.requester_id, case when approve then coalesce(v_business_name, 'A business') || ' accepted your partnership request' else coalesce(v_business_name, 'A business') || ' declined your partnership request' end, coalesce(v_target_title, 'Your gathering'), jsonb_build_object('type', 'business_partnership_response', 'target_type', v_request.target_type, 'target_id', v_request.target_id));
  end if;
end;
$function$;

-- resume_community(uuid)
CREATE OR REPLACE FUNCTION public.resume_community(community_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status from communities where id = community_id_param and creator_id = auth.uid() for update;
  if v_status is null then
    raise exception 'Community not found.';
  end if;
  if v_status <> 'paused' then
    raise exception 'Only a paused community can be resumed.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update communities set status = 'active' where id = community_id_param;
  return jsonb_build_object('success', true);
end;
$function$;

-- set_premium_status(uuid,boolean)
CREATE OR REPLACE FUNCTION public.set_premium_status(user_id_param uuid, new_status boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only callable with the service role key (via SECURITY DEFINER +
  -- restricted execute grant below), so this being "trusted" is
  -- enforced by who can call it at all, not by a flag that could
  -- fail to persist across separate requests.
  perform set_config('app.trusted_update', 'true', true);
  update profiles set is_premium = new_status where id = user_id_param;
end;
$function$;

-- spend_bonus_notice()
CREATE OR REPLACE FUNCTION public.spend_bonus_notice()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows integer;
begin
  perform set_config('app.trusted_update', 'true', true);
  update profiles set bonus_notices = bonus_notices - 1
  where id = auth.uid() and coalesce(bonus_notices, 0) > 0;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

-- swap_main_photo(uuid)
CREATE OR REPLACE FUNCTION public.swap_main_photo(extra_photo_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_extra record;
  v_main_url text;
  v_main_verified boolean;
  v_main_object uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select id, photo_url, photo_verified, screened_object_id into v_extra from profile_photos where id = extra_photo_id_param and user_id = v_me for update;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  select photo_url, coalesce(photo_verified, false), photo_object_id into v_main_url, v_main_verified, v_main_object from profiles where id = v_me for update;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set photo_url = v_extra.photo_url, photo_verified = coalesce(v_extra.photo_verified, false),
    photo_object_id = v_extra.screened_object_id where id = v_me;
  if v_main_url is not null then
    update profile_photos set photo_url = v_main_url, photo_verified = v_main_verified, screened_object_id = v_main_object
      where id = v_extra.id;
  else
    delete from profile_photos where id = v_extra.id;
  end if;
  perform set_config('app.trusted_update', 'false', true);
end;
$function$;
