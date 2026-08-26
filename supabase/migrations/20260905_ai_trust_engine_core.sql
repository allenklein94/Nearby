-- Business Intelligence Phase 6, Step 2: AI Trust Engine core + Level 1.
-- Direct continuation of the locked plan in CLAUDE.md ("Aug 26 2026 (cont'd) --
-- Business Intelligence Phase 6 + Phase 8"). Step 1 (real entitlements,
-- 20260826_v4_business_entitlements.sql) already shipped and is live; this
-- migration is Step 2 exactly as locked there: brand_partners.ai_trust_level,
-- the ai_actions immutable audit log, business_ai_policies (table only --
-- its own upsert/delete RPCs are Step 3, in the next migration), a central
-- _ai_authorize_action() gate with the fixed 4-tier risk taxonomy,
-- set_business_ai_trust_level() (entitlement-checked against the already-seeded
-- ai_level_2/ai_level_3 plan_entitlements rows), Level 1 wired into
-- business_attribute_suggestions' existing suggest-flow as a real opt-in
-- auto-apply path, and undo_ai_action() for the one reversible action type
-- this pass adds.

-- ai_trust_level: the one real "current ceiling" number. Every existing
-- row backfills to 0 -- zero behavior change for any business that doesn't
-- touch this.
alter table brand_partners
  add column ai_trust_level integer not null default 0
  check (ai_trust_level between 0 and 3);

-- business_ai_policies: a named, reusable business policy model for
-- Level 2/3. Owner-only, no direct client write -- its own RPCs land in
-- the next migration (Step 3), but the table (and its RLS) exist now so
-- ai_actions has something real to reference.
create table business_ai_policies (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references brand_partners(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trust_level integer not null check (trust_level in (2, 3)),
  action_type text not null check (action_type in ('auto_respond_offer')),
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_ai_policies_partner_id_idx on business_ai_policies(partner_id);

alter table business_ai_policies enable row level security;

create policy "Business owners can view their own AI policies"
  on business_ai_policies for select
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = business_ai_policies.partner_id
  ));

-- ai_actions: the immutable audit log. Owner-only SELECT, no direct client
-- write -- every row is written by a SECURITY DEFINER function.
create table ai_actions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references brand_partners(id) on delete cascade,
  action_type text not null,
  trust_level integer not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  policy_id uuid references business_ai_policies(id) on delete set null,
  input_ref jsonb,
  proposed_action jsonb,
  actual_action jsonb,
  confidence numeric,
  requires_approval boolean not null default false,
  approval_result text not null check (approval_result in ('auto_applied', 'blocked')),
  outcome text,
  reverted_at timestamptz,
  rollback_ref jsonb,
  created_at timestamptz not null default now()
);

create index ai_actions_partner_id_idx on ai_actions(partner_id, created_at desc);

-- Real dedup for the "log a real near-miss, not indiscriminate noise"
-- convention (matches business_match_exclusions' own partial-unique-index
-- precedent) -- a policy that's matched-but-blocked for the same real
-- request is only ever logged once, not once per (re-)evaluation.
create unique index ai_actions_blocked_policy_request_idx
  on ai_actions (policy_id, (input_ref ->> 'request_id'))
  where approval_result = 'blocked';

alter table ai_actions enable row level security;

create policy "Business owners can view their own AI action log"
  on ai_actions for select
  using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.managed_partner_id = ai_actions.partner_id
  ));

