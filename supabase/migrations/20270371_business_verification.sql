-- Verified Business (owner approved 2026-10-31, decisions A + B). Staged after 20270370; deploy only with its own approval.
-- Depends on 20270349 (nobody can make themselves an admin) and 20270369 (private.require_admin, private.clean_case_text).
--
-- Approval and verification are SEPARATE. An approved business (a brand_partners row an admin created from an application)
-- is NOT verified. No existing business is verified by this migration: there is no backfill, so every business, Coastal
-- Coffee included, starts unverified and goes through the same review.
--
-- "Verified Business" means only: an admin recorded that Nearby checked the business exists and that the person running it
-- on Nearby is authorized to represent it. It is never a statement about quality, safety or reliability.
--
--   1. Evidence (decision B). An admin records four checks, each with a METHOD from a fixed list per check, an OUTCOME
--      (passed / failed / inconclusive) and a factual NOTE (15-500 characters), plus a decision note. The fifth check, the
--      documented decision, is the record itself: reviewer and time are stamped by the server, never sent by the client.
--      A checkbox alone can't be sent: a missing or unknown method, a missing check or a short note is refused, nothing is
--      recorded. No documents are uploaded or stored.
--        identity     the business exists:        state_registry, government_license, official_website, site_visit
--        authority    the applicant represents it: registry_officer_listing, called_official_number, official_domain_email, site_visit
--        contact      a business-controlled contact, obtained independently, not the applicant's own entry:
--                                                  called_official_number, official_domain_email
--        consistency  the submitted details match independent records:
--                                                  state_registry, government_license, official_website, independent_map_listing, site_visit
--      All four passed = 'verified'. Anything else = 'not_verified' (recorded; no badge). Inconclusive is never verified.
--   2. Server-held state. private.business_verification_events is the ONE record, APPEND-ONLY (no client access at all;
--      updates and deletes refused, even for the table owner, except the cascade when the business itself is deleted and an
--      admin's id going to null when that account is deleted). The current state = the latest event. Nothing on
--      brand_partners or profiles carries it, so no client write, trusted-write flag or profile edit can set it.
--   3. Admin only. Verify / revoke / list run only for an admin (private.require_admin). An admin can't verify a business
--      they manage themselves (hint 'verification_conflict_of_interest'): a business is never verified by its own operator.
--      Revoking needs a written reason. Concurrent decisions on one business are serialized (row lock on the business).
--   4. The badge shows only while the verified facts still hold: the business is active, its name and address are exactly
--      the ones verified, and the account that was checked still manages it. A rename, an address change or a new manager
--      lapses the badge until an admin verifies again (the history keeps everything).
--   5. Reading. get_verified_business_ids(ids) answers which of the given businesses show the badge, for anyone (it is
--      public, like the badge). It returns ids only. Nothing in routing, matching, ranking, offers, replies or Opportunities
--      reads it (decision A; guard src/utils/businessVerification.test.js).

-- 1. The record -----------------------------------------------------------------------------------------------------------
create table if not exists private.business_verification_events (
  id bigint generated always as identity primary key,
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid references auth.users(id) on delete set null,           -- the admin who decided
  kind text not null check (kind in ('verified', 'not_verified', 'revoked')),
  checks jsonb not null default '{}'::jsonb,                          -- verified / not_verified: the four checks as sent
  note text not null check (length(note) between 10 and 500),         -- decision note, or the revocation reason
  verified_name text,                                                 -- verified only: what was checked
  verified_address text,
  verified_manager uuid,
  constraint business_verification_snapshot check ((kind = 'verified') = (verified_name is not null and verified_manager is not null)),
  constraint business_verification_checks check ((kind = 'revoked') = (checks = '{}'::jsonb))
);
create index if not exists business_verification_events_partner_idx on private.business_verification_events (partner_id, id desc);
revoke all on private.business_verification_events from public, anon, authenticated, service_role;

create or replace function private._business_verification_event_guard()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE' then
    -- the one allowed change: the deciding admin's account was deleted (ON DELETE SET NULL)
    if new.id = old.id and new.partner_id = old.partner_id and new.at = old.at and new.kind = old.kind
       and new.checks = old.checks and new.note = old.note
       and new.verified_name is not distinct from old.verified_name
       and new.verified_address is not distinct from old.verified_address
       and new.verified_manager is not distinct from old.verified_manager
       and new.actor is null and old.actor is not null
       and not exists (select 1 from auth.users u where u.id = old.actor) then
      return new;
    end if;
    raise exception 'Business verification history is append-only' using errcode = '42501', hint = 'verification_history_append_only';
  end if;
  -- DELETE: only the cascade of the business itself being deleted
  if exists (select 1 from public.brand_partners b where b.id = old.partner_id) then
    raise exception 'Business verification history is append-only' using errcode = '42501', hint = 'verification_history_append_only';
  end if;
  return old;
end;
$function$;
revoke all on function private._business_verification_event_guard() from public, anon, authenticated;
drop trigger if exists business_verification_event_guard on private.business_verification_events;
create trigger business_verification_event_guard before update or delete on private.business_verification_events
  for each row execute function private._business_verification_event_guard();

-- 2. Evidence rules ---------------------------------------------------------------------------------------------------------
create or replace function private.business_verification_methods()
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'identity',    jsonb_build_array('state_registry', 'government_license', 'official_website', 'site_visit'),
    'authority',   jsonb_build_array('registry_officer_listing', 'called_official_number', 'official_domain_email', 'site_visit'),
    'contact',     jsonb_build_array('called_official_number', 'official_domain_email'),
    'consistency', jsonb_build_array('state_registry', 'government_license', 'official_website', 'independent_map_listing', 'site_visit'));
