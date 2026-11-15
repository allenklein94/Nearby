-- Offer screening retries itself after a temporary failure (owner, 2026-11-15). Reliability only: what is allowed is
-- unchanged and screening stays fail-closed (nothing reaches a customer before it clears).
--
-- Before: a screening outage left the saved submission 'unavailable' until the business pressed Try again.
-- Now: a TEMPORARY failure (timeout, network, rate limit, provider 5xx/overloaded, a stalled run) is retried by the
-- server on the same saved submission about 30 s, 2 min and 5 min later (a once-a-minute job, so each wait is that
-- long or up to a minute longer). A PERMANENT failure (the provider refused the call: billing/credit, key, bad request)
-- is not retried. After the third automatic try, or a permanent failure, Try again works exactly as before.
--
-- No duplicates: the job claims a row with FOR UPDATE SKIP LOCKED and the same conditional status change Try again
-- uses (only one of them can move a row to 'reviewing'); the unique "one live submission per business per request"
-- index is unchanged; the business's result push still fires only on reviewing -> final (one per settled run).
-- A retry publishes through _submit_business_offer_for_submission, which sends the offer AND marks the submission
-- published in one transaction, so a second publish of the same submission is refused.
-- Stops: the business dismisses it, or the request is no longer open (closed/expired: the row becomes 'not_sent').
-- An offer whose own end time has passed is refused by the unchanged validation on the retry ('needs_changes').
--
-- Server only: no client grant on any new function; the owner-facing reader keeps its signature.

alter table public.business_offer_submissions
  add column if not exists auto_retries int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_failure text;
alter table public.business_offer_submissions drop constraint if exists business_offer_submissions_last_failure_check;
alter table public.business_offer_submissions add constraint business_offer_submissions_last_failure_check
  check (last_failure is null or last_failure in ('transient', 'permanent'));
create index if not exists business_offer_submissions_retry_due_idx
  on public.business_offer_submissions (next_retry_at) where next_retry_at is not null;

-- The one schedule: wait before automatic try n+1 (n = automatic tries already made). Null = no more automatic tries.
create or replace function private.offer_screening_retry_delay(auto_retries_param int)
returns interval
language sql
immutable
as $$
  select case auto_retries_param when 0 then interval '30 seconds' when 1 then interval '2 minutes'
                                 when 2 then interval '5 minutes' else null end;
$$;
revoke all on function private.offer_screening_retry_delay(int) from public, anon, authenticated;

