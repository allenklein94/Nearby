-- Business notes screened like business text (owner, 2026-11-12). Staged after 20270414; deploy only with its own approval.
-- Closes the two write paths the 0372 audit found (PRODUCT_AUDIT/OFFER_SAFETY_WRITE_PATH_AUDIT_2026-11-12.md), reusing
-- 0372's binding (private.require_business_screening: a screening result the screen-business-content edge function
-- recorded for THIS user + business + exact text, low risk, from a submission, < 30 minutes, single use).
--
-- 1. Availability pulse note (set_business_availability_pulse): up to 140 characters shown on the public business profile.
--    Before: never screened, no contact rule, callable directly. Now: a NEW or CHANGED non-empty note needs a screening
--    result (target 'availability_note', snapshot {note}); otherwise refused, hint 'screening_required', nothing written.
--    Status-only taps with the same note, and clearing the note, need none (as today's app does). Contact details refused
--    (hint offer_contact_info) by a trigger on brand_partners, whoever writes.
-- 2. Decline note (decline_business_offer, reason 'other'): stored on the business's row, readable by the customer through
--    the API. Now: a non-empty note is stored only with a screening result (target 'decline_note', target_id = the request,
--    snapshot {requestId, note}); WITHOUT one the decline still happens and the note is left out (so declining keeps working
--    for builds that call the function directly, incl. build <= 87; unscreened text is never stored). Contact details
--    refused by 0372's offer contact trigger, which now also covers decline_note.
-- Both functions move to schema private unchanged (*_unscreened, no client access) behind thin public wrappers with the
-- same name, arguments and result, exactly like 0372's seven. The server itself (edge service client, cron, migrations) is
-- exempt as in 0372. No existing row changes (the pulse note and decline note columns are not rewritten). No new screen,
-- score, ranking or review queue: the edge function refuses a medium/high note instead of holding it (a "right now" note
-- is stale by the time a review happens; see the edge function).

alter table public.business_content_screening_results drop constraint if exists business_content_screening_results_target_type_check;
alter table public.business_content_screening_results add constraint business_content_screening_results_target_type_check
  check (target_type = any (array['business_profile', 'offer', 'experience', 'availability', 'update', 'offer_response',
                                  'creative', 'package', 'availability_note', 'decline_note']));

-- The screened content, built exactly as the edge function snapshots it (trimmed; empty = none).
create or replace function private.screening_content_availability_note(p_note text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), ''));
$function$;

create or replace function private.screening_content_decline_note(p_request uuid, p_note text)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object('requestId', p_request, 'note', nullif(trim(coalesce(p_note, '')), ''));
$function$;