-- _ai_authorize_action: the central gate. Not scattered "if tier >= ..."
-- checks -- every action-performing function calls this one place to
-- decide whether a given risk level is currently authorized for a given
-- business, given its own real ai_trust_level. Locked down (no client
-- grant) since it's only ever meant to be called from within another
-- SECURITY DEFINER function, matching _business_request_fanout's/
-- _match_request_to_policy's own established internal-only pattern.
create or replace function public._ai_authorize_action(partner_id_param uuid, risk_level_param text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trust_level integer;
begin
  -- Critical actions (payment, refunds, price changes, contracts) stay
  -- human-authorized, full stop -- never authorized at any trust level.
  if risk_level_param = 'critical' then
    return false;
  end if;

  select ai_trust_level into v_trust_level from brand_partners where id = partner_id_param;
  v_trust_level := coalesce(v_trust_level, 0);

  return case risk_level_param
    when 'low' then v_trust_level >= 1
    when 'medium' then v_trust_level >= 2
    when 'high' then v_trust_level >= 3
    else false
  end;
end;
$function$;

revoke all on function public._ai_authorize_action(uuid, text) from public, anon, authenticated;

-- set_business_ai_trust_level: owner-only, entitlement-checked against the
-- already-seeded ai_level_2/ai_level_3 plan_entitlements rows (Step 1).
-- Level 0/1 are entitled on every real tier today (ai_level_1 is enabled
-- basic|growth|brand), so those two never hit the entitlement check.
create or replace function public.set_business_ai_trust_level(partner_id_param uuid, level_param integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_feature text;
  v_entitlement jsonb;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if level_param not in (0, 1, 2, 3) then
    raise exception 'Invalid AI trust level.';
  end if;

  v_feature := case level_param
    when 2 then 'ai_level_2'
    when 3 then 'ai_level_3'
    else null
  end;

  if v_feature is not null then
    v_entitlement := check_business_entitlement(partner_id_param, v_feature);
    if not coalesce((v_entitlement ->> 'enabled')::boolean, false) then
      raise exception 'Your current plan does not include Level % AI automation.', level_param;
    end if;
  end if;

  update brand_partners set ai_trust_level = level_param where id = partner_id_param;
end;
$function$;

revoke all on function public.set_business_ai_trust_level(uuid, integer) from public, anon;
grant execute on function public.set_business_ai_trust_level(uuid, integer) to authenticated;

-- Level 1 wiring: record_business_attribute_suggestion() re-pointed
-- (pulled fresh from its live body, every prior line unchanged) so a
-- genuinely fresh, real AI-inferred suggestion for one of the two
-- atomically-applicable keys auto-applies the instant it's created,
-- whenever the business has opted in (ai_trust_level >= 1). Every other
-- suggestion (business_confirmed/business_entered -- already the owner's
-- own words; consumer_observed/system_observed -- weaker third-party
-- evidence, matching the locked "never a new customer-facing claim from
-- weak evidence" rule; or a repeat of an already-open suggestion) is
-- completely unaffected -- this only ever changes what happens after a
-- suggestion already exists, per the locked design.
create or replace function public.record_business_attribute_suggestion(
  partner_id_param uuid,
  attribute_key_param text,
  attribute_value_param text,
  source_param text,
  reason_param text default null,
  confidence_param numeric default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_fresh_insert boolean := false;
  v_trust_level integer;
  v_previous_category text;
  v_previous_attributes text[];
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business.';
  end if;

  insert into business_attribute_suggestions (
    partner_id, attribute_key, attribute_value, source, confidence, reason
  ) values (
    partner_id_param, attribute_key_param, attribute_value_param, source_param, confidence_param, reason_param
  )
  on conflict (partner_id, attribute_key, attribute_value) where status = 'suggested'
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from business_attribute_suggestions
    where partner_id = partner_id_param and attribute_key = attribute_key_param
      and attribute_value = attribute_value_param and status = 'suggested'
    limit 1;
  else
    v_fresh_insert := true;
  end if;

  if v_fresh_insert
     and source_param = 'ai_inferred'
     and attribute_key_param in ('category', 'attribute')
     and (attribute_key_param <> 'attribute' or attribute_value_param in (
       'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
       'kid_friendly', 'quiet', 'casual', 'upscale'
     ))
     and _ai_authorize_action(partner_id_param, 'low')
  then
    select ai_trust_level into v_trust_level from brand_partners where id = partner_id_param;

    if attribute_key_param = 'category' then
      select category into v_previous_category from brand_partners where id = partner_id_param;
      update brand_partners set category = attribute_value_param where id = partner_id_param;
    else
      select attributes into v_previous_attributes from brand_partners where id = partner_id_param;
      update brand_partners
      set attributes = array(select distinct unnest(attributes || array[attribute_value_param]))
      where id = partner_id_param;
    end if;

    update business_attribute_suggestions
    set status = 'confirmed', reviewed_at = now()
    where id = v_id;

    insert into ai_actions (
      partner_id, action_type, trust_level, risk_level, input_ref,
      proposed_action, actual_action, confidence, requires_approval, approval_result, rollback_ref
    ) values (
      partner_id_param, 'auto_apply_attribute_suggestion', v_trust_level, 'low',
      jsonb_build_object('suggestion_id', v_id, 'attribute_key', attribute_key_param),
      jsonb_build_object('attribute_key', attribute_key_param, 'attribute_value', attribute_value_param),
      jsonb_build_object('attribute_key', attribute_key_param, 'attribute_value', attribute_value_param),
      confidence_param, false, 'auto_applied',
      case attribute_key_param
        when 'category' then jsonb_build_object('previous_value', v_previous_category)
        else jsonb_build_object('previous_attributes', to_jsonb(coalesce(v_previous_attributes, '{}'::text[])))
      end
    );
  end if;

  return v_id;
end;
$function$;

-- undo_ai_action: the one reversible action type this pass adds. Real,
-- deliberately narrow rollback scope, per the locked design -- restores
-- the pre-change value from rollback_ref and resets the underlying
-- suggestion back to 'suggested' for a real manual re-review. Never
-- applies to auto_respond_offer (Step 3) -- that path's own real
-- mitigation is the already-existing withdraw_business_offer() RPC.
create or replace function public.undo_ai_action(action_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row ai_actions%rowtype;
begin
  select * into v_row from ai_actions where id = action_id_param for update;

  if not found then
    raise exception 'Action not found.';
  end if;

  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = v_row.partner_id
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if v_row.action_type <> 'auto_apply_attribute_suggestion' then
    raise exception 'This action cannot be undone here.';
  end if;

  if v_row.approval_result <> 'auto_applied' then
    raise exception 'This action was not auto-applied.';
  end if;

  if v_row.reverted_at is not null then
    raise exception 'This action has already been undone.';
  end if;

  if (v_row.actual_action ->> 'attribute_key') = 'category' then
    update brand_partners set category = v_row.rollback_ref ->> 'previous_value' where id = v_row.partner_id;
  elsif (v_row.actual_action ->> 'attribute_key') = 'attribute' then
    update brand_partners
    set attributes = array(select jsonb_array_elements_text(coalesce(v_row.rollback_ref -> 'previous_attributes', '[]'::jsonb)))
    where id = v_row.partner_id;
  end if;

  if v_row.input_ref ? 'suggestion_id' then
    update business_attribute_suggestions
    set status = 'suggested', reviewed_at = null
    where id = (v_row.input_ref ->> 'suggestion_id')::uuid
    and partner_id = v_row.partner_id;
  end if;

  update ai_actions set reverted_at = now(), outcome = 'reverted' where id = action_id_param;

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.undo_ai_action(uuid) from public, anon;
grant execute on function public.undo_ai_action(uuid) to authenticated;