-- Called by screen-business-content when a run could not finish. Only a row still 'reviewing' (the run that owned it)
-- is changed. Returns the time of the next automatic try, or null (Try again only).
create or replace function public._record_offer_screening_unavailable(submission_id_param uuid, failure_param text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := case when failure_param = 'permanent' then 'permanent' else 'transient' end;
  v_next timestamptz;
begin
  update business_offer_submissions s
     set status = 'unavailable', reason = null, last_failure = v_kind, updated_at = now(),
         next_retry_at = case
           when v_kind = 'transient' and s.dismissed_at is null
                and exists (select 1 from business_requests br where br.id = s.request_id and br.status = 'open'
                            and (br.expires_at is null or br.expires_at > now()))
           then now() + private.offer_screening_retry_delay(s.auto_retries)
           else null end
   where s.id = submission_id_param and s.status = 'reviewing'
  returning s.next_retry_at into v_next;
  return v_next;
end;
$$;
revoke all on function public._record_offer_screening_unavailable(uuid, text) from public, anon, authenticated;
grant execute on function public._record_offer_screening_unavailable(uuid, text) to service_role;

-- Claims the submissions due for an automatic try: an 'unavailable' row whose time has come, or a run that stalled
-- (still 'reviewing' after 3 minutes: the background run died) with automatic tries left. A due row whose request is
-- no longer open becomes 'not_sent' instead (never screened again). Each claimed row moves to 'reviewing' with one
-- more automatic try counted, exactly as Try again's claim does.
create or replace function public.claim_due_offer_screening_retries(limit_param int default 10)
returns table (submission_id uuid, partner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  update business_offer_submissions s
     set status = 'not_sent', reason = 'This request is no longer open.', next_retry_at = null, updated_at = now()
   where s.dismissed_at is null
     and ((s.status = 'unavailable' and s.next_retry_at is not null)
          or (s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes' and s.auto_retries < 3))
     and not exists (select 1 from business_requests br where br.id = s.request_id and br.status = 'open'
                     and (br.expires_at is null or br.expires_at > now()));

  return query
  with due as (
    select s.id from business_offer_submissions s
     where s.dismissed_at is null
       and ((s.status = 'unavailable' and s.next_retry_at <= now())
            or (s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes' and s.auto_retries < 3))
     order by coalesce(s.next_retry_at, s.updated_at)
     limit greatest(1, least(coalesce(limit_param, 10), 50))
     for update skip locked
  )
  update business_offer_submissions s
     set status = 'reviewing', reason = null, matched_categories = '{}', next_retry_at = null,
         auto_retries = s.auto_retries + 1, attempts = s.attempts + 1, updated_at = now()
    from due where s.id = due.id
  returning s.id, s.partner_id;
end;
$$;
revoke all on function public.claim_due_offer_screening_retries(int) from public, anon, authenticated;
grant execute on function public.claim_due_offer_screening_retries(int) to service_role;

-- A cleared automatic try publishes here: the job has no signed-in owner, so this sends the offer as the person who
-- submitted it (only while they still manage that business, only for this submission's own request, only while the
-- submission is 'reviewing'), through the unchanged submit_business_offer, and marks the submission published in the
-- same transaction. Server only.
create or replace function public._submit_business_offer_for_submission(submission_id_param uuid, args_param jsonb,
                                                                         screening_id_param uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub business_offer_submissions;
  v_result jsonb;
begin
  select * into v_sub from business_offer_submissions where id = submission_id_param for update;
  if not found or v_sub.status <> 'reviewing' or v_sub.dismissed_at is not null then
    raise exception 'This offer is not waiting to be sent.' using hint = 'submission_not_reviewing';
  end if;
  if coalesce(args_param->>'request_id_param', '') <> v_sub.request_id::text then
    raise exception 'This offer is for a different request.' using hint = 'submission_request_mismatch';
  end if;
  if not exists (select 1 from profiles p where p.id = v_sub.submitted_by and p.managed_partner_id = v_sub.partner_id) then
    raise exception 'You do not manage this business';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sub.submitted_by, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_sub.submitted_by::text, true);

  v_result := submit_business_offer(
    request_id_param := v_sub.request_id,
    offer_type_param := args_param->>'offer_type_param',
    offer_description_param := args_param->>'offer_description_param',
    offer_price_param := (args_param->>'offer_price_param')::numeric,
    proposed_time_param := (args_param->>'proposed_time_param')::timestamptz,
    experience_id_param := (args_param->>'experience_id_param')::uuid,
    media_path_param := args_param->>'media_path_param',
    media_type_param := args_param->>'media_type_param',
    offer_title_param := args_param->>'offer_title_param',
    included_items_param := coalesce(array(select jsonb_array_elements_text(
                              case when jsonb_typeof(args_param->'included_items_param') = 'array' then args_param->'included_items_param' else '[]'::jsonb end)), '{}'),
    price_is_per_person_param := coalesce((args_param->>'price_is_per_person_param')::boolean, false),
    discount_pct_param := (args_param->>'discount_pct_param')::numeric,
    redemption_instructions_param := args_param->>'redemption_instructions_param',
    media_poster_path_param := args_param->>'media_poster_path_param',
    creative_id_param := (args_param->>'creative_id_param')::uuid,
    valid_until_param := (args_param->>'valid_until_param')::timestamptz,
    available_from_param := (args_param->>'available_from_param')::time,
    available_until_param := (args_param->>'available_until_param')::time,
    proposed_time_alt_param := (args_param->>'proposed_time_alt_param')::timestamptz,
    proposed_party_size_alt_param := (args_param->>'proposed_party_size_alt_param')::smallint);

  update business_offer_submissions
     set status = 'published', offer_id = nullif(v_result->>'offerId', '')::uuid,
         screening_id = coalesce(screening_id_param, screening_id), next_retry_at = null, updated_at = now()
   where id = submission_id_param;
  return v_result;
end;
$$;
revoke all on function public._submit_business_offer_for_submission(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public._submit_business_offer_for_submission(uuid, jsonb, uuid) to service_role;

-- The once-a-minute job: claims due rows and hands each to screen-business-content (same key + address pattern as
-- the push outbox). A hand-off that cannot be queued is undone for that row (its claim rolls back), so nothing is
-- counted or lost; a hand-off queued but never run leaves the row 'reviewing' and it is claimed again once stalled.
create or replace function public.dispatch_offer_screening_retries()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  r record;
  v_n int := 0;
  v_dry boolean := current_setting('app.offer_retry_dispatch_dry_run', true) = 'on';
begin
  if not v_dry then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_key is null then return 0; end if;
  end if;
  for r in select * from claim_due_offer_screening_retries(10) loop
    begin
      if not v_dry then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/screen-business-content',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
          body := jsonb_build_object('targetType', 'offer_response', 'partnerId', r.partner_id, 'autoRetrySubmissionId', r.submission_id));
      end if;
      v_n := v_n + 1;
    exception when others then
      update business_offer_submissions
         set status = 'unavailable', last_failure = 'transient', next_retry_at = now() + interval '1 minute',
             auto_retries = greatest(auto_retries - 1, 0), attempts = greatest(attempts - 1, 1), updated_at = now()
       where id = r.submission_id and status = 'reviewing';
    end;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.dispatch_offer_screening_retries() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'retry-offer-screening') then
      perform cron.unschedule('retry-offer-screening');
    end if;
    perform cron.schedule('retry-offer-screening', '* * * * *', 'select public.dispatch_offer_screening_retries()');
  end if;
end;
$cron$;

-- Owner view (20270299's version + one rule): a submission waiting for its automatic try reads as still being checked
-- ('reviewing', no Try again); once automatic tries are over (or the job has not picked it up within 3 minutes of its
-- time) it reads 'unavailable' with Try again, as before. Return shape, grants and every other rule unchanged.
create or replace function public.get_my_offer_submissions(partner_id_param uuid)
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
        when s.status = 'unavailable' and s.next_retry_at is not null and s.next_retry_at > now() - interval '3 minutes' then 'reviewing'
        when s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes' then 'unavailable'
        else s.status
      end as status,
      case when s.status = 'in_review' and r.review_outcome = 'denied' then 'Our review team could not approve this offer.' else s.reason end as reason,
      s.matched_categories,
      s.payload,
      s.created_at,
      ((s.status = 'unavailable' and (s.next_retry_at is null or s.next_retry_at <= now() - interval '3 minutes'))
        or (s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes')) as retryable
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

-- Dismissing a submission also cancels its pending automatic try. Otherwise unchanged.
create or replace function public.dismiss_offer_submission(submission_id_param uuid)
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
  update business_offer_submissions set dismissed_at = now(), next_retry_at = null where id = submission_id_param;
end;
$$;
revoke all on function public.dismiss_offer_submission(uuid) from public, anon;
grant execute on function public.dismiss_offer_submission(uuid) to authenticated;
