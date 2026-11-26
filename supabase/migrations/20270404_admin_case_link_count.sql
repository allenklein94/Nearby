-- Link count in the admin review case (owner, 2026-11-08). STAGED after 20270403; own deploy approval.
-- One read-only function: how many different external links were DETECTED in the reported text already stored with THIS case.
-- What is read: reports.content_excerpt (the server's copy of what was reported) of the reports linked to this case, nothing else.
--   Not read: the reporter's own words (reports.details: a link they pasted isn't evidence about the reported account), messages,
--   conversations or any other content; reports not linked to this case; reports no longer kept. No new tracking or stored data.
-- Detector: private.ugc_links (20270396), the one link rule. It over-detects on purpose ("node.js" can match), so this is what was
--   detected, for the admin to read beside the text. The detector is unchanged.
-- Counted once: identical excerpts (two reports about one message) are one text; within a case a link counts once however often and
--   however written (scheme, "www.", trailing "/"; the detector already lowercases). The detector's extra reading of one link
--   ("mañana.com" also yields "ana.com"; "x.example/evil.example" also yields "evil.example") is dropped when, in the same text, it
--   is the tail of a longer link and not a real subdomain boundary ("sub.evil.example" + "evil.example" stay two).
-- External: every detected link except Nearby's own website host.
-- Returns three counts only, never a link or any text. No score, label, trust change or enforcement; nothing is written.
create or replace function public.admin_get_case_link_count(case_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_admin();
  if not exists (select 1 from private.account_review_cases c where c.id = case_id_param) then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  return (
    with texts as (
      select distinct r.content_excerpt as t
        from private.account_review_case_reports cr
        join public.reports r on r.id = cr.report_id
       where cr.case_id = case_id_param
         and nullif(btrim(r.content_excerpt), '') is not null
    ), found as (
      select x.t, regexp_replace(regexp_replace(regexp_replace(l.link, '^https?://', ''), '^www\.', ''), '/+$', '') as link
        from texts x cross join lateral unnest(private.ugc_links(x.t)) as l(link)
    ), links as (
      select distinct f.t, f.link
        from found f
       where f.link <> ''
         and split_part(split_part(f.link, '/', 1), ':', 1) <> 'allenklein94.github.io'
         and not exists (
           select 1 from found o
            where o.t = f.t and length(o.link) > length(f.link) and right(o.link, length(f.link)) = f.link
              and substr(o.link, length(o.link) - length(f.link), 1) !~ '[a-z0-9.-]')
    )
    select jsonb_build_object(
      'texts_checked', (select count(*) from texts),
      'texts_with_links', (select count(distinct l.t) from links l),
      'distinct_links', (select count(distinct l.link) from links l))
  );
end;
$function$;
revoke all on function public.admin_get_case_link_count(uuid) from public, anon;
grant execute on function public.admin_get_case_link_count(uuid) to authenticated;
