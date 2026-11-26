-- Rollback of 20270420 (offer screening automatic retry). Puts back the manual-only behaviour: a pending automatic try
-- becomes a plain 'unavailable' submission (Try again), nothing is published or deleted. The reader and dismiss are
-- restored verbatim from 20270299 / 20270174. Redeploy the previous screen-business-content first (or together): the
-- new edge code calls _record_offer_screening_unavailable and falls back to a plain 'unavailable' update without it.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'retry-offer-screening') then
    perform cron.unschedule('retry-offer-screening');
  end if;
end;
$cron$;

drop function if exists public.dispatch_offer_screening_retries();
drop function if exists public.claim_due_offer_screening_retries(int);
drop function if exists public._submit_business_offer_for_submission(uuid, jsonb, uuid);
drop function if exists public._record_offer_screening_unavailable(uuid, text);
drop function if exists private.offer_screening_retry_delay(int);

drop function if exists public.get_my_offer_submissions(uuid);
create function public.get_my_offer_submissions(partner_id_param uuid)
 returns table(id uuid, request_id uuid, status text, reason text, matched_categories text[], payload jsonb, created_at timestamp with time zone, retryable boolean, is_first_offer boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  select x.id, x.request_id, x.status, x.reason, x.matched_categories, x.payload, x.created_at, x.retryable,
    -- item 51: only a sent submission, and only the one whose request holds the business's first-ever offer
    -- ((request_id, partner_id) is unique on business_request_offers, so this also covers reviewer-approved offers).
    (x.status = 'published' and exists (select 1 from partner_first_offers f where f.partner_id = partner_id_param and f.request_id = x.request_id))
  from (
    select s.id, s.request_id,
      case
        when s.status = 'in_review' and r.review_outcome = 'approved' then 'published'
        when s.status = 'in_review' and r.review_outcome = 'denied' then 'needs_changes'
        when s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes' then 'unavailable'
        else s.status
      end as status,
      case when s.status = 'in_review' and r.review_outcome = 'denied' then 'Our review team could not approve this offer.' else s.reason end as reason,
      s.matched_categories,
      s.payload,
      s.created_at,
      (s.status = 'unavailable' or (s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes')) as retryable
    from business_offer_submissions s
    left join business_content_screening_results r on r.id = s.screening_id
    where s.partner_id = partner_id_param
      and s.dismissed_at is null
      and s.created_at > now() - interval '7 days'
    order by s.created_at desc
    limit 50
  ) x
  order by x.created_at desc;
end;
$function$;
revoke all on function public.get_my_offer_submissions(uuid) from public, anon;
grant execute on function public.get_my_offer_submissions(uuid) to authenticated, service_role;

create or replace function dismiss_offer_submission(submission_id_param uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_row business_offer_submissions;
begin
  select * into v_row from business_offer_submissions where id = submission_id_param for update;
  if not found or not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = v_row.partner_id) then
    raise exception 'You do not manage this business';
  end if;
  if v_row.status in ('reviewing') and v_row.updated_at >= now() - interval '3 minutes' then
    raise exception 'This offer is still being reviewed.';
  end if;
  if v_row.status = 'in_review' then
    raise exception 'This offer is waiting on our review team.';
  end if;
  update business_offer_submissions set dismissed_at = now() where id = submission_id_param;
end;
$$;
revoke all on function dismiss_offer_submission(uuid) from public, anon;
grant execute on function dismiss_offer_submission(uuid) to authenticated;

drop index if exists public.business_offer_submissions_retry_due_idx;
alter table public.business_offer_submissions drop constraint if exists business_offer_submissions_last_failure_check;
alter table public.business_offer_submissions drop column if exists last_failure, drop column if exists next_retry_at, drop column if exists auto_retries;
