-- "Can't find your category?" + dynamic category mapping (20270145).
-- The hierarchy already exists (19 majors -> leaf tags, brand_partners.category/subcategory/categories/attributes,
-- category_tag_groups). This adds the expansion loop WITHOUT new categories or constraints:
--   1. an applicant who cannot find a fit describes the business (business_partner_requests.unlisted_category_text);
--      category stays NULL (already allowed), signup is never rejected;
--   2. an admin maps it to an existing major (+ optional leaf tag) while the application is pending (approval already
--      copies category/subcategory) or after it (the live business is updated too), optionally remembering the phrase;
--   3. remembered phrases live in category_aliases and feed suggest_category_from_aliases(), so the next business that
--      describes itself the same way gets the suggestion automatically. Rule-based, no AI; nothing is auto-applied.
alter table public.business_partner_requests
  add column if not exists unlisted_category_text text;
alter table public.business_partner_requests
  drop constraint if exists business_partner_requests_unlisted_category_text_check;
alter table public.business_partner_requests
  add constraint business_partner_requests_unlisted_category_text_check
  check (unlisted_category_text is null or char_length(unlisted_category_text) between 3 and 200);

create table if not exists public.category_aliases (
  phrase text primary key check (phrase = lower(btrim(phrase)) and char_length(phrase) between 2 and 60),
  category text not null,
  subcategory text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.category_aliases enable row level security;
revoke all on public.category_aliases from public, anon, authenticated;

-- Longest remembered phrase contained in the text wins. Returns nothing when no phrase matches.
create or replace function public.suggest_category_from_aliases(text_param text)
returns table (category text, subcategory text, phrase text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.category, a.subcategory, a.phrase
  from public.category_aliases a
  where text_param is not null
    and position(a.phrase in lower(text_param)) > 0
  order by char_length(a.phrase) desc, a.phrase
  limit 1;
$$;
revoke all on function public.suggest_category_from_aliases(text) from public, anon;
grant execute on function public.suggest_category_from_aliases(text) to authenticated, service_role;

create or replace function public.admin_map_business_category(
  request_id_param uuid,
  category_param text,
  subcategory_param text default null,
  alias_phrase_param text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  req record;
  alias_phrase text := nullif(lower(btrim(coalesce(alias_phrase_param, ''))), '');
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can map business categories';
  end if;
  if not exists (select 1 from category_tag_groups where group_key = category_param)
     and category_param not in ('home_local_services', 'auto_transportation', 'health_personal_care') then
    raise exception 'Unknown category';
  end if;
  if subcategory_param is not null
     and not exists (select 1 from category_tag_groups where tag = subcategory_param and group_key = category_param) then
    raise exception 'That subcategory does not belong to this category';
  end if;
  if alias_phrase is not null and char_length(alias_phrase) not between 2 and 60 then
    raise exception 'A remembered phrase must be 2 to 60 characters';
  end if;

  select * into req from business_partner_requests where id = request_id_param;
  if req is null then
    raise exception 'Request not found';
  end if;

  update business_partner_requests
  set category = category_param, subcategory = subcategory_param
  where id = request_id_param;

  if req.resulting_partner_id is not null then
    perform set_config('app.trusted_update', 'true', true);
    update brand_partners
    set category = category_param, subcategory = subcategory_param
    where id = req.resulting_partner_id;
  end if;

  if alias_phrase is not null then
    insert into category_aliases (phrase, category, subcategory, created_by)
    values (alias_phrase, category_param, subcategory_param, auth.uid())
    on conflict (phrase) do update
      set category = excluded.category, subcategory = excluded.subcategory, created_by = excluded.created_by;
  end if;
end;
$$;
revoke all on function public.admin_map_business_category(uuid, text, text, text) from public, anon;
grant execute on function public.admin_map_business_category(uuid, text, text, text) to authenticated;
