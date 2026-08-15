-- 10/10 roadmap Part 1: outcome tracking loop (see CLAUDE.md's "10/10
-- roadmap" plan). One row per intent-resolver result a user actually
-- tapped through to, independent of which of the 5 resolver branches it
-- came from. This sits one level above business_request_offers' own
-- request->offer->accept->complete lifecycle (untouched) -- it tracks the
-- INTENT's outcome, not just a business transaction's.
--
-- result_title is deliberately denormalized (captured client-side at the
-- moment of tap-through, when the real title is already in hand) rather
-- than joined from 5 different result tables at read time -- matches this
-- schema's own established preference for collapsing a lifecycle into one
-- row over a join-heavy normalized shape (e.g. business_request_offers).
create table if not exists public.intent_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text,
  category text,
  date_window text,
  result_type text not null,
  result_id uuid,
  result_title text,
  selected_at timestamptz not null default now(),
  outcome text,
  would_repeat boolean,
  answered_at timestamptz,
  constraint intent_outcomes_result_type_check check (result_type in (
    'gathering', 'community', 'friend_request', 'perk',
    'business_availability', 'business_offer', 'created_new'
  )),
  constraint intent_outcomes_outcome_check check (outcome is null or outcome in ('great', 'okay', 'not_for_me'))
);

alter table public.intent_outcomes enable row level security;

-- Owner-only, direct client read/write -- same shape as emergency_contacts/
-- date_checkins (a personal record, no cross-user visibility, no need for
-- a SECURITY DEFINER RPC since RLS alone fully covers "only ever my own
-- rows").
create policy "Users manage their own intent outcomes"
  on public.intent_outcomes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists intent_outcomes_user_id_idx on public.intent_outcomes(user_id);
-- Backs the "find my pending outcome prompts" query: my own rows, not yet
-- answered, selected long enough ago to plausibly have happened.
create index if not exists intent_outcomes_pending_idx on public.intent_outcomes(user_id, selected_at) where answered_at is null;

-- Tighter than this schema's usual table-grant posture (several existing
-- personal-record tables, e.g. emergency_contacts, leave anon's default
-- table-level grant in place and rely on RLS alone) -- revoked here anyway
-- as defense in depth, strictly stricter than default, zero behavior
-- change for a real authenticated caller.
revoke all on public.intent_outcomes from anon;
