-- Emerging categories, hardened (owner decision 2026-09-21): deterministic wording-variant normalization, evidence
-- shown to the admin, and the resolve path enforces the threshold itself.
--   * _category_phrase_key: lowercase, punctuation out, '&' = 'and', per-token plural trim (len > 4, not 'ss'), and a
--     SHORT closed list of generic business nouns dropped ONLY when another word remains ("padel courts" = "padel";
--     "court" alone stays). Nothing semantic: "table tennis" stays "table tennis".
--   * cluster: a two-word key whose first word is itself a key someone typed joins that one-word key
--     ("padel tennis" joins "padel" only because "padel" was typed). Transparent, still no AI.
--   * distinct BUSINESSES = distinct applicant email (web) or requester (app); repeat submissions never add.
--   * an existing tag or remembered phrase (by any member wording) excludes the candidate.
--   * only the applicant's own "describe your business" text counts (unlisted_category_text); no searches, no AI.
create or replace function public._category_phrase_key(t text)
returns text language sql immutable set search_path = public as $$
  select coalesce((
    select string_agg(tok, ' ' order by ord) from (
      select case when char_length(w) > 4 and w !~ 'ss$' then regexp_replace(w, 's$', '') else w end as tok, ord
      from regexp_split_to_table(
        btrim(regexp_replace(regexp_replace(lower(replace(coalesce(t, ''), '&', ' and ')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')), ' '
      ) with ordinality as x(w, ord)
      where w <> ''
    ) s
    where tok not in ('court','club','studio','center','centre','place','venue','business','company','facility')
       or (select count(*) from regexp_split_to_table(btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9 ]+', ' ', 'g')), '\s+') q) = 1
  ), '')
$$;

-- One row per still-unmapped application that typed a description: its business identity, its own key, its cluster key.
create or replace function public._category_candidate_rows()
returns table (request_id uuid, business_id text, own_key text, cluster_key text, wording text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with base as (
    select r.id, coalesce(nullif(lower(btrim(r.applicant_email)), ''), r.requester_id::text) as biz,
           public._category_phrase_key(r.unlisted_category_text) as k, btrim(r.unlisted_category_text) as w, r.created_at
    from business_partner_requests r
    where r.category is null and r.unlisted_category_text is not null
  ), singles as (select distinct k from base where k <> '' and position(' ' in k) = 0)
  select b.id, b.biz, b.k,
         case when array_length(string_to_array(b.k, ' '), 1) = 2 and split_part(b.k, ' ', 1) in (select k from singles)
              then split_part(b.k, ' ', 1) else b.k end,
         b.w, b.created_at
  from base b where b.k <> ''
$$;
revoke all on function public._category_candidate_rows() from public, anon, authenticated;

drop function if exists public.admin_get_emerging_categories();
create or replace function public.admin_get_emerging_categories()
returns table (phrase_key text, sample_phrase text, applicants int, wordings text[], first_seen timestamptz, last_seen timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can see category suggestions';
  end if;
  return query
  select c.cluster_key,
         mode() within group (order by lower(c.wording)),
         count(distinct c.business_id)::int,
         (array_agg(distinct lower(c.wording)))[1:6],
         min(c.created_at), max(c.created_at)
  from public._category_candidate_rows() c
  where not exists (select 1 from category_tag_groups g where public._category_phrase_key(g.tag) in (c.own_key, c.cluster_key))
    and not exists (select 1 from category_aliases a where public._category_phrase_key(a.phrase) in (c.own_key, c.cluster_key))
    and not exists (select 1 from category_suggestion_dismissals d where d.phrase_key = c.cluster_key)
  group by c.cluster_key
  having count(distinct c.business_id) >= public.category_suggestion_min_applicants()
  order by 3 desc, 6 desc;
end $$;
revoke all on function public.admin_get_emerging_categories() from public, anon;
grant execute on function public.admin_get_emerging_categories() to authenticated;

create or replace function public.admin_resolve_emerging_category(phrase_key_param text, tag_param text, group_key_param text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_key text := btrim(lower(coalesce(phrase_key_param, '')));
  v_tag text := regexp_replace(btrim(coalesce(tag_param, '')), '\s+', ' ', 'g');
  v_existing record;
  v_count int;
  v_keys text[];
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

  select array_agg(distinct own_key) into v_keys from public._category_candidate_rows() where cluster_key = v_key;
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
  return v_count;
end $$;
revoke all on function public.admin_resolve_emerging_category(text, text, text) from public, anon;
grant execute on function public.admin_resolve_emerging_category(text, text, text) to authenticated;
