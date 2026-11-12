-- Rollback of 20270415 (business note screening). Restores 0372's exact definitions; no row is touched (pulse notes and
-- decline notes written while 0415 was live stay as written). Screening rows of the two new target types are deleted
-- before the constraint is narrowed (audit rows of notes only; nothing else references them).
drop trigger if exists business_note_contact_guard on public.brand_partners;
drop function if exists private._business_note_contact_guard();
drop function if exists public.set_business_availability_pulse(uuid, text, text);
drop function if exists public.decline_business_offer(uuid, text, text);
alter function private.set_business_availability_pulse_unscreened(uuid, text, text) rename to set_business_availability_pulse;
alter function private.set_business_availability_pulse(uuid, text, text) set schema public;
alter function private.decline_business_offer_unscreened(uuid, text, text) rename to decline_business_offer;
alter function private.decline_business_offer(uuid, text, text) set schema public;
revoke all on function public.set_business_availability_pulse(uuid, text, text) from public, anon;
grant execute on function public.set_business_availability_pulse(uuid, text, text) to authenticated;
revoke all on function public.decline_business_offer(uuid, text, text) from public, anon;
grant execute on function public.decline_business_offer(uuid, text, text) to authenticated;
delete from public.business_content_screening_results where target_type in ('availability_note', 'decline_note');
alter table public.business_content_screening_results drop constraint if exists business_content_screening_results_target_type_check;
alter table public.business_content_screening_results add constraint business_content_screening_results_target_type_check
  check (target_type = any (array['business_profile', 'offer', 'experience', 'availability', 'update', 'offer_response',
                                  'creative', 'package']));
-- 0372's require_business_screening and _offer_contact_guard, verbatim:
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
  if v_id is null then
    raise exception 'This needs to go through Nearby''s content check before it can be published.'
      using errcode = '42501', hint = 'screening_required';
  end if;
  update business_content_screening_results set consumed_at = now() where id = v_id;
  return v_id;
end;
$function$;

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
    v_new := array[new.offer_description, new.offer_title, new.redemption_instructions] || coalesce(new.included_items, '{}'::text[]);
    if tg_op = 'UPDATE' then
      v_old := array[old.offer_description, old.offer_title, old.redemption_instructions] || coalesce(old.included_items, '{}'::text[]);
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

drop function if exists private.consume_business_screening(uuid, text, uuid, jsonb);
drop function if exists private.screening_content_decline_note(uuid, text);
drop function if exists private.screening_content_availability_note(text);
