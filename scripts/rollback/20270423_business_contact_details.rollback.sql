-- Rollback of 20270423 (business contact details). The table holds what owners typed; dropping it loses that (the
-- application copies stay on business_partner_requests). Refuses while any row exists unless this transaction says the
-- owner approved losing them: set_config('nearby.contact_details_rollback_approved', 'yes', true).
do $$
begin
  if exists (select 1 from private.business_contact_details)
     and coalesce(current_setting('nearby.contact_details_rollback_approved', true), '') <> 'yes' then
    raise exception 'business contact details exist: export them and get the owner''s approval before rolling back 20270423'
      using hint = 'contact_details_present';
  end if;
end $$;

drop trigger if exists bpr_carry_contact_details_on_approval on public.business_partner_requests;
drop function if exists public._carry_contact_details_on_approval();
drop function if exists public.set_business_contact_details(uuid, text, text);
drop function if exists public.get_business_contact_details(uuid);
drop function if exists private.normalize_business_website(text);
drop function if exists private.normalize_business_phone(text);
drop table if exists private.business_contact_details;
