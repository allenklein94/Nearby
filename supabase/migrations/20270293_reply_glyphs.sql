-- Owner item 18 (2026-10-10, LOCKED): the in-app arrival pill shows the same category glyph as the business-response push
-- ("☕ Coastal Coffee responded"), with the pill's existing motion unchanged. One source: the push's own
-- _offer_push_emoji(request category, occasion) is read here, so the pill and the push can never disagree. Request
-- category and occasion only (structured fields), never inferred from text; anything unmapped = ✨. Requester only; an
-- id that is not the caller's own request returns nothing.
create or replace function public.get_reply_glyphs(request_ids_param uuid[])
returns table (request_id uuid, glyph text)
language sql
stable
security definer
set search_path = public
as $$
  select br.id,
         _offer_push_emoji(br.category, (select oc.occasion_type from _occasion_context_for_business_request(br.id) oc))
  from business_requests br
  where br.id = any(request_ids_param[1:20])
    and br.requester_id = auth.uid();
$$;
revoke all on function public.get_reply_glyphs(uuid[]) from public, anon;
grant execute on function public.get_reply_glyphs(uuid[]) to authenticated;
