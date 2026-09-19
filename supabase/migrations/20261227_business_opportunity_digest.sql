-- Business opportunity DIGEST push. Nearby matches requests to businesses; instead of one push per request, an owner
-- gets "N new opportunities that fit your business" (count only, no request content) at most once every 6 hours.
-- Per-request pushes are kept ONLY for urgent requests (needed today or tomorrow) so a same-day ask is never delayed.
-- The push type business_opportunities_digest is in the owner's "requests" mute group and is emailed to web-only owners
-- like business_opportunity_received (see send-push).

create table if not exists public.business_opportunity_digest_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_digest_at timestamptz not null default now()
);
alter table public.business_opportunity_digest_state enable row level security;
revoke all on public.business_opportunity_digest_state from public, anon, authenticated;

create or replace function public._opportunity_is_urgent(request_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select date is not null and date <= current_date + 1 from business_requests where id = request_id_param), false);
$$;
revoke all on function public._opportunity_is_urgent(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  v_req_attributes text[];
  v_req_cuisine text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine into v_raw_text, v_req_attributes, v_req_cuisine from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, p.attributes, p.cuisine, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
      and (category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
      and (business_major_filter_param is null or p.category = business_major_filter_param)
    ),
    reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, e.id
    from eligible e
    left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
    limit 10
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        -- Only urgent requests ping immediately; the rest are gathered into the hourly digest (send_business_opportunity_digests).
        continue when not public._opportunity_is_urgent(request_id_param);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'New request: ' || public.business_safe_request_summary(request_id_param),
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$;

create or replace function public.send_business_opportunity_digests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
      and o.viewed_at is null
      and o.created_at > v_since
      and r.status = 'open'
      and r.expires_at > now()
      and not public._opportunity_is_urgent(r.id);
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
$fn$;
revoke all on function public.send_business_opportunity_digests() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'send-business-opportunity-digests';
select cron.schedule('send-business-opportunity-digests', '5 * * * *', 'select send_business_opportunity_digests();');

-- Seed: existing owners already got per-request pushes for what is open now, so the first digest covers only what arrives after this.
insert into public.business_opportunity_digest_state (user_id, last_digest_at)
select id, now() from public.profiles where managed_partner_id is not null
on conflict (user_id) do nothing;
