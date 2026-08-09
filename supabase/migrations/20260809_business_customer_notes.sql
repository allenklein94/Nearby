-- Persistent per-customer CRM notes/tags for businesses (closes the CRM
-- gap flagged in the Business RPC ownership + CRM member drill-in section --
-- visit history via get_business_member_gathering_history already existed,
-- free-text notes/tags per customer didn't).
--
-- Same shape as business_invoices/partner_contracts: a real SELECT policy
-- scoped to the business owner via profiles.managed_partner_id (confirmed
-- both of those tables' policies live before writing this), no INSERT/
-- UPDATE/DELETE policy at all -- writes only go through the two SECURITY
-- DEFINER RPCs below, matching this schema's established "no direct client
-- INSERT/UPDATE on an owner-scoped table" convention.
create table if not exists public.business_customer_notes (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  customer_user_id uuid not null references public.profiles(id) on delete cascade,
  note text,
  tags text[] not null default '{}',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, customer_user_id)
);

alter table public.business_customer_notes enable row level security;

create policy "Business owners can view their own customer notes"
  on public.business_customer_notes
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.managed_partner_id = business_customer_notes.partner_id
    )
  );

create or replace function public.upsert_business_customer_note(
  partner_id_param uuid,
  customer_user_id_param uuid,
  note_param text,
  tags_param text[]
)
returns public.business_customer_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.business_customer_notes;
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  insert into business_customer_notes (partner_id, customer_user_id, note, tags, updated_by)
  values (partner_id_param, customer_user_id_param, note_param, coalesce(tags_param, '{}'), auth.uid())
  on conflict (partner_id, customer_user_id)
  do update set note = excluded.note, tags = excluded.tags, updated_by = excluded.updated_by, updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.delete_business_customer_note(
  partner_id_param uuid,
  customer_user_id_param uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  delete from business_customer_notes
  where partner_id = partner_id_param and customer_user_id = customer_user_id_param;
end;
$$;

revoke all on function public.upsert_business_customer_note(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.upsert_business_customer_note(uuid, uuid, text, text[]) to authenticated;

revoke all on function public.delete_business_customer_note(uuid, uuid) from public, anon;
grant execute on function public.delete_business_customer_note(uuid, uuid) to authenticated;
