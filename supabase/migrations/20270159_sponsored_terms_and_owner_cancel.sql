-- Sponsored placement, owner decisions (2026-09-20): (1) terms acceptance is recorded against an IMMUTABLE terms
-- version; (2) a business can cancel its own paid placement in the app BEFORE the start date for a full refund.
-- Test mode only; nothing here turns live payments on. Terms text lives in src/constants/sponsoredTerms.js; its sha256
-- is recorded here so the accepted version is provable, and a Jest test fails if the text and this hash ever diverge.

create table if not exists public.sponsored_terms_versions (
  version text primary key,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
insert into public.sponsored_terms_versions (version, text_sha256, is_current)
values ('v1-draft-1', 'b9b1c9f4e404c3904b713f2966424811cd7c1006c1cceee9b97285623098c3f8', true)
on conflict (version) do nothing;
create unique index if not exists sponsored_one_current_terms on public.sponsored_terms_versions (is_current) where is_current;

create or replace function public._sponsored_terms_versions_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'A terms version cannot be deleted'; end if;
  if new.version <> old.version or new.text_sha256 <> old.text_sha256 then raise exception 'A terms version is immutable'; end if;
  return new;
end $$;
drop trigger if exists sponsored_terms_versions_immutable on public.sponsored_terms_versions;
create trigger sponsored_terms_versions_immutable before update or delete on public.sponsored_terms_versions
  for each row execute function public._sponsored_terms_versions_immutable();

create table if not exists public.sponsored_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  partner_id uuid references public.brand_partners(id) on delete set null,
  placement_id uuid not null references public.sponsored_placements(id) on delete restrict,
  payment_id uuid not null references public.sponsored_payments(id) on delete restrict,
  terms_version text not null references public.sponsored_terms_versions(version),
  accepted_at timestamptz not null default now(),
  stripe_checkout_session_id text
);
create unique index if not exists sponsored_terms_acceptance_payment on public.sponsored_terms_acceptances (payment_id);

-- An acceptance is a record, not a setting: never edited or removed. The only permitted change is filling in the
-- Checkout reference once, when the session is created.
create or replace function public._sponsored_terms_acceptance_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'A terms acceptance cannot be deleted'; end if;
  if (new.id, new.user_id, new.partner_id, new.placement_id, new.payment_id, new.terms_version, new.accepted_at)
     is distinct from (old.id, old.user_id, old.partner_id, old.placement_id, old.payment_id, old.terms_version, old.accepted_at)
     or (old.stripe_checkout_session_id is not null and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id) then
    raise exception 'A terms acceptance is immutable';
  end if;
  return new;
end $$;
drop trigger if exists sponsored_terms_acceptance_immutable on public.sponsored_terms_acceptances;
create trigger sponsored_terms_acceptance_immutable before update or delete on public.sponsored_terms_acceptances
  for each row execute function public._sponsored_terms_acceptance_immutable();

