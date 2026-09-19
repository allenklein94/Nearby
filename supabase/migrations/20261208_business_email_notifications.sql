-- Email fallback for business owners (Business Web parity). Every business alert is sent through the send-push Edge
-- Function as a phone push; an owner who only uses the website has no push token and got nothing. This adds the per-owner
-- email settings that function reads when there is no token to push to.
--
-- The address is verified with a 6-digit code (stored hashed, 30-minute expiry, 5 attempts) so nobody can point another
-- person's inbox at an owner account. Only the business-email Edge Function writes this table (service role); the client
-- reads its own row through get_my_business_email_settings and flips the on/off switch through
-- set_my_business_email_enabled. Inert until the email provider secrets (RESEND_API_KEY, EMAIL_FROM) are set.

create table if not exists public.business_email_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  verified_at timestamptz,
  code_hash text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  code_sent_at timestamptz,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.business_email_settings enable row level security;
revoke all on public.business_email_settings from public, anon, authenticated;

create or replace function public.get_my_business_email_settings()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when s.user_id is null then null else jsonb_build_object(
    'email', s.email, 'verified', s.verified_at is not null, 'enabled', s.enabled) end
  from (select 1) x
  left join business_email_settings s on s.user_id = auth.uid()
  where exists (select 1 from profiles where id = auth.uid() and managed_partner_id is not null);
$$;

create or replace function public.set_my_business_email_enabled(enabled_param boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id is not null) then
    raise exception 'Only a business owner can change this.';
  end if;
  update business_email_settings set enabled = enabled_param, updated_at = now() where user_id = auth.uid();
end;
$$;

revoke all on function public.get_my_business_email_settings(), public.set_my_business_email_enabled(boolean) from public, anon;
grant execute on function public.get_my_business_email_settings(), public.set_my_business_email_enabled(boolean) to authenticated, service_role;
