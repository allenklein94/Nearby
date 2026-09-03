-- Phase 3 of the "intelligent demand inbox" plan (see CLAUDE.md, Sep 3 2026
-- section) -- real AI-powered business onboarding from free text.
--
-- Real, disclosed correction to the plan's own literal wording, found by
-- reading the actual current schema/screen before building anything (same
-- standing rule as every other schema-touching pass in this file): the
-- plan's own text said the new Edge Function should validate "every
-- returned field against the real, live CHECK-constraint vocabularies --
-- category/attributes/cuisine/occasion" and be "wired into
-- BusinessPartnerApplyScreen.js's existing apply flow as an optional
-- fast-path alongside the existing manual category/attribute/cuisine
-- pickers" -- but business_partner_requests had no attributes/cuisine/
-- occasion columns at all, and BusinessPartnerApplyScreen.js had no
-- attribute/cuisine pickers to alongside in the first place (confirmed by
-- reading both directly, not assumed). The plan's own assumption about
-- current state was wrong, not a gap to silently paper over.
--
-- Resolution, locked here rather than guessed at: extend
-- business_partner_requests with the three real fields, reusing brand_
-- partners' own exact, already-live CHECK-constraint vocabularies verbatim
-- (attributes: the 8-value BUSINESS_ATTRIBUTE_OPTIONS list; cuisine: the
-- 11-value CUISINE_OPTIONS list) plus one real, deliberate mapping choice:
-- the business-level analog of "occasion" is Phase 2's own priority_
-- occasions (an array of occasions a business wants more customers for --
-- "the WHY signal, but for a business's own appetite, not a single
-- consumer ask"), not a scalar occasion column like business_requests'
-- Phase-1 column (that column describes one consumer's ask, which has no
-- meaning for a business applying to join the platform). This closes the
-- real gap Phase 2 already opened up a target for -- once approved, these
-- three fields ride straight onto the new brand_partners row (mirroring
-- exactly how category/address/latitude/longitude are already carried
-- over at approval time), so a business owner who used the AI fast path
-- at apply time doesn't have to re-enter the same real facts again on the
-- dashboard after being approved.
alter table business_partner_requests
  add column if not exists attributes text[] not null default '{}';

alter table business_partner_requests
  add column if not exists cuisine text;

alter table business_partner_requests
  add column if not exists priority_occasions text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_partner_requests_attributes_check'
  ) then
    alter table business_partner_requests
      add constraint business_partner_requests_attributes_check
      check (attributes <@ array[
        'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
        'kid_friendly', 'quiet', 'casual', 'upscale'
      ]::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'business_partner_requests_cuisine_check'
  ) then
    alter table business_partner_requests
      add constraint business_partner_requests_cuisine_check
      check (cuisine is null or cuisine = any (array[
        'italian', 'mexican', 'japanese', 'chinese', 'american', 'french',
        'mediterranean', 'indian', 'thai', 'seafood', 'other'
      ]::text[]));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'business_partner_requests_priority_occasions_check'
  ) then
    alter table business_partner_requests
      add constraint business_partner_requests_priority_occasions_check
      check (priority_occasions <@ array[
        'birthday', 'anniversary', 'date_night', 'celebration',
        'casual_hangout', 'business_meal', 'family_gathering', 'other'
      ]::text[]);
  end if;
end $$;

-- approve_business_partner_request() re-pointed -- pulled fresh via the
-- Management API immediately before writing this, every existing line
-- (the admin check, the pending-status guard, the retroactive gathering/
-- community hosting_partner_id links, the push notification, the web-
-- sourced-applicant claim path) reproduced byte-for-byte. The only real
-- change: the new brand_partners insert also carries the three new real
-- fields -- a business that used the AI fast path (or hand-picked these
-- via the new pickers) at apply time doesn't lose that work on approval.
create or replace function approve_business_partner_request(request_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  req record;
  new_partner_id uuid;
  service_key text;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions)
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

  -- Web-sourced applications have no requester_id to notify by push -- no
  -- device/account exists yet for them. The push below correctly, silently
  -- no-ops in that case (recipient_id is null), matching the "harmless no-op
  -- for a nonexistent recipient" behavior net.http_post already has
  -- elsewhere in this schema.
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', req.requester_id,
      'title', 'You''re approved as a partner! 🎉',
      'body', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.',
      'data', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id)
    )
  );

  return new_partner_id;
end;
$$;
