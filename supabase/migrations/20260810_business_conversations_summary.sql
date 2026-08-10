-- Scalability audit step 6 (PRODUCT_AUDIT/SCALABILITY_AUDIT.md, locked
-- decision 4): getBusinessConversations() previously downloaded EVERY
-- message across every conversation a business has ever had, just to keep
-- the first (most recent) row per conversation_with_id in JS -- the worst
-- shape found in the whole audit, scaling with both customer count and
-- history length at once. Same ownership-check convention as every other
-- business RPC (get_business_dashboard_stats et al.): a caller who doesn't
-- manage partner_id_param gets an empty result, not an error.
--
-- Also fixes a real, previously-undetected bug found while touching this
-- exact code path: the old client-side grouping in getBusinessConversations
-- never carried `from_business` onto its returned objects, but
-- BusinessDashboardScreen.js's loadNeedsAttention() filtered on
-- `c.from_business` anyway -- `!undefined` is always true, so the
-- "N conversations waiting for a reply" task always counted every single
-- conversation, never just the ones actually awaiting an owner reply. This
-- RPC returns the last message's from_business flag so that can be computed
-- correctly.
create or replace function public.get_business_conversations_summary(partner_id_param uuid)
returns table (
  conversation_with_id uuid,
  display_name text,
  last_message text,
  last_at timestamptz,
  last_from_business boolean
)
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  return query
  select distinct on (m.conversation_with_id)
    m.conversation_with_id,
    p.display_name,
    m.body,
    m.created_at,
    m.from_business
  from business_messages m
  join profiles p on p.id = m.conversation_with_id
  where m.partner_id = partner_id_param
  order by m.conversation_with_id, m.created_at desc
  limit 500;
end;
$$;

revoke all on function public.get_business_conversations_summary(uuid) from public, anon;
grant execute on function public.get_business_conversations_summary(uuid) to authenticated;
