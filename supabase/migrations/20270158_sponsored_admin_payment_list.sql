-- Read side for the sponsored refund screen. Approver-only (platform admin AND named finance approver); returns
-- payments and the refund audit trail, never consumer data. Raises for anyone else (fail closed).
create or replace function public.admin_list_sponsored_payments()
returns table (
  payment_id uuid, partner_name text, title text, starts_at timestamptz, ends_at timestamptz, placement_status text,
  payment_status text, amount_cents integer, refunded_cents integer, currency text, refund_due boolean,
  last_refund_status text, last_refund_cents integer
)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not _sponsored_is_finance_approver(auth.uid()) then raise exception 'sponsored_refund:not_an_approver'; end if;
  return query
    select y.id, bp.name, p.title, p.starts_at, p.ends_at, p.status, y.status, y.amount_cents, y.refunded_cents,
           y.currency, y.refund_due,
           (select a.status from sponsored_admin_actions a where a.payment_id = y.id order by a.created_at desc limit 1),
           (select a.amount_cents from sponsored_admin_actions a where a.payment_id = y.id order by a.created_at desc limit 1)
    from sponsored_payments y
    join sponsored_placements p on p.id = y.placement_id
    join brand_partners bp on bp.id = p.partner_id
    where y.status in ('paid', 'partially_refunded', 'refunded', 'disputed')
    order by y.refund_due desc, y.created_at desc limit 50;
end $$;
revoke all on function public.admin_list_sponsored_payments() from public, anon;
grant execute on function public.admin_list_sponsored_payments() to authenticated, service_role;