-- 0372's lookup, split so a caller can ask without raising. require_business_screening keeps its exact behaviour.
create or replace function private.consume_business_screening(p_partner uuid, p_target text, p_target_id uuid, p_content jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  select r.id into v_id
    from business_content_screening_results r
   where r.partner_id = p_partner
     and r.target_type = p_target
     and r.submitted_by = auth.uid()
     and r.source = 'submission'
     and r.risk_tier = 'low'
     and r.review_outcome is null
     and r.consumed_at is null
     and r.created_at > now() - interval '30 minutes'
     and r.target_id is not distinct from p_target_id
     and private._screening_snapshot_matches(r.content_snapshot, p_content)
   order by r.created_at desc
   limit 1
   for update skip locked;
  if v_id is not null then
    update business_content_screening_results set consumed_at = now() where id = v_id;
  end if;
  return v_id;
end;
$function$;

create or replace function private.require_business_screening(p_partner uuid, p_target text, p_target_id uuid, p_content jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if private._is_server_write() then
    return null;
  end if;
  v_id := private.consume_business_screening(p_partner, p_target, p_target_id, p_content);
  if v_id is null then
    raise exception 'This needs to go through Nearby''s content check before it can be published.'
      using errcode = '42501', hint = 'screening_required';
  end if;
  return v_id;
end;
$function$;

revoke all on function private.screening_content_availability_note(text) from public, anon, authenticated;
revoke all on function private.screening_content_decline_note(uuid, text) from public, anon, authenticated;
revoke all on function private.consume_business_screening(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- Move the two write functions out of reach, unchanged.
alter function public.set_business_availability_pulse(uuid, text, text) set schema private;
alter function private.set_business_availability_pulse(uuid, text, text) rename to set_business_availability_pulse_unscreened;
alter function public.decline_business_offer(uuid, text, text) set schema private;
alter function private.decline_business_offer(uuid, text, text) rename to decline_business_offer_unscreened;
revoke all on function private.set_business_availability_pulse_unscreened(uuid, text, text) from public, anon, authenticated;
revoke all on function private.decline_business_offer_unscreened(uuid, text, text) from public, anon, authenticated;

create function public.set_business_availability_pulse(partner_id_param uuid, pulse_param text, note_param text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_note text := nullif(trim(coalesce(note_param, '')), '');
  v_cur text;
begin
  if v_note is not null and partner_id_param is not null
     and private._caller_partner() is not distinct from partner_id_param then
    select nullif(trim(coalesce(availability_pulse_note, '')), '') into v_cur from brand_partners where id = partner_id_param;
    if v_note is distinct from v_cur then
      perform private.require_business_screening(partner_id_param, 'availability_note', null,
        private.screening_content_availability_note(v_note));
    end if;
  end if;
  perform private.set_business_availability_pulse_unscreened($1, $2, $3);
end;
$function$;

create function public.decline_business_offer(request_id_param uuid, reason_param text, note_param text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_note text := case when reason_param = 'other' then nullif(trim(coalesce(note_param, '')), '') end;
  v_partner uuid := private._caller_partner();
begin
  -- Unscreened text is never stored: no matching screening result = the decline goes through without its note.
  if v_note is not null and not private._is_server_write()
     and (v_partner is null
          or private.consume_business_screening(v_partner, 'decline_note', request_id_param,
               private.screening_content_decline_note(request_id_param, v_note)) is null) then
    v_note := null;
  end if;
  return private.decline_business_offer_unscreened(request_id_param, reason_param, v_note);
end;
$function$;

revoke all on function public.set_business_availability_pulse(uuid, text, text) from public, anon;
revoke all on function public.decline_business_offer(uuid, text, text) from public, anon;
grant execute on function public.set_business_availability_pulse(uuid, text, text) to authenticated;
grant execute on function public.decline_business_offer(uuid, text, text) to authenticated;

-- Contact details: the decline note joins 0372's offer contact trigger (one rule); the pulse note gets its own trigger on
-- brand_partners with business-note wording. Both: whoever writes (server included), only when the text changes.
create or replace function private._offer_contact_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new text[];
  v_old text[];
begin
  if tg_table_name = 'business_request_offers' then
    v_new := array[new.offer_description, new.offer_title, new.redemption_instructions, new.decline_note] || coalesce(new.included_items, '{}'::text[]);
    if tg_op = 'UPDATE' then
      v_old := array[old.offer_description, old.offer_title, old.redemption_instructions, old.decline_note] || coalesce(old.included_items, '{}'::text[]);
    end if;
  elsif tg_table_name = 'business_availability' then
    v_new := array[new.title, new.description];
    if tg_op = 'UPDATE' then v_old := array[old.title, old.description]; end if;
  elsif tg_table_name = 'business_occasion_packages' then
    v_new := array[new.name, new.description] || coalesce(new.included_items, '{}'::text[]);
    if tg_op = 'UPDATE' then v_old := array[old.name, old.description] || coalesce(old.included_items, '{}'::text[]); end if;
  elsif tg_table_name = 'brand_offers' then
    v_new := array[new.title, new.description, new.redemption_instructions];
    if tg_op = 'UPDATE' then v_old := array[old.title, old.description, old.redemption_instructions]; end if;
  end if;
  if tg_op = 'UPDATE' and v_new is not distinct from v_old then
    return new;
  end if;
  perform private._refuse_offer_contact(v_new);
  return new;
end;
$function$;

create or replace function private._business_note_contact_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.availability_pulse_note is not distinct from old.availability_pulse_note then
    return new;
  end if;
  if private.offer_contact_kind_any(array[new.availability_pulse_note]) is not null then
    raise exception 'Notes can''t include website links, email addresses or phone numbers. Customers reach you through Nearby.'
      using errcode = '22023', hint = 'offer_contact_info';
  end if;
  return new;
end;
$function$;

revoke all on function private._business_note_contact_guard() from public, anon, authenticated;

drop trigger if exists business_note_contact_guard on public.brand_partners;
create trigger business_note_contact_guard before insert or update of availability_pulse_note on public.brand_partners
  for each row execute function private._business_note_contact_guard();
