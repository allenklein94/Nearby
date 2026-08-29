-- Real web-based business application (no app required), per CLAUDE.md's own
-- "Aug 29 2026 -- real web business application, no app required" locked plan.
-- Additive/backward-compatible: every existing (app-sourced) row keeps working
-- exactly as before, source defaults to 'app', requester_id stays required for
-- that path (only the column-level NOT NULL is relaxed so a web row can omit it).

alter table public.business_partner_requests
  alter column requester_id drop not null;

alter table public.business_partner_requests
  add column if not exists source text not null default 'app',
  add column if not exists applicant_name text,
  add column if not exists applicant_email text,
  add column if not exists applicant_phone text,
  add column if not exists claimed_at timestamptz,
  add column if not exists resulting_partner_id uuid references public.brand_partners(id),
  add column if not exists submitter_ip_hash text;

alter table public.business_partner_requests
  add constraint business_partner_requests_source_check
  check (source in ('app', 'web'));

-- The real shape guarantee: an app-sourced row always has a real requester;
-- a web-sourced row always has real contact info to review/reach/match by.
alter table public.business_partner_requests
  add constraint business_partner_requests_source_shape_check
  check (
    (source = 'app' and requester_id is not null)
    or (source = 'web' and applicant_name is not null and applicant_email is not null and applicant_phone is not null)
  );

-- Web-sourced mirror of business_partner_requests_one_pending_idx (which is
-- requester_id-keyed and therefore never conflicts with a null-requester web
-- row) -- prevents someone stacking multiple concurrent pending web
-- applications under the same phone number.
create unique index if not exists business_partner_requests_one_pending_web_idx
  on public.business_partner_requests (applicant_phone)
  where (status = 'pending' and source = 'web');

-- ---------------------------------------------------------------------------
-- The claim mechanism -- the honest way to link a later real signed-in
-- profile to a business that was approved before that profile existed.
-- Matches on phone, not email: this app's real, only consumer signup path is
-- phone OTP (LoginScreen.js), confirmed live -- there is no email field
-- anywhere in the real signup flow, so an email-keyed match would silently
-- never fire for a real user.
-- ---------------------------------------------------------------------------

-- Locked down, zero grants to any role -- callable only from within another
-- SECURITY DEFINER function or trigger owned by the same role, matching the
-- established _business_request_fanout()-style internal-helper pattern.
create or replace function public._claim_web_business_requests(profile_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

revoke all on function public._claim_web_business_requests(uuid) from public, anon, authenticated;

-- Closes the "applicant signs up for the first time after their web
-- application is already approved" case. profiles rows are only ever
-- created once, client-side, via CompleteProfileScreen.js's own upsert --
-- confirmed this only fires the real INSERT trigger path on a genuinely new
-- account, never on a later profile edit (an upsert's UPDATE path doesn't
-- fire an AFTER INSERT trigger).
create or replace function public._link_web_business_requests_on_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._claim_web_business_requests(new.id);
  return new;
end;
$function$;

drop trigger if exists on_profile_created_claim_web_business on public.profiles;
create trigger on_profile_created_claim_web_business
  after insert on public.profiles
  for each row execute function public._link_web_business_requests_on_signup();

-- ---------------------------------------------------------------------------
-- approve_business_partner_request() re-pointed, pulled live via the
-- Management API before editing (confirmed byte-identical to the committed
-- 20260817_business_partner_request_coordinates.sql body before this change --
-- every line below the two new additions is unchanged). Adds: persisting
-- resulting_partner_id (a real, previously-missing gap -- nothing before this
-- ever recorded which brand_partners row a given approval actually created),
-- and, for a web-sourced row, an immediate claim attempt in case the
-- applicant already had a real Nearby account (matching phone) at approval
-- time -- the trigger above covers the "signs up later" case.
-- ---------------------------------------------------------------------------
create or replace function public.approve_business_partner_request(request_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into brand_partners (name, description, active, category, address, latitude, longitude)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude)
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
$function$;