$function$;
revoke all on function private.business_verification_methods() from public, anon, authenticated;

-- Returns the cleaned checks and whether all four passed; refuses anything incomplete. Nothing is recorded on a refusal.
create or replace function private.business_verification_clean_checks(p jsonb, out cleaned jsonb, out all_passed boolean)
language plpgsql
immutable
as $function$
declare
  v_methods jsonb := private.business_verification_methods();
  v_key text;
  v_check jsonb;
  v_method text;
  v_outcome text;
  v_note text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Record all four checks' using errcode = '22023', hint = 'verification_evidence_incomplete';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where not v_methods ? k) then
    raise exception 'Unknown check' using errcode = '22023', hint = 'verification_evidence_incomplete';
  end if;
  cleaned := '{}'::jsonb;
  all_passed := true;
  for v_key in select jsonb_object_keys(v_methods) loop
    v_check := p -> v_key;
    if v_check is null or jsonb_typeof(v_check) <> 'object' then
      raise exception 'Record the % check', v_key using errcode = '22023', hint = 'verification_evidence_incomplete';
    end if;
    v_method := v_check ->> 'method';
    v_outcome := v_check ->> 'outcome';
    v_note := nullif(btrim(coalesce(v_check ->> 'note', '')), '');
    if v_method is null or not (v_methods -> v_key) ? v_method then
      raise exception 'Pick how the % check was done', v_key using errcode = '22023', hint = 'verification_method_invalid';
    end if;
    if v_outcome is null or v_outcome not in ('passed', 'failed', 'inconclusive') then
      raise exception 'Record the outcome of the % check', v_key using errcode = '22023', hint = 'verification_evidence_incomplete';
    end if;
    if v_note is null or length(v_note) < 15 then
      raise exception 'Write what you found for the % check (at least 15 characters)', v_key using errcode = '22023', hint = 'verification_note_too_short';
    end if;
    if length(v_note) > 500 then
      raise exception 'Keep the % note under 500 characters', v_key using errcode = '22023', hint = 'verification_note_too_long';
    end if;
    cleaned := cleaned || jsonb_build_object(v_key, jsonb_build_object('method', v_method, 'outcome', v_outcome, 'note', v_note));
    all_passed := all_passed and v_outcome = 'passed';
  end loop;
end;
$function$;
revoke all on function private.business_verification_clean_checks(jsonb) from public, anon, authenticated;

