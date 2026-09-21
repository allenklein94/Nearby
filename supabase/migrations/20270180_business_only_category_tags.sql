-- Business-only category tags (owner sign-off, 2026-09-21). A tag flagged business_only can be used by a BUSINESS to
-- describe itself (brand_partners.subcategory/categories, availability, priority) but never by a consumer surface: not a
-- request category, a gathering/community tag, or a profile interest. It is also left out of the AI intent extractor's
-- vocabulary (edge function create-assistant) and out of every client interest picker, so no consumer signal is ever
-- generated from it and Nearby never infers or routes on a medical need. First use: the clinical Health & Personal Care
-- tags. Clinical services are still not a recommendation category; this only lets such a business classify itself.
alter table public.category_tag_groups add column if not exists business_only boolean not null default false;

insert into public.category_tag_groups (tag, group_key, business_only) values
  ('Dental', 'health_personal_care', true),
  ('Vision', 'health_personal_care', true),
  ('Physical Therapy', 'health_personal_care', true),
  ('Chiropractic', 'health_personal_care', true),
  ('Medical Services', 'health_personal_care', true),
  ('Pharmacies', 'health_personal_care', true)
on conflict (tag) do nothing;

create or replace function public._reject_business_only_consumer_tag()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(NEW);
  v_hit boolean;
begin
  if TG_TABLE_NAME = 'profiles' then
    select exists (
      select 1 from public.category_tag_groups g
      where g.business_only and g.tag = any (coalesce(NEW.interests, array[]::text[]))
    ) into v_hit;
  else
    select exists (
      select 1 from public.category_tag_groups g
      where g.business_only
        and g.tag = coalesce(v_row->>'category', v_row->>'interest_tag')
    ) into v_hit;
  end if;
  if v_hit then
    raise exception 'That category is only for businesses.';
  end if;
  return NEW;
end;
$$;
revoke all on function public._reject_business_only_consumer_tag() from public, anon, authenticated;

drop trigger if exists reject_business_only_tag on public.business_requests;
create trigger reject_business_only_tag before insert or update of category on public.business_requests
  for each row execute function public._reject_business_only_consumer_tag();
drop trigger if exists reject_business_only_tag on public.gatherings;
create trigger reject_business_only_tag before insert or update of interest_tag on public.gatherings
  for each row execute function public._reject_business_only_consumer_tag();
drop trigger if exists reject_business_only_tag on public.communities;
create trigger reject_business_only_tag before insert or update of interest_tag on public.communities
  for each row execute function public._reject_business_only_consumer_tag();
drop trigger if exists reject_business_only_tag on public.profiles;
create trigger reject_business_only_tag before insert or update of interests on public.profiles
  for each row execute function public._reject_business_only_consumer_tag();
