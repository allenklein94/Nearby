-- Sponsored placement, PHASE 3: the owner's own approximate reporting (design section 9). Totals per own placement
-- only: impressions and taps. No identities, no distinct-people figure, never another business's placement.
create or replace function public.get_my_sponsored_stats()
returns table (placement_id uuid, impressions bigint, taps bigint)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare v_partner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  if v_partner is null then return; end if;
  return query
    select p.id, coalesce(sum(d.impressions), 0)::bigint, coalesce(sum(d.taps), 0)::bigint
    from sponsored_placements p left join sponsored_daily_stats d on d.placement_id = p.id
    where p.partner_id = v_partner group by p.id;
end $$;
revoke all on function public.get_my_sponsored_stats() from public, anon;
grant execute on function public.get_my_sponsored_stats() to authenticated, service_role;