-- 3. Current state (the latest event) and whether the badge shows -------------------------------------------------------------
-- lapse: null = shows; else why not ('inactive', 'name_changed', 'address_changed', 'manager_changed').
create or replace function private.business_verification_status(p_partner uuid, out state text, out badge boolean, out lapse text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  e private.business_verification_events;
  b public.brand_partners;
begin
  select * into e from private.business_verification_events where partner_id = p_partner order by id desc limit 1;
  state := coalesce(e.kind, 'none');
  badge := false;
  if e.kind is distinct from 'verified' then return; end if;
  select * into b from public.brand_partners where id = p_partner;
  if b.id is null or b.active is not true then lapse := 'inactive';
  elsif b.name is distinct from e.verified_name then lapse := 'name_changed';
  elsif coalesce(b.address, '') is distinct from coalesce(e.verified_address, '') then lapse := 'address_changed';
  elsif not exists (select 1 from public.profiles p where p.id = e.verified_manager and p.managed_partner_id = p_partner) then lapse := 'manager_changed';
  else badge := true;
  end if;
end;
$function$;
revoke all on function private.business_verification_status(uuid) from public, anon, authenticated;

-- 4. Public read: which of these businesses show "Verified Business" ---------------------------------------------------------
create or replace function public.get_verified_business_ids(partner_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if partner_ids is null then return '{}'::uuid[]; end if;
  if cardinality(partner_ids) > 200 then
    raise exception 'Too many businesses' using errcode = '22023', hint = 'too_many_ids';
  end if;
  return coalesce((
    select array_agg(distinct x)
    from unnest(partner_ids) x
    where (private.business_verification_status(x)).badge), '{}'::uuid[]);
end;
$function$;
revoke all on function public.get_verified_business_ids(uuid[]) from public;
grant execute on function public.get_verified_business_ids(uuid[]) to anon, authenticated;

-- 5. Admin: verify (or record a review that didn't verify) ---------------------------------------------------------------------
create or replace function public.admin_verify_business(partner_id_param uuid, checks_param jsonb, decision_note_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  b public.brand_partners;
  v_manager uuid;
  v_note text := private.clean_case_text(decision_note_param, 500, 'verification_note_too_long');
  v_clean record;
  v_kind text;
begin
  select * into b from public.brand_partners where id = partner_id_param for update;   -- serializes decisions on one business
  if b.id is null then
    raise exception 'Business not found' using errcode = 'P0002', hint = 'business_not_found';
  end if;
  if exists (select 1 from public.profiles where id = v_admin and managed_partner_id = b.id) then
    raise exception 'You manage this business, so another admin has to verify it'
      using errcode = '42501', hint = 'verification_conflict_of_interest';
  end if;
  if b.active is not true then
    raise exception 'Only an active, approved business can be verified' using errcode = '22023', hint = 'business_not_active';
  end if;
  select p.id into v_manager from public.profiles p where p.managed_partner_id = b.id order by p.created_at, p.id limit 1;
  if v_manager is null then
    raise exception 'This business has no manager to verify' using errcode = '22023', hint = 'business_has_no_manager';
  end if;
  if v_note is null or length(v_note) < 10 then
    raise exception 'Write the decision (at least 10 characters)' using errcode = '22023', hint = 'verification_note_too_short';
  end if;
  select * into v_clean from private.business_verification_clean_checks(checks_param);
  v_kind := case when v_clean.all_passed then 'verified' else 'not_verified' end;
  insert into private.business_verification_events (partner_id, actor, kind, checks, note, verified_name, verified_address, verified_manager)
  values (b.id, v_admin, v_kind, v_clean.cleaned, v_note,
          case when v_kind = 'verified' then b.name end,
          case when v_kind = 'verified' then b.address end,
          case when v_kind = 'verified' then v_manager end);
  return jsonb_build_object('state', v_kind, 'badge', (private.business_verification_status(b.id)).badge);
end;
$function$;
revoke all on function public.admin_verify_business(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_verify_business(uuid, jsonb, text) to authenticated;

-- 6. Admin: revoke -----------------------------------------------------------------------------------------------------------------
create or replace function public.admin_revoke_business_verification(partner_id_param uuid, reason_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.clean_case_text(reason_param, 500, 'verification_note_too_long');
  v_id uuid;
begin
  select id into v_id from public.brand_partners where id = partner_id_param for update;
  if v_id is null then
    raise exception 'Business not found' using errcode = 'P0002', hint = 'business_not_found';
  end if;
  if (private.business_verification_status(v_id)).state is distinct from 'verified' then
    raise exception 'This business is not verified' using errcode = '22023', hint = 'business_not_verified';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Write why (at least 10 characters)' using errcode = '22023', hint = 'verification_note_too_short';
  end if;
  insert into private.business_verification_events (partner_id, actor, kind, note) values (v_id, v_admin, 'revoked', v_reason);
  return jsonb_build_object('state', 'revoked', 'badge', false);
end;
$function$;
revoke all on function public.admin_revoke_business_verification(uuid, text) from public, anon;
grant execute on function public.admin_revoke_business_verification(uuid, text) to authenticated;

-- 7. Admin: every business with its state and full history ------------------------------------------------------------------------
create or replace function public.admin_list_business_verifications()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_admin uuid := private.require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'partner_id', b.id, 'name', b.name, 'address', b.address, 'active', b.active,
      'managers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name) order by p.created_at), '[]'::jsonb)
                   from public.profiles p where p.managed_partner_id = b.id),
      'you_manage', exists (select 1 from public.profiles p where p.id = v_admin and p.managed_partner_id = b.id),
      'state', s.state, 'badge', s.badge, 'lapse', s.lapse,
      'history', (select coalesce(jsonb_agg(jsonb_build_object(
                    'at', e.at, 'kind', e.kind, 'checks', e.checks, 'note', e.note,
                    'by', e.actor, 'by_name', (select display_name from public.profiles where id = e.actor),
                    'verified_name', e.verified_name, 'verified_address', e.verified_address) order by e.id desc), '[]'::jsonb)
                  from private.business_verification_events e where e.partner_id = b.id))
      order by b.name)
    from public.brand_partners b
    cross join lateral private.business_verification_status(b.id) s), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_list_business_verifications() from public, anon;
grant execute on function public.admin_list_business_verifications() to authenticated;

-- The evidence methods, for the admin form (the same list the server checks).
create or replace function public.admin_business_verification_methods()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_admin();
  return private.business_verification_methods();
end;
$function$;
revoke all on function public.admin_business_verification_methods() from public, anon;
grant execute on function public.admin_business_verification_methods() to authenticated;
