-- Aug 27 2026 plan (CLAUDE.md), Decision 6, Phase 1: a real Business Trust &
-- Safety content-screening layer. Locked risk model, exactly as given: a
-- fixed 13-category policy vocabulary, a fixed 4-tier outcome
-- (low|medium|high|uncertain), AI is a screening signal never the final
-- legal authority -- every medium/high/uncertain outcome routes to a real
-- human, low publishes automatically so a clean business is never
-- bottlenecked.
--
-- Phase 1 scope, deliberately narrow: the schema below is general (every
-- target_type this whole plan eventually needs is already in the CHECK
-- constraint), but only `business_profile` is actually wired end-to-end
-- this phase -- the single largest confirmed gap named in the plan
-- (handleSaveProfile() never screened name/description/differentiator at
-- all). The other five integration points (offer/experience/availability/
-- update/offer_response) are real future phases, not attempted here.
--
-- Enforcement mechanism, matching the locked design: the actual classify
-- call happens inside a new Edge Function (screen-business-content), not
-- inside Postgres -- this codebase's own established lesson (the
-- weather-dependent-fulfillment-policy episode) is that a Postgres
-- transaction can't reliably wait on a synchronous external HTTP call, so
-- the classification + the real write both happen server-side inside the
-- Edge Function using a service-role client (this table) and a
-- bearer-token-scoped client (the real update_business_profile RPC, for a
-- LOW result only) -- never trusted from the client, matching this file's
-- own "never allow the client app to decide whether something is safe"
-- principle from the same day's extended product-doctrine capture.

create table if not exists business_content_screening_results (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references brand_partners(id) on delete cascade,
  target_type text not null check (target_type in (
    'business_profile', 'offer', 'experience', 'availability', 'update', 'offer_response'
  )),
  target_id uuid,
  submitted_by uuid references profiles(id),
  -- A real snapshot of exactly what was screened/proposed -- not just a
  -- pointer to a row that can later change out from under the audit
  -- record. For business_profile this is the full proposed 7-field edit
  -- (name/description/address/logoUrl/category/attributes/cuisine/
  -- differentiator), so a later approval can apply it atomically even if
  -- the live row has since changed underneath it.
  content_snapshot jsonb not null,
  risk_tier text not null check (risk_tier in ('low', 'medium', 'high', 'uncertain')),
  -- The fixed 13-category vocabulary, locked exactly as given -- every
  -- element must be one of these, checked at the schema level (array
  -- containment), not just trusted from the classifier's own output.
  matched_categories text[] not null default '{}',
  constraint business_content_screening_categories_check check (
    matched_categories <@ array[
      'illegal_drugs', 'weapons', 'explosives', 'fraud_scams', 'counterfeit_goods',
      'sexual_exploitation', 'illegal_gambling', 'dangerous_services', 'hate_extremist',
      'human_trafficking', 'unregulated_medical_claims', 'financial_scams', 'business_impersonation'
    ]::text[]
  ),
  -- Real free text from the classifier, never fabricated after the fact --
  -- always populated (even a clean LOW result gets a real "nothing
  -- concerning" reasoning, not left null), so the audit trail always shows
  -- why a tier was assigned.
  model_reasoning text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  -- 'auto_blocked' is a real, distinct outcome from a human's own
  -- approved/denied -- a HIGH result is rejected immediately with no human
  -- decision required, but the audit trail must stay honest that no human
  -- actually made this specific call.
  review_outcome text check (review_outcome in ('approved', 'denied', 'auto_blocked')),
  created_at timestamptz not null default now()
);

create index if not exists business_content_screening_partner_idx on business_content_screening_results(partner_id);
-- The admin Content Review Queue's own real query shape: every row still
-- genuinely awaiting a human decision.
create index if not exists business_content_screening_pending_idx on business_content_screening_results(created_at)
  where review_outcome is null;

alter table business_content_screening_results enable row level security;

-- Owner-only SELECT (an audit trail of a business's own content, real
-- personal/business record, same posture as business_invoices/
-- partner_contracts elsewhere in this schema) -- no direct client
-- INSERT/UPDATE at all, matching this schema's established "no direct
-- client write on a table this schema mediates through RPCs" convention.
-- Written only by record_business_content_screening() (service-role only,
-- called from inside the Edge Function) and reviewed only by
-- admin_review_business_content_screening() (admin-gated).
create policy "Business owners can view their own screening history"
  on business_content_screening_results for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.managed_partner_id = business_content_screening_results.partner_id
    )
  );

