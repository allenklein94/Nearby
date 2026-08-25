-- Business Intelligence & Opportunity Engine, Phase 1 (see CLAUDE.md's own
-- "Business Intelligence & Opportunity Engine" plan) -- the Attribute
-- Provenance / Trust Ladder + AI Suggestion / Audit Log, unified into one
-- table rather than three separate ones (a suggestion's own status
-- transition IS the provenance/audit record -- splitting these into
-- "suggestions" + "provenance" + "audit log" tables would be exactly the
-- kind of duplicated machinery the plan's own audit-first discipline
-- exists to avoid).
--
-- Every AI-derived signal this app has today (the deterministic category
-- classifier, Teach Nearby's deterministic attribute extractor -- neither
-- an LLM call) has only ever recorded "have you seen this suggestion" via
-- a local AsyncStorage dismiss key -- real for not re-nagging, but not a
-- durable, cross-device, queryable provenance record. This table is that
-- record.
--
-- confidence is nullable and stays null for every source this app can
-- honestly produce today -- both real detectors are deterministic
-- keyword match/no-match, never a scored probability, and this column
-- must never be fabricated to look more precise than the underlying
-- computation actually is.

create table if not exists public.business_attribute_suggestions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  attribute_key text not null,
  attribute_value text not null,
  source text not null,
  confidence numeric(3,2),
  reason text,
  status text not null default 'suggested',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint business_attribute_suggestions_key_check check (
    attribute_key in ('category', 'attribute', 'differentiator', 'cuisine')
  ),
  constraint business_attribute_suggestions_source_check check (
    source in ('business_confirmed', 'business_entered', 'ai_inferred', 'consumer_observed', 'system_observed')
  ),
  constraint business_attribute_suggestions_status_check check (
    status in ('suggested', 'confirmed', 'rejected')
  ),
  constraint business_attribute_suggestions_confidence_check check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

-- One open suggestion per (partner, key, value) -- a repeated dashboard
-- load re-running the same deterministic classifier must not spam
-- duplicate rows. Only guards *suggested* rows, so a genuinely new
-- suggestion after an old one was confirmed/rejected still lands fresh.
create unique index if not exists business_attribute_suggestions_open_idx
  on public.business_attribute_suggestions (partner_id, attribute_key, attribute_value)
  where status = 'suggested';

create index if not exists business_attribute_suggestions_partner_idx
  on public.business_attribute_suggestions (partner_id, created_at desc);

alter table public.business_attribute_suggestions enable row level security;

create policy "Business owners can view their own suggestion history"
  on public.business_attribute_suggestions for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.managed_partner_id = business_attribute_suggestions.partner_id
  ));

-- record_business_attribute_suggestion(): owner-only insert of a new
-- suggestion (or a silent no-op returning the already-open row's id, via
-- the partial unique index above). Never writes canonical business
-- data -- it only ever logs that a suggestion exists.
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
set search_path = public
as $$
declare
  v_id uuid;
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
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_business_attribute_suggestion(uuid, text, text, text, text, numeric) from public, anon;
grant execute on function public.record_business_attribute_suggestion(uuid, text, text, text, text, numeric) to authenticated;

-- respond_to_business_attribute_suggestion(): owner-only, double-review
-- guarded (only ever succeeds from 'suggested', matching this schema's
-- established anti-double-review convention). On approval, atomically
-- applies the canonical write for the two attribute_key shapes this app
-- actually knows how to apply today ('category': overwrite; 'attribute':
-- append-with-dedup into the existing attributes array, re-validated
-- against the real attribute vocabulary brand_partners' own CHECK
-- constraint already enforces) -- any other attribute_key (differentiator/
-- cuisine, logged for a future pass) just flips status, since there's no
-- real canonical write path for it yet -- never silently mis-applied.
create or replace function public.respond_to_business_attribute_suggestion(
  suggestion_id_param uuid,
  approved_param boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row business_attribute_suggestions%rowtype;
begin
  select * into v_row from business_attribute_suggestions where id = suggestion_id_param for update;

  if not found then
    raise exception 'Suggestion not found.';
  end if;

  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = v_row.partner_id
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if v_row.status <> 'suggested' then
    raise exception 'This suggestion has already been reviewed.';
  end if;

  update business_attribute_suggestions
  set status = case when approved_param then 'confirmed' else 'rejected' end,
      reviewed_at = now()
  where id = suggestion_id_param;

  if approved_param then
    if v_row.attribute_key = 'category' then
      update brand_partners set category = v_row.attribute_value where id = v_row.partner_id;
    elsif v_row.attribute_key = 'attribute' then
      if v_row.attribute_value not in (
        'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
        'kid_friendly', 'quiet', 'casual', 'upscale'
      ) then
        raise exception 'Invalid attribute value.';
      end if;
      update brand_partners
      set attributes = array(select distinct unnest(attributes || array[v_row.attribute_value]))
      where id = v_row.partner_id;
    end if;
  end if;
end;
$$;

revoke all on function public.respond_to_business_attribute_suggestion(uuid, boolean) from public, anon;
grant execute on function public.respond_to_business_attribute_suggestion(uuid, boolean) to authenticated;
