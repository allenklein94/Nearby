-- Business Web as an Operating System, Phase 1: decline reasons + owner-visible
-- decline-pattern insight. Built directly into the app's own Business Mode, per the
-- user's own explicit standalone instruction (see CLAUDE.md, "Sep 15 2026" plan).
--
-- Schema: business_request_offers gains decline_reason/decline_note (nullable, only
-- ever set alongside status='declined'). Real, curated vocabulary, distinct from
-- business_match_exclusions' own system-computed reason set -- this describes a human
-- owner's stated judgment on a real opportunity they were shown, not a system
-- computation of why a request was never shown at all.
--
-- decline_business_offer(request_id_param uuid) is DROP FUNCTION'ed first (an added
-- param creates a distinct orphaned overload, per this schema's own repeatedly-stated
-- rule) and recreated with reason_param/note_param. Every other line of the function's
-- real body -- pulled fresh from production immediately before writing this migration,
-- confirmed byte-for-byte unchanged from what's documented in CLAUDE.md's own "Sep 15
-- 2026 (cont'd)" research note -- is preserved verbatim: the ownership check, the
-- FOR UPDATE lock, the pending/offered status guard. Only the reason-write is new.
--
-- get_partner_decline_patterns() mirrors get_missed_match_summary()'s own real shape
-- (pulled live, same file) with one deliberate difference: no entitlement gate. The
-- locked plan's own text is explicit that this is "owner-only... never exposed to
-- anyone but the business itself" -- only the ownership check, never a tier gate.

alter table public.business_request_offers
  add column if not exists decline_reason text,
  add column if not exists decline_note text;

alter table public.business_request_offers
  drop constraint if exists business_request_offers_decline_reason_check;

alter table public.business_request_offers
  add constraint business_request_offers_decline_reason_check
  check (
    decline_reason is null or decline_reason in (
      'too_far',
      'too_busy_right_now',
      'cant_accommodate_group_size',
      'outside_our_hours',
      'not_a_fit_for_us',
      'other'
    )
  );

-- decline_note is only ever meaningful alongside decline_reason = 'other' -- not
-- enforced at the DB layer (the RPC below is the real gate; a free-text note attached
-- to any other reason is harmless, not a correctness bug), matching this schema's own
-- established convention of enforcing the "structured reason + optional free text"
-- shape at the RPC layer, not via a CHECK constraint that would need to reference two
-- columns' co-dependency.

drop function if exists public.decline_business_offer(uuid);

create function public.decline_business_offer(
  request_id_param uuid,
  reason_param text,
  note_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_row record;
begin
  if reason_param not in (
    'too_far',
    'too_busy_right_now',
    'cant_accommodate_group_size',
    'outside_our_hours',
    'not_a_fit_for_us',
    'other'
  ) then
    raise exception 'Invalid decline reason.';
  end if;

  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status not in ('pending', 'offered') then
    raise exception 'This request has already been resolved.';
  end if;

  update business_request_offers
  set status = 'declined',
      responded_at = now(),
      decline_reason = reason_param,
      decline_note = case when reason_param = 'other' then note_param else null end
  where id = v_row.id;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.decline_business_offer(uuid, text, text) from public, anon;
grant execute on function public.decline_business_offer(uuid, text, text) to authenticated;

create or replace function public.get_partner_decline_patterns(
  partner_id_param uuid,
  days_back_param integer default 30
)
returns table(decline_reason text, decline_count bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select bro.decline_reason, count(*)
  from business_request_offers bro
  where bro.partner_id = partner_id_param
  and bro.status = 'declined'
  and bro.decline_reason is not null
  and bro.responded_at >= now() - make_interval(days => coalesce(days_back_param, 30))
  group by bro.decline_reason
  order by count(*) desc;
end;
$function$;

revoke all on function public.get_partner_decline_patterns(uuid, integer) from public, anon;
grant execute on function public.get_partner_decline_patterns(uuid, integer) to authenticated;
