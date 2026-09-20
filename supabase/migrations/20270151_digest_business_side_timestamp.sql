-- Digest chronology fix (owner item 39). The digest counted only pending offers with `viewed_at is null`, but
-- `viewed_at` is the CONSUMER's read receipt on an offer (mark_business_offer_viewed, requester-only), which is never
-- set on a pending opportunity -- so it filtered nothing and meant the wrong side. The business-side timestamp is
-- `created_at` (the moment the request was routed to this business), already used by the `created_at > last digest`
-- condition, so "new since the last digest" is now the only recency rule. No "viewed" state is added on either side.
CREATE OR REPLACE FUNCTION public.send_business_opportunity_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_since timestamptz;
  v_count integer;
  v_sent integer := 0;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is null then
    return 0;
  end if;

  for v_row in
    select p.id as user_id, p.managed_partner_id as partner_id, s.last_digest_at
    from profiles p
    left join business_opportunity_digest_state s on s.user_id = p.id
    where p.managed_partner_id is not null
      and coalesce(p.notify_business, true)
      and (s.last_digest_at is null or s.last_digest_at <= now() - interval '6 hours')
  loop
    v_since := coalesce(v_row.last_digest_at, now() - interval '1 day');
    select count(*) into v_count
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where o.partner_id = v_row.partner_id
      and o.status = 'pending'
      and o.created_at > v_since
      and r.status = 'open'
      and r.expires_at > now()
      and not public._opportunity_is_urgent(r.id)
      and not o.is_directed;
    continue when v_count = 0;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_row.user_id,
        'title', v_count || ' new ' || case when v_count = 1 then 'opportunity' else 'opportunities' end || ' that fit your business',
        'body', 'Nearby matched them for you. Open to view and reply.',
        'data', jsonb_build_object('type', 'business_opportunities_digest', 'count', v_count)
      )
    );
    insert into business_opportunity_digest_state (user_id, last_digest_at) values (v_row.user_id, now())
    on conflict (user_id) do update set last_digest_at = excluded.last_digest_at;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;