create policy "Admins can view every screening result"
  on business_content_screening_results for select
  using (check_is_admin(auth.uid()));

revoke all on business_content_screening_results from public, anon, authenticated;
grant select on business_content_screening_results to authenticated;

-- Internal-only insert, called exclusively from inside the Edge Function's
-- own service-role client -- no client (authenticated or anon) can insert
-- a screening row directly, since the whole point is that the client can
-- never self-report a risk tier.
create or replace function record_business_content_screening(
  partner_id_param uuid,
  target_type_param text,
  target_id_param uuid,
  submitted_by_param uuid,
  content_snapshot_param jsonb,
  risk_tier_param text,
  matched_categories_param text[],
  model_reasoning_param text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_review_outcome text;
begin
  v_review_outcome := case when risk_tier_param = 'high' then 'auto_blocked' else null end;

  insert into business_content_screening_results (
    partner_id, target_type, target_id, submitted_by, content_snapshot,
    risk_tier, matched_categories, model_reasoning, review_outcome,
    reviewed_at
  ) values (
    partner_id_param, target_type_param, target_id_param, submitted_by_param, content_snapshot_param,
    risk_tier_param, matched_categories_param, model_reasoning_param, v_review_outcome,
    case when v_review_outcome is not null then now() else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_business_content_screening(uuid, text, uuid, uuid, jsonb, text, text[], text) from public, anon, authenticated;
grant execute on function record_business_content_screening(uuid, text, uuid, uuid, jsonb, text, text[], text) to service_role;

-- Admin-only: every row genuinely still awaiting a human decision (medium/
-- uncertain, review_outcome still null -- a HIGH row's review_outcome is
-- already 'auto_blocked' the instant it's logged, so it never appears in
-- this queue; matches the locked design's own "listing every MEDIUM/
-- UNCERTAIN row" text exactly).
create or replace function admin_get_pending_content_screenings()
returns table (
  id uuid,
  partner_id uuid,
  partner_name text,
  target_type text,
  target_id uuid,
  content_snapshot jsonb,
  risk_tier text,
  matched_categories text[],
  model_reasoning text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can view the content review queue';
  end if;

  return query
  select
    s.id, s.partner_id, bp.name, s.target_type, s.target_id, s.content_snapshot,
    s.risk_tier, s.matched_categories, s.model_reasoning, s.created_at
  from business_content_screening_results s
  join brand_partners bp on bp.id = s.partner_id
  -- Real bug caught by live verification, not just applied and trusted:
  -- review_outcome is only ever auto-set for a HIGH result at insert time
  -- (auto_blocked) -- a LOW result's review_outcome is *also* null (never
  -- needed a human decision at all), so filtering on review_outcome is
  -- null alone incorrectly pulled clean, already-published LOW rows into
  -- the review queue. The risk_tier filter is the real gate.
  where s.review_outcome is null and s.risk_tier in ('medium', 'uncertain')
  order by s.created_at asc;
end;
$$;

revoke all on function admin_get_pending_content_screenings() from public, anon;
grant execute on function admin_get_pending_content_screenings() to authenticated;

-- Admin-only real approve/deny -- double-review guarded (only ever acts on
-- a row still genuinely pending), applies the real staged content_snapshot
-- to the live row on approve (for business_profile: the same 7 fields
-- update_business_profile() itself already writes), does nothing to the
-- live row on deny (the old, already-approved content was never touched in
-- the first place, so there's nothing to revert).
create or replace function admin_review_business_content_screening(
  screening_id_param uuid,
  approve_param boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row business_content_screening_results;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator'
    where id = v_row.partner_id;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$$;

revoke all on function admin_review_business_content_screening(uuid, boolean) from public, anon;
grant execute on function admin_review_business_content_screening(uuid, boolean) to authenticated;
