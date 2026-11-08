-- Account facts in the admin review case view (owner, 2026-11-08). STAGED after 20270400; own deploy approval.
-- One read-only function: for each account IN a review case, what an admin would otherwise look up by hand.
--   account_created_at  auth.users.created_at (the app shows it as an age)
--   phone_verified      private.has_verified_phone: yes/no, never the number
--   level               private.trust_level: 'new' or 'established' (the one existing rule, unchanged)
--   reports_*           reports naming this account, split by state, so volume is never read as findings:
--                       received = open + no_action + action_taken + no_outcome; the outcome is the admin's latest recorded one
--                       (report_actions); a reopened report is open again; a plain resolve from the old path = no_outcome.
-- Not counted: moderate-photo's automated rows (reporter = the account itself, reason auto_*: not a person's complaint);
-- reports about a business (reported_id is null by design, 20270381); resolved reports past the 12-month purge (they are gone).
-- Never returned: phone number, email, reporter identity, report text. No score, recommendation or verdict is computed; no
-- table, policy, trigger or existing function changes; nothing is written. Only accounts in that case; admins only.
create or replace function public.admin_get_account_facts(case_id_param uuid)
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
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', m.user_id,
             'display_name', p.display_name,
             'account_created_at', u.created_at,
             'phone_verified', private.has_verified_phone(m.user_id),
             'level', private.trust_level(m.user_id),
             'reports_received', coalesce(r.received, 0),
             'reports_open', coalesce(r.open, 0),
             'reports_no_action', coalesce(r.no_action, 0),
             'reports_action_taken', coalesce(r.action_taken, 0),
             'reports_no_outcome', coalesce(r.no_outcome, 0)
           ) order by m.added_at, m.user_id), '[]'::jsonb)
      from private.account_review_case_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      left join lateral (
        select count(*)::int as received,
               count(*) filter (where s.state = 'open')::int as open,
               count(*) filter (where s.state = 'resolved_no_action')::int as no_action,
               count(*) filter (where s.state = 'resolved_action_taken')::int as action_taken,
               count(*) filter (where s.state = 'resolved')::int as no_outcome
          from (
            select case when not coalesce(x.resolved, false) then 'open'
                        else coalesce((select a.action from public.report_actions a
                                        where a.report_id = x.id and a.action <> 'reopened'
                                        order by a.created_at desc, a.id desc limit 1), 'resolved')
                   end as state
              from public.reports x
             where x.reported_id = m.user_id
               and x.reason not like 'auto\_%'
          ) s
      ) r on true
     where m.case_id = case_id_param
  );
end;
$function$;
revoke all on function public.admin_get_account_facts(uuid) from public, anon;
grant execute on function public.admin_get_account_facts(uuid) to authenticated;
