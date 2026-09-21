-- One taxonomy, taught once (owner 2026-09-21): a synonym is data, not code. The client hydrates category_synonyms the same
-- way it hydrates category_tag_groups, an admin can add a synonym without a release, and resolving an emerging category
-- ("Padel") also registers the wordings businesses used as synonyms of the new tag, so search, signup and matching all
-- understand it from that one admin action. The key form is identical to the client's (lowercase, & = and, punctuation out,
-- per-word plural trim) but, unlike _category_phrase_key, it never drops generic nouns.
create or replace function public._category_search_key(t text)
returns text language sql immutable set search_path = public as $$
  select coalesce((
    select string_agg(case when char_length(w) > 4 and w !~ 'ss$' then regexp_replace(w, 's$', '') else w end, ' ' order by ord)
    from regexp_split_to_table(
      btrim(regexp_replace(regexp_replace(lower(replace(coalesce(t, ''), '&', ' and ')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')), ' '
    ) with ordinality as x(w, ord) where w <> ''
  ), '')
$$;

create or replace function public.get_category_synonyms()
returns table (phrase text, tag text)
language sql stable security definer set search_path = public as $$
  select s.phrase, s.tag from category_synonyms s
$$;
revoke all on function public.get_category_synonyms() from public, anon;
grant execute on function public.get_category_synonyms() to authenticated;

create or replace function public.admin_add_category_synonym(phrase_param text, tag_param text)
returns text language plpgsql security definer set search_path = public as $$
declare v_phrase text := public._category_search_key(phrase_param);
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only an admin can add a synonym';
  end if;
  if char_length(v_phrase) not between 2 and 60 then
    raise exception 'A synonym is 2 to 60 characters';
  end if;
  if not exists (select 1 from category_tag_groups where tag = tag_param) then
    raise exception 'Unknown category';
  end if;
  insert into category_synonyms (phrase, tag) values (v_phrase, tag_param) on conflict do nothing;
  return v_phrase;
end $$;
revoke all on function public.admin_add_category_synonym(text, text) from public, anon;
grant execute on function public.admin_add_category_synonym(text, text) to authenticated;

create or replace function public.admin_resolve_emerging_category(phrase_key_param text, tag_param text, group_key_param text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_key text := btrim(lower(coalesce(phrase_key_param, '')));
  v_tag text := regexp_replace(btrim(coalesce(tag_param, '')), '\s+', ' ', 'g');
  v_existing record;
  v_count int;
  v_keys text[];
  v_words text[];
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can resolve category suggestions';
  end if;
  -- The threshold is enforced here too: only a currently flagged candidate can be resolved.
  if not exists (select 1 from public.admin_get_emerging_categories() e where e.phrase_key = v_key) then
    raise exception 'This suggestion has not reached the threshold, or was already handled';
  end if;
  select tag, group_key into v_existing from category_tag_groups where lower(tag) = lower(v_tag);
  if v_existing.tag is not null then
    if v_existing.group_key <> group_key_param then
      raise exception 'That category already exists under a different group';
    end if;
    v_tag := v_existing.tag;
  else
    v_tag := public.admin_add_category_tag(v_tag, group_key_param);
  end if;

  select array_agg(distinct own_key), array_agg(distinct wording) into v_keys, v_words from public._category_candidate_rows() where cluster_key = v_key;
  perform set_config('app.trusted_update', 'true', true);
  update brand_partners set category = group_key_param, subcategory = v_tag
  where id in (select r.resulting_partner_id from business_partner_requests r
               join public._category_candidate_rows() c on c.request_id = r.id
               where c.cluster_key = v_key and r.resulting_partner_id is not null);
  with u as (
    update business_partner_requests r set category = group_key_param, subcategory = v_tag
    from public._category_candidate_rows() c
    where c.request_id = r.id and c.cluster_key = v_key
    returning 1
  ) select count(*) into v_count from u;

  -- Remember every wording key that was in the cluster, so future text gets the suggestion.
  insert into category_aliases (phrase, category, subcategory, created_by)
  select distinct left(k, 60), group_key_param, v_tag, auth.uid()
  from unnest(array_append(v_keys, v_key)) as k
  where k <> ''
  on conflict (phrase) do update set category = excluded.category, subcategory = excluded.subcategory;
  -- Add once, understood everywhere: the wordings the businesses used become search synonyms of the new tag too.
  insert into category_synonyms (phrase, tag)
  select distinct public._category_search_key(w), v_tag from unnest(v_words) w
  where char_length(public._category_search_key(w)) between 2 and 60
    and public._category_search_key(w) <> public._category_search_key(v_tag)
  on conflict do nothing;
  return v_count;
end $$;
revoke all on function public.admin_resolve_emerging_category(text, text, text) from public, anon;
grant execute on function public.admin_resolve_emerging_category(text, text, text) to authenticated;
