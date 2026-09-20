-- Item 83: offer screening is asynchronous. The business submits, the offer is saved as a SUBMISSION
-- ("Reviewing your offer..."), screening runs in the background, and the offer is published only when cleared.
-- Nothing changes about WHAT is allowed: fail-closed stays (an outage leaves the submission unpublished and
-- retryable), and the existing screening audit rows + admin review queue are untouched. This table is only the
-- owner-visible progress record. Written by the screen-business-content edge function (service role) only.

create table if not exists business_offer_submissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references brand_partners(id) on delete cascade,
  request_id uuid not null references business_requests(id) on delete cascade,
  submitted_by uuid not null references profiles(id),
  -- The sanitized offer the owner submitted (their own content), so "Edit and resend" / "Try again" need no retyping.
  payload jsonb not null,
  status text not null default 'reviewing' check (status in (
    'reviewing',      -- screening in progress
    'in_review',      -- held for a person on the Nearby team (outcome read from the screening row)
    'published',      -- cleared and sent to the customer
    'needs_changes',  -- screening refused it; matched_categories/reason say why
    'unavailable',    -- the screening service failed; nothing was decided, Try again
    'not_sent'        -- cleared, but could not be sent (e.g. the request is no longer open); reason says why
  )),
  reason text,
  matched_categories text[] not null default '{}',
  screening_id uuid references business_content_screening_results(id) on delete set null,
  offer_id uuid,
  attempts int not null default 1,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live submission per business per request: no double-sends while one is still being decided.
create unique index if not exists business_offer_submissions_one_active
  on business_offer_submissions(partner_id, request_id)
  where status in ('reviewing', 'in_review', 'unavailable') and dismissed_at is null;
create index if not exists business_offer_submissions_partner_idx on business_offer_submissions(partner_id, created_at desc);

alter table business_offer_submissions enable row level security;
revoke all on business_offer_submissions from public, anon, authenticated;

-- Owner-only progress list. Effective status folds in the human decision for a held row, and marks a submission
-- that has been "reviewing" for over 3 minutes as stalled (the background job may have died) so it can be retried.
create or replace function get_my_offer_submissions(partner_id_param uuid)
returns table (
  id uuid, request_id uuid, status text, reason text, matched_categories text[],
  payload jsonb, created_at timestamptz, retryable boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = partner_id_param) then
    raise exception 'You do not manage this business';
  end if;
  return query
  select s.id, s.request_id,
    case
      when s.status = 'in_review' and r.review_outcome = 'approved' then 'published'
      when s.status = 'in_review' and r.review_outcome = 'denied' then 'needs_changes'
      when s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes' then 'unavailable'
      else s.status
    end,
    case when s.status = 'in_review' and r.review_outcome = 'denied' then 'Our review team could not approve this offer.' else s.reason end,
    s.matched_categories,
    s.payload,
    s.created_at,
    (s.status = 'unavailable' or (s.status = 'reviewing' and s.updated_at < now() - interval '3 minutes'))
  from business_offer_submissions s
  left join business_content_screening_results r on r.id = s.screening_id
  where s.partner_id = partner_id_param
    and s.dismissed_at is null
    and s.created_at > now() - interval '7 days'
  order by s.created_at desc
  limit 50;
end;
$$;
revoke all on function get_my_offer_submissions(uuid) from public, anon;
grant execute on function get_my_offer_submissions(uuid) to authenticated;

-- Hide a finished (or abandoned) submission from the list. A submission still being decided cannot be dismissed
-- (except a stalled/unavailable one, which the owner may discard to send a fresh offer).
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
