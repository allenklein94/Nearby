-- Living taxonomy (owner item 30, 2026-09-21): when several DIFFERENT applicants describe their business in the same
-- words that no category covers ("padel", "axe throwing"), flag it for an admin as a potential new category.
-- Rule-based, no AI, nothing auto-applied: an admin adds the tag (admin_resolve_emerging_category), which also maps every
-- still-unmapped application that used those words and remembers the phrase. Counts DISTINCT applicants (web = email,
-- app = requester), so one person repeating themselves never flags anything.
create or replace function public.category_suggestion_min_applicants()
returns int language sql immutable set search_path = public as $$ select 3 $$;

create or replace function public._category_phrase_key(t text)
returns text language sql immutable set search_path = public as $$
  select case when char_length(k) > 4 and k !~ 'ss$' then regexp_replace(k, 's$', '') else k end
  from (select btrim(regexp_replace(regexp_replace(lower(replace(coalesce(t, ''), '&', ' and ')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')) as k) s
$$;

create table if not exists public.category_suggestion_dismissals (
  phrase_key text primary key,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz not null default now()
);
alter table public.category_suggestion_dismissals enable row level security;
revoke all on public.category_suggestion_dismissals from public, anon, authenticated;

create or replace function public.admin_get_emerging_categories()
returns table (phrase_key text, sample_phrase text, applicants int, first_seen timestamptz, last_seen timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can see category suggestions';
  end if;
  return query
  select k.key, mode() within group (order by btrim(r.unlisted_category_text)),
         count(distinct coalesce(nullif(lower(btrim(r.applicant_email)), ''), r.requester_id::text))::int,
         min(r.created_at), max(r.created_at)
  from business_partner_requests r
  cross join lateral (select public._category_phrase_key(r.unlisted_category_text) as key) k
  where r.category is null and r.unlisted_category_text is not null and k.key <> ''
    and not exists (select 1 from category_tag_groups g where public._category_phrase_key(g.tag) = k.key)
    and not exists (select 1 from category_aliases a where public._category_phrase_key(a.phrase) = k.key)
    and not exists (select 1 from category_suggestion_dismissals d where d.phrase_key = k.key)
  group by k.key
  having count(distinct coalesce(nullif(lower(btrim(r.applicant_email)), ''), r.requester_id::text)) >= public.category_suggestion_min_applicants()
  order by 3 desc, 5 desc;
end $$;
revoke all on function public.admin_get_emerging_categories() from public, anon;
grant execute on function public.admin_get_emerging_categories() to authenticated;

create or replace function public.admin_dismiss_emerging_category(phrase_key_param text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can dismiss category suggestions';
  end if;
  insert into category_suggestion_dismissals (phrase_key, dismissed_by)
  values (public._category_phrase_key(phrase_key_param), auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.admin_dismiss_emerging_category(text) from public, anon;
grant execute on function public.admin_dismiss_emerging_category(text) to authenticated;

-- Adds the tag under an existing major (or reuses it if it already exists in that same major), maps every unmapped
-- application that used those words (updating an already-approved live business too), remembers the phrase.
create or replace function public.admin_resolve_emerging_category(phrase_key_param text, tag_param text, group_key_param text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_key text := public._category_phrase_key(phrase_key_param);
  v_tag text := regexp_replace(btrim(coalesce(tag_param, '')), '\s+', ' ', 'g');
  v_existing record;
  v_count int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can resolve category suggestions';
  end if;
  if v_key = '' then raise exception 'Nothing to resolve'; end if;
  select tag, group_key into v_existing from category_tag_groups where lower(tag) = lower(v_tag);
  if v_existing.tag is not null then
    if v_existing.group_key <> group_key_param then
      raise exception 'That category already exists under a different group';
    end if;
    v_tag := v_existing.tag;
  else
    v_tag := public.admin_add_category_tag(v_tag, group_key_param);
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update brand_partners set category = group_key_param, subcategory = v_tag
  where id in (select resulting_partner_id from business_partner_requests
               where category is null and resulting_partner_id is not null
                 and public._category_phrase_key(unlisted_category_text) = v_key);
  with u as (
    update business_partner_requests set category = group_key_param, subcategory = v_tag
    where category is null and public._category_phrase_key(unlisted_category_text) = v_key
    returning 1
  ) select count(*) into v_count from u;

  insert into category_aliases (phrase, category, subcategory, created_by)
  values (left(v_key, 60), group_key_param, v_tag, auth.uid())
  on conflict (phrase) do update set category = excluded.category, subcategory = excluded.subcategory;
  return v_count;
end $$;
revoke all on function public.admin_resolve_emerging_category(text, text, text) from public, anon;
grant execute on function public.admin_resolve_emerging_category(text, text, text) to authenticated;
