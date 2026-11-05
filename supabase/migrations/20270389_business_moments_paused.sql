-- Business Moments paused for the first launch (owner, 2026-11-05: TEMPORARY, never a removal). Staged after 20270388; deploy
-- only with its own approval, and live + verified BEFORE any outside business is onboarded.
--
-- Why: a Business Moment is a direct client insert into `stories` that no screening step ever sees, and every signed-in user
-- can read it. 20270388 refuses moment VIDEOS; this refuses moment PHOTOS too until media screening exists for them.
--
-- What: ONE switch `private.business_moments_settings.enabled` (false; no client access). While false the database refuses
-- any story that is or becomes a Business Moment (partner_id set), whoever writes, with
-- P0001 'Business Moments aren''t available yet.' HINT 'business_moments_paused'. The trigger is named to fire after
-- 20270388's, so a moment video keeps that migration's refusal. A person's own story (partner_id null) is unchanged.
-- Any moment already live is ended now: its expires_at was client-settable, so it would not necessarily expire by itself
-- (production holds 0 moments, read-only check 2026-11-05).
-- Kept, untouched: the partner_id column, the entitlement and its trigger, the read policy, the viewer, the Discover row, the
-- dashboard's post button (a later build hides it; not required for enforcement).
-- Re-enabling = a separate, owner-approved migration setting enabled = true, only after media screening for moments is built
-- and tested (PRODUCT_AUDIT/OFFER_SCREENING_ACTIVATION_CHECKLIST_2026-11-02.md section 8).

create table if not exists private.business_moments_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.business_moments_settings (id, enabled) values (true, false) on conflict (id) do nothing;
revoke all on private.business_moments_settings from public, anon, authenticated;

create or replace function private._refuse_paused_business_moment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.partner_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.partner_id is not distinct from old.partner_id then
    return new;
  end if;
  if coalesce((select enabled from private.business_moments_settings where id), false) then
    return new;
  end if;
  raise exception 'Business Moments aren''t available yet.' using hint = 'business_moments_paused';
end;
$function$;
revoke all on function private._refuse_paused_business_moment() from public, anon, authenticated;

drop trigger if exists ab_business_moments_paused on public.stories;
create trigger ab_business_moments_paused
  before insert or update of partner_id on public.stories
  for each row execute function private._refuse_paused_business_moment();

update public.stories set expires_at = now() where partner_id is not null and expires_at > now();
