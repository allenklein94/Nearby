-- Closes roadmap #11 (Rewards) "group-unlock" half: a business can require a
-- linked community or gathering to reach a real member/attendee count before
-- an offer can be redeemed. No fabricated number — unlock_min_members is a
-- threshold the business sets, checked against real, already-trusted counts
-- (community_members rows, or approved gathering_interest rows) at redemption
-- time, not a client-side-only gate.
--
-- unlock_scope null (the default for every existing row) means "no group
-- gate" — fully backward compatible with every offer created before this.
alter table public.brand_offers
  add column if not exists unlock_scope text,
  add column if not exists unlock_community_id uuid references public.communities(id) on delete set null,
  add column if not exists unlock_min_members integer;

alter table public.brand_offers
  drop constraint if exists brand_offers_unlock_scope_check;
alter table public.brand_offers
  add constraint brand_offers_unlock_scope_check check (unlock_scope is null or unlock_scope in ('community', 'gathering'));

alter table public.brand_offers
  drop constraint if exists brand_offers_unlock_min_members_check;
alter table public.brand_offers
  add constraint brand_offers_unlock_min_members_check check (unlock_min_members is null or unlock_min_members > 0);

-- Keep the columns internally consistent: a scope requires its threshold and
-- the matching linked entity (community_id for 'community', the existing
-- gathering_id column for 'gathering' — reused rather than adding a second
-- FK, since a gathering-linked offer already has that column).
alter table public.brand_offers
  drop constraint if exists brand_offers_unlock_shape_check;
alter table public.brand_offers
  add constraint brand_offers_unlock_shape_check check (
    (unlock_scope is null and unlock_min_members is null and unlock_community_id is null)
    or (unlock_scope = 'community' and unlock_min_members is not null and unlock_community_id is not null)
    or (unlock_scope = 'gathering' and unlock_min_members is not null and gathering_id is not null)
  );

-- Enforced server-side at redemption time, not just in the UI: raises
-- 'OFFER_LOCKED' (a recognizable message the client already knows how to
-- catch, matching the existing REDEMPTION_LIMIT_REACHED/23505 handling
-- pattern in redeemOffer()) rather than silently allowing a locked redemption.
create or replace function public.enforce_offer_unlock_threshold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_scope text;
  v_community_id uuid;
  v_min_members integer;
  v_gathering_id uuid;
  v_current_count integer;
begin
  select unlock_scope, unlock_community_id, unlock_min_members, gathering_id
    into v_scope, v_community_id, v_min_members, v_gathering_id
    from brand_offers
    where id = new.offer_id;

  if v_scope is null then
    return new;
  end if;

  if v_scope = 'community' then
    select count(*) into v_current_count
      from community_members
      where community_id = v_community_id;
  else
    select count(*) into v_current_count
      from gathering_interest
      where gathering_id = v_gathering_id and status = 'approved';
  end if;

  if v_current_count < v_min_members then
    raise exception 'OFFER_LOCKED';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_offer_unlock_threshold on public.offer_redemptions;
create trigger trg_enforce_offer_unlock_threshold
  before insert on public.offer_redemptions
  for each row execute function public.enforce_offer_unlock_threshold();

revoke all on function public.enforce_offer_unlock_threshold() from public, anon, authenticated;
