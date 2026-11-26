-- Rollback of 20270394 (a gated perk no longer blocks deleting its gathering / community). Defect only; owner decides.
-- Perks already marked (their gathering or community deleted after 0394) keep active = false; their gate is cleared so the old
-- check holds again, as 20270393's removal did. From then on a business could turn such a perk back on for everyone, and deleting a
-- gathering / community with a gated perk fails again (the original defect). Nothing to do in the app first.
drop trigger if exists brand_offer_gate_removed_guard on public.brand_offers;
drop function if exists private.brand_offer_gate_removed_guard();
drop trigger if exists on_community_deleted_deactivate_offer on public.communities;
drop function if exists private.deactivate_offer_on_community_delete();

update public.brand_offers set unlock_scope = null, unlock_min_members = null, unlock_community_id = null
 where gate_removed_at is not null
   and ((unlock_scope = 'gathering' and gathering_id is null) or (unlock_scope = 'community' and unlock_community_id is null));

alter table public.brand_offers drop constraint brand_offers_unlock_shape_check;
alter table public.brand_offers add constraint brand_offers_unlock_shape_check check (
  ((unlock_scope is null) and (unlock_min_members is null) and (unlock_community_id is null))
  or ((unlock_scope = 'community') and (unlock_min_members is not null) and (unlock_community_id is not null))
  or ((unlock_scope = 'gathering') and (unlock_min_members is not null) and (gathering_id is not null)));
alter table public.brand_offers drop column if exists gate_removed_at;

-- the baseline function
create or replace function public.deactivate_offer_on_gathering_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Preserves redemption history (the offer row itself survives via
  -- SET NULL), but explicitly deactivates it too — otherwise an
  -- attendance-gated offer would silently become a general,
  -- unrestricted, publicly redeemable offer the moment its
  -- gathering_id goes null, bypassing the whole point of attaching
  -- it to a specific gathering in the first place.
  update brand_offers set active = false where gathering_id = old.id;
  return old;
end;
$function$
;

-- 20270393's function
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

  -- A perk gated on this object stops, gate cleared with it: the check on brand_offers refuses a gated perk with the id gone, so
  -- the delete below would fail, and a perk left active with no gate would open to everyone.
  update brand_offers set active = false, unlock_scope = null, unlock_min_members = null, unlock_community_id = null
   where (p_type = 'community' and unlock_community_id = p_id)
      or (p_type = 'gathering' and gathering_id = p_id and unlock_scope = 'gathering');

  delete from social_invites where invite_type = p_type and target_id = p_id and status = 'pending';
  delete from business_partnership_requests where target_type = p_type and target_id = p_id;
  update private.ugc_held_items set status = 'superseded'
   where target_table = case p_type when 'gathering' then 'gatherings' else 'communities' end
     and target_id = p_id and status = 'pending';
end;
$function$;
revoke all on function private.content_removal_close_links(text, uuid, boolean) from public, anon, authenticated;
