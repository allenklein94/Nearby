-- A perk gated on a gathering or community no longer blocks deleting it (owner, 2026-11-07; defect found by 20270393's journey).
-- Staged after 20270393; own deploy approval. Needs 20270393 (redefines private.content_removal_close_links).
--
-- The defect: brand_offers.gathering_id and .unlock_community_id are ON DELETE SET NULL, but brand_offers_unlock_shape_check
-- requires the id while unlock_scope is 'gathering' / 'community'. So deleting the gathering or community a perk is gated on
-- failed the whole statement. Every path that deletes one was affected: a host's cancel_gathering, a creator deleting their
-- community, the cascade from deleting a host's or creator's account (so that account deletion failed too), and 20270393's
-- admin removal (which worked around it by clearing the gate).
--
-- The fix keeps the perk's gate and marks it: gate_removed_at = when its gathering / community went. Before the row goes, a
-- BEFORE DELETE trigger on each table deactivates every perk attached to it and stamps gate_removed_at; the check now accepts a
-- gated perk with no id only when gate_removed_at is set. Such a perk can never be active again (guard below), so a business
-- re-enabling it from the dashboard (the one column it may update: active) can't turn an attendee-only perk into one anyone
-- can redeem. Before this, a perk attached to a gathering without a scope (gathering_id alone gates it in the redemption
-- policy) already lost its gathering on a delete and could be re-enabled as an open perk; it is now marked the same way.
-- Unchanged: redemptions already claimed or confirmed (the perk row stays, so its offer_redemptions stay), expired perks,
-- billing, bookings, refunds and paid reservations (cancel_gathering's own rules), pushes, and every other column of the perk.
-- Perks whose gathering was deleted before this migration can't be identified (the id is already null): left as they are.

alter table public.brand_offers add column if not exists gate_removed_at timestamptz;

alter table public.brand_offers drop constraint brand_offers_unlock_shape_check;
alter table public.brand_offers add constraint brand_offers_unlock_shape_check check (
  ((unlock_scope is null) and (unlock_min_members is null) and (unlock_community_id is null))
  or ((unlock_scope = 'community') and (unlock_min_members is not null) and (unlock_community_id is not null or gate_removed_at is not null))
  or ((unlock_scope = 'gathering') and (unlock_min_members is not null) and (gathering_id is not null or gate_removed_at is not null)));

-- the baseline function, plus the stamp (and it now covers unscoped perks attached to the gathering, as before: gathering_id)
create or replace function public.deactivate_offer_on_gathering_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The perk row survives (SET NULL keeps its redemption history). It is deactivated and marked, so it can't be re-enabled as a
  -- general, unrestricted perk once its gathering_id goes null, and the gate check accepts it without the id.
  update brand_offers set active = false, gate_removed_at = coalesce(gate_removed_at, now()) where gathering_id = old.id;
  return old;
end;
$function$;

create or replace function private.deactivate_offer_on_community_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update brand_offers set active = false, gate_removed_at = coalesce(gate_removed_at, now()) where unlock_community_id = old.id;
  return old;
end;
$function$;
revoke all on function private.deactivate_offer_on_community_delete() from public, anon, authenticated;

drop trigger if exists on_community_deleted_deactivate_offer on public.communities;
create trigger on_community_deleted_deactivate_offer before delete on public.communities
  for each row execute function private.deactivate_offer_on_community_delete();

-- A perk whose gate is gone stays off, and the mark can't be cleared.
create or replace function private.brand_offer_gate_removed_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.gate_removed_at is not null and new.gate_removed_at is null then
    new.gate_removed_at := old.gate_removed_at;
  end if;
  if new.gate_removed_at is not null and new.active then
    raise exception 'This perk was for a gathering or community that no longer exists, so it can''t be turned back on.'
      using hint = 'perk_gate_removed';
  end if;
  return new;
end;
$function$;
revoke all on function private.brand_offer_gate_removed_guard() from public, anon, authenticated;

drop trigger if exists brand_offer_gate_removed_guard on public.brand_offers;
create trigger brand_offer_gate_removed_guard before update on public.brand_offers
  for each row execute function private.brand_offer_gate_removed_guard();

-- 20270393's function without its perk branch: it cleared the gate (unlock_scope null), so a business could later re-enable the
-- perk for everyone. The delete triggers above now handle the perk on every path, the removal included.
create or replace function private.content_removal_close_links(p_type text, p_id uuid, p_bookings boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_offer record;
  v_result jsonb;
  v_request record;
  v_what text := case p_type when 'gathering' then 'A gathering' else 'A community' end;
  m uuid;
begin
  if p_bookings then
    for v_offer in
      select o.id as offer_id, o.partner_id, o.request_id
        from business_request_offers o
        join business_requests r on r.id = o.request_id
       where o.status = 'accepted'
         and ((p_type = 'gathering' and r.gathering_id = p_id) or (p_type = 'community' and r.community_id = p_id))
    loop
      select * into v_request from business_requests where id = v_offer.request_id;
      v_result := _cancel_reservation_by_offer(v_offer.offer_id);
      if (v_result->>'cancelled')::boolean then
        perform public._send_push(v_request.requester_id, 'Your reservation was cancelled',
          v_what || ' linked to your reservation was removed by Nearby, so the reservation was cancelled too.',
          jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        for m in select id from profiles where managed_partner_id = v_offer.partner_id loop
          perform public._send_push(m, 'A reservation was cancelled',
            v_what || ' linked to a reservation was removed by Nearby, so the reservation was cancelled too.',
            jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        end loop;
      elsif v_result->>'reason' = 'payment_captured' then
        perform public._send_push(v_request.requester_id, 'Action needed on your reservation',
          v_what || ' linked to your paid reservation was removed by Nearby. Contact the business directly to arrange a refund.',
          jsonb_build_object('type', 'business_reservation_cancelled', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        for m in select id from profiles where managed_partner_id = v_offer.partner_id loop
          perform public._send_push(m, 'A paid reservation is affected',
            v_what || ' linked to a paid reservation was removed by Nearby. The customer may reach out about a refund.',
            jsonb_build_object('type', 'reservation_cancelled_by_customer', 'request_id', v_request.id, 'offer_id', v_offer.offer_id));
        end loop;
      end if;
    end loop;
  end if;

  update business_request_offers set status = 'cancelled'
   where status in ('pending', 'offered')
     and request_id in (select r.id from business_requests r
                         where (p_type = 'gathering' and r.gathering_id = p_id) or (p_type = 'community' and r.community_id = p_id));
  update business_requests set status = 'cancelled'
   where status = 'open' and ((p_type = 'gathering' and gathering_id = p_id) or (p_type = 'community' and community_id = p_id));

  delete from social_invites where invite_type = p_type and target_id = p_id and status = 'pending';
  delete from business_partnership_requests where target_type = p_type and target_id = p_id;
  update private.ugc_held_items set status = 'superseded'
   where target_table = case p_type when 'gathering' then 'gatherings' else 'communities' end
     and target_id = p_id and status = 'pending';
end;
$function$;
revoke all on function private.content_removal_close_links(text, uuid, boolean) from public, anon, authenticated;
