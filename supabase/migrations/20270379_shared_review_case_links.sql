-- Shared review cases: a read-only account-linking view for admins (owner, 2026-11-01). Staged after 20270378; deploy only
-- with its own approval. Nothing here collects, scores, clusters, restricts, notifies or changes anything.
--
-- When an admin opens a review case, each account in it shows the OTHER existing review cases that account is in (as a
-- member or as the case's subject), each with its named signal, reason, status and outcome, and the other accounts in
-- those cases. DIRECT connections only: the accounts listed under a linked case are never expanded into their own cases
-- here (no friends-of-friends network); the admin opens a linked case to look further, one case at a time.
-- The relationship is "shared review case", never "same person" or "likely related": a case is a reason to look, never proof.
-- Reads only what the review queue already holds (private.account_review_cases + _members); no new data is stored.
-- Admin-only (private.require_admin, as every other admin_* review function); clients and anon get nothing.

create or replace function public.admin_get_shared_review_cases(case_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform private.require_admin();
  if not exists (select 1 from private.account_review_cases where id = case_id_param) then
    raise exception 'Case not found' using errcode = 'P0002', hint = 'case_not_found';
  end if;
  return coalesce((
    with case_accounts as (            -- every (case, account) pair: members + the case's subject, once each
      select m.case_id, m.user_id from private.account_review_case_members m
      union
      select c.id, c.subject_user from private.account_review_cases c where c.subject_user is not null
    ),
    here as (select user_id from case_accounts where case_id = case_id_param)
    select jsonb_agg(jsonb_build_object(
             'user_id', h.user_id, 'display_name', p.display_name, 'suspended', p.suspended_at is not null,
             'total', (select count(*) from case_accounts x where x.user_id = h.user_id and x.case_id <> case_id_param),
             'cases', (select coalesce(jsonb_agg(l.obj order by l.open desc, l.updated_at desc), '[]'::jsonb) from (
                 select (c.status = 'open') as open, c.updated_at,
                        jsonb_build_object(
                          'id', c.id, 'signal', c.signal, 'reason', c.reason, 'status', c.status, 'outcome', c.outcome,
                          'opened_at', c.opened_at, 'closed_at', c.closed_at,
                          'overdue', c.status = 'open' and c.review_due_at < now(),
                          'new_evidence_since_closed', c.status = 'closed' and c.new_evidence_at is not null,
                          'other_accounts', (select coalesce(jsonb_agg(jsonb_build_object(
                                                 'user_id', o.user_id, 'display_name', op.display_name,
                                                 'suspended', op.suspended_at is not null,
                                                 'in_this_case', o.user_id in (select user_id from here))
                                                 order by op.display_name nulls last, o.user_id), '[]'::jsonb)
                                               from case_accounts o left join profiles op on op.id = o.user_id
                                              where o.case_id = c.id and o.user_id <> h.user_id)) as obj
                   from case_accounts x join private.account_review_cases c on c.id = x.case_id
                  where x.user_id = h.user_id and x.case_id <> case_id_param
                  order by (c.status = 'open') desc, c.updated_at desc
                  limit 50) l))
           order by p.display_name nulls last, h.user_id)
      from here h left join profiles p on p.id = h.user_id), '[]'::jsonb);
end;
$function$;
revoke all on function public.admin_get_shared_review_cases(uuid) from public, anon;
grant execute on function public.admin_get_shared_review_cases(uuid) to authenticated;
