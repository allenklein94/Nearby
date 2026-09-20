-- Sponsored placement, refunds + the approval audit (design sections 5 and 8; CLAUDE.md "Stripe approval AUTHORITY").
-- A refund is Stripe money movement done by a NAMED finance approver, never by an owner, a developer or Claude.
-- Fail closed: nobody can refund until the platform owner adds an approver (the list ships empty). Every request is
-- logged (who, what, when, which placement/payment, amount, reason, outcome). The database computes the amount from the
-- locked rules; the approver only picks the case. Serving already stops by itself when Stripe reports the refund
-- (sponsored_mark_refunded, via the signature-verified webhook), so nothing here flips a placement's state directly.

create table if not exists public.sponsored_finance_approvers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now()
);

create table if not exists public.sponsored_admin_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('refund')),
  payment_id uuid not null references public.sponsored_payments(id) on delete restrict,
  placement_id uuid not null references public.sponsored_placements(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  refund_kind text not null check (refund_kind in ('full_before_start', 'late_payment', 'nearby_failure')),
  undelivered_days integer check (undelivered_days is null or undelivered_days between 1 and 7),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'requested' check (status in ('requested', 'done', 'failed')),
  stripe_refund_id text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
-- one refund in flight per payment
create unique index if not exists sponsored_one_open_refund
  on public.sponsored_admin_actions (payment_id) where status = 'requested';

do $$ declare t text; begin
  foreach t in array array['sponsored_finance_approvers', 'sponsored_admin_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- An approver must be BOTH a platform admin AND explicitly on the approver list.
create or replace function public._sponsored_is_finance_approver(uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(check_is_admin(uid), false)
     and exists (select 1 from sponsored_finance_approvers where user_id = uid);
$$;

-- Step 1 (as the signed-in approver): validate the case, compute the amount, write the audit row.
--   full_before_start : the placement has not started (or the payment is flagged refund_due): refund what is left.
--   late_payment      : money arrived after the hold was released (refund_due): refund what is left.
--   nearby_failure    : Nearby could not deliver; undelivered_days x (amount / 7), rounded up in the business's favor.
create or replace function public.admin_sponsored_request_refund(
  payment_id_param uuid, kind_param text, undelivered_days_param integer default null, reason_param text default null
) returns table (action_id uuid, amount_cents integer, currency text, payment_intent_id text)
language plpgsql volatile security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  y record; p record; v_left integer; v_amt integer; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not _sponsored_is_finance_approver(auth.uid()) then raise exception 'sponsored_refund:not_an_approver'; end if;
  if reason_param is null or char_length(btrim(reason_param)) < 3 or char_length(reason_param) > 500 then
    raise exception 'sponsored_refund:reason_required';
  end if;
  select * into y from sponsored_payments where id = payment_id_param for update;
  if not found then raise exception 'sponsored_refund:unknown_payment'; end if;
  select * into p from sponsored_placements where id = y.placement_id;
  if y.status not in ('paid', 'partially_refunded') or y.stripe_payment_intent_id is null then
    raise exception 'sponsored_refund:not_refundable';
  end if;
  v_left := y.amount_cents - y.refunded_cents;
  if v_left <= 0 then raise exception 'sponsored_refund:nothing_left'; end if;

  -- a request that never finished (crashed caller) must not block forever
  update sponsored_admin_actions set status = 'failed', error = 'stale', completed_at = now()
   where payment_id = y.id and status = 'requested' and created_at < now() - interval '15 minutes';

  if kind_param = 'full_before_start' then
    if not (p.starts_at > now() or y.refund_due) then raise exception 'sponsored_refund:already_started'; end if;
    v_amt := v_left;
  elsif kind_param = 'late_payment' then
    if not y.refund_due then raise exception 'sponsored_refund:not_flagged'; end if;
    v_amt := v_left;
  elsif kind_param = 'nearby_failure' then
    if undelivered_days_param is null or undelivered_days_param < 1 or undelivered_days_param > 7 then
      raise exception 'sponsored_refund:bad_days';
    end if;
    v_amt := least(v_left, ceil(y.amount_cents::numeric * undelivered_days_param / 7)::integer);
  else
    raise exception 'sponsored_refund:bad_kind';
  end if;

  begin
    insert into sponsored_admin_actions (action, payment_id, placement_id, actor_id, refund_kind, undelivered_days, amount_cents, currency, reason)
    values ('refund', y.id, y.placement_id, auth.uid(), kind_param,
            case when kind_param = 'nearby_failure' then undelivered_days_param end, v_amt, y.currency, btrim(reason_param))
    returning id into v_id;
  exception when unique_violation then raise exception 'sponsored_refund:already_in_flight';
  end;
  return query select v_id, v_amt, y.currency, y.stripe_payment_intent_id;
end $$;

-- Step 2 (service role, called by the admin refund function after Stripe answers): close the audit row.
create or replace function public.sponsored_admin_record_refund(action_id_param uuid, stripe_refund_id_param text, ok_param boolean, error_param text default null)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  update sponsored_admin_actions
     set status = case when ok_param then 'done' else 'failed' end,
         stripe_refund_id = stripe_refund_id_param, error = left(error_param, 300), completed_at = now()
   where id = action_id_param and status = 'requested';
end $$;

revoke all on function public._sponsored_is_finance_approver(uuid) from public, anon, authenticated;
revoke all on function public.admin_sponsored_request_refund(uuid, text, integer, text) from public, anon;
revoke all on function public.sponsored_admin_record_refund(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_sponsored_request_refund(uuid, text, integer, text) to authenticated, service_role;
grant execute on function public.sponsored_admin_record_refund(uuid, text, boolean, text) to service_role;