do $$ declare t text; begin
  foreach t in array array['sponsored_terms_versions', 'sponsored_terms_acceptances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Purchase now REQUIRES the current terms version; the acceptance row is written in the same transaction as the hold.
drop function if exists public.sponsored_begin_purchase(uuid, text, uuid, timestamptz, text, text, text);
create or replace function public.sponsored_begin_purchase(
  user_id_param uuid, item_kind_param text, item_id_param uuid, starts_param timestamptz,
  title_param text, description_param text, screening_tier_param text, terms_version_param text
) returns table (placement_id uuid, payment_id uuid, amount_cents integer, currency text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_partner uuid;
  v_problem text;
  v_item uuid;
  v_price record;
  v_place uuid;
  v_pay uuid;
begin
  select managed_partner_id into v_partner from profiles where id = user_id_param;
  if v_partner is null then raise exception 'sponsored:not_a_business_owner'; end if;
  if not exists (select 1 from sponsored_terms_versions where version = terms_version_param and is_current) then
    raise exception 'sponsored:terms_not_accepted';
  end if;
  if screening_tier_param is distinct from 'low' then raise exception 'sponsored:screening_not_clean'; end if;
  v_problem := _sponsored_purchase_problem(v_partner, starts_param);
  if v_problem is not null then raise exception 'sponsored:%', v_problem; end if;
  if item_kind_param = 'offer' then
    if not exists (select 1 from brand_offers o where o.id = item_id_param and o.partner_id = v_partner and o.active = true
                   and (o.expires_at is null or o.expires_at > now())) then
      raise exception 'sponsored:bad_item';
    end if;
    v_item := item_id_param;
  elsif item_kind_param = 'business' then
    v_item := v_partner;
  else
    raise exception 'sponsored:bad_item';
  end if;
  select sp.amount_cents, sp.currency into v_price from sponsored_price sp where sp.id;
  begin
    insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at,
                                      status, title, description, screening_tier, created_by)
    values (v_partner, item_kind_param, v_item, '', '', starts_param, starts_param + interval '7 days',
            'awaiting_payment', btrim(title_param), nullif(btrim(coalesce(description_param, '')), ''), 'low', user_id_param)
    returning id into v_place;
  exception
    when exclusion_violation then raise exception 'sponsored:slot_taken';
    when unique_violation then raise exception 'sponsored:already_holding';
  end;
  insert into sponsored_payments (placement_id, amount_cents, currency, status)
    values (v_place, v_price.amount_cents, v_price.currency, 'pending') returning id into v_pay;
  insert into sponsored_terms_acceptances (user_id, partner_id, placement_id, payment_id, terms_version)
    values (user_id_param, v_partner, v_place, v_pay, terms_version_param);
  return query select v_place, v_pay, v_price.amount_cents, v_price.currency;
end $$;

create or replace function public.sponsored_attach_checkout_session(payment_id_param uuid, session_id_param text)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  update sponsored_payments set stripe_checkout_session_id = session_id_param where id = payment_id_param and status = 'pending';
  update sponsored_terms_acceptances set stripe_checkout_session_id = session_id_param
   where payment_id = payment_id_param and stripe_checkout_session_id is null;
end $$;

-- Public read of the current version (so the client can send the version it showed).
create or replace function public.get_current_sponsored_terms_version()
returns text language sql stable security definer set search_path to 'public' as $$
  select version from sponsored_terms_versions where is_current;
$$;

-- ---- Owner cancels a PAID placement before it starts: full refund (locked policy) ----
alter table public.sponsored_admin_actions drop constraint if exists sponsored_admin_actions_refund_kind_check;
alter table public.sponsored_admin_actions add constraint sponsored_admin_actions_refund_kind_check
  check (refund_kind in ('full_before_start', 'late_payment', 'nearby_failure', 'owner_cancel_before_start'));

-- Step 1 (as the business owner). Validates, writes the audit row (the owner is the actor), and PAUSES the placement so
-- it can never be served while the refund is in flight (fail closed). Stripe's charge.refunded then ends it.
create or replace function public.owner_request_sponsored_cancel(placement_id_param uuid)
returns table (action_id uuid, amount_cents integer, currency text, payment_intent_id text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_partner uuid; p record; y record; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select managed_partner_id into v_partner from profiles where id = auth.uid();
  -- a crashed earlier attempt must not strand the placement: release stale in-flight owner cancels first
  update sponsored_placements sp set status = 'scheduled'
   from sponsored_admin_actions a
   where a.placement_id = sp.id and a.refund_kind = 'owner_cancel_before_start' and a.status = 'requested'
     and a.created_at < now() - interval '15 minutes' and sp.status = 'paused' and sp.starts_at > now();
  update sponsored_admin_actions set status = 'failed', error = 'stale', completed_at = now()
   where refund_kind = 'owner_cancel_before_start' and status = 'requested' and created_at < now() - interval '15 minutes';

  select * into p from sponsored_placements where id = placement_id_param for update;
  if not found or v_partner is null or p.partner_id <> v_partner then raise exception 'sponsored_cancel:not_yours'; end if;
  if p.status <> 'scheduled' or p.starts_at <= now() then raise exception 'sponsored_cancel:not_cancellable'; end if;
  select * into y from sponsored_payments where placement_id = p.id and status = 'paid' order by created_at desc limit 1 for update;
  if not found or y.stripe_payment_intent_id is null or y.refunded_cents > 0 then raise exception 'sponsored_cancel:not_cancellable'; end if;
  begin
    insert into sponsored_admin_actions (action, payment_id, placement_id, actor_id, refund_kind, amount_cents, currency, reason)
    values ('refund', y.id, p.id, auth.uid(), 'owner_cancel_before_start', y.amount_cents, y.currency,
            'Cancelled by the business before the start date')
    returning id into v_id;
  exception when unique_violation then raise exception 'sponsored_cancel:already_in_flight';
  end;
  update sponsored_placements set status = 'paused' where id = p.id;
  return query select v_id, y.amount_cents, y.currency, y.stripe_payment_intent_id;
end $$;

-- Step 2 record: same signature as before; on a FAILED owner cancel the placement goes back to scheduled.
create or replace function public.sponsored_admin_record_refund(action_id_param uuid, stripe_refund_id_param text, ok_param boolean, error_param text default null)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare a record;
begin
  update sponsored_admin_actions
     set status = case when ok_param then 'done' else 'failed' end,
         stripe_refund_id = stripe_refund_id_param, error = left(error_param, 300), completed_at = now()
   where id = action_id_param and status = 'requested' returning * into a;
  if a.id is not null and not ok_param and a.refund_kind = 'owner_cancel_before_start' then
    update sponsored_placements set status = 'scheduled' where id = a.placement_id and status = 'paused' and starts_at > now();
  end if;
end $$;

revoke all on function public.sponsored_begin_purchase(uuid, text, uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sponsored_begin_purchase(uuid, text, uuid, timestamptz, text, text, text, text) to service_role;
revoke all on function public.sponsored_attach_checkout_session(uuid, text) from public, anon, authenticated;
grant execute on function public.sponsored_attach_checkout_session(uuid, text) to service_role;
revoke all on function public.get_current_sponsored_terms_version() from public, anon;
grant execute on function public.get_current_sponsored_terms_version() to authenticated, service_role;
revoke all on function public.owner_request_sponsored_cancel(uuid) from public, anon;
grant execute on function public.owner_request_sponsored_cancel(uuid) to authenticated, service_role;
