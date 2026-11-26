-- Rollback of 20270406 (run before rolling back anything older). Refuses, with what it found, while records exist or a case outlives its deleted subject: those are real
-- records of real deletions, and dropping them is the owner's decision, never this script's. Defect only; owner decides.
do $$
declare v jsonb;
begin
  v := jsonb_strip_nulls(jsonb_build_object(
    'records', nullif((select count(*) from private.unresolved_account_records), 0),
    'cases_without_subject', nullif((select count(*) from private.account_review_cases where former_subject_id is not null), 0),
    'returned_cases', nullif((select count(*) from private.account_review_cases where signal = 'prior_unresolved'), 0)));
  if v <> '{}'::jsonb then raise exception 'Rollback refused: rows depend on 20270406: %', v; end if;
end $$;

select cron.unschedule('purge-unresolved-account-records');
drop function if exists public.admin_get_deleted_account_record(uuid, uuid);
drop function if exists private.purge_unresolved_account_records();
drop trigger if exists zz_match_unresolved_account on private.device_sightings;
drop function if exists private._device_sighting_match_unresolved();
drop trigger if exists a_retain_unresolved_account on auth.users;
drop function if exists private._auth_user_deleted_retain_unresolved();
drop trigger if exists a_retain_unresolved_account on public.profiles;
drop function if exists private._profile_deleted_retain_unresolved();
-- verbatim from 20270374
create or replace function private.match_suspended_numbers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q record;
  r record;
  v_case uuid;
  v_closed boolean;
  v_opened integer := 0;
begin
  for q in select id, user_id, phone_key from private.phone_match_queue order by id for update skip locked loop
    for r in select id from private.suspended_account_records
              where phone_key = q.phone_key and expires_at > now() and former_account_id <> q.user_id
              order by released_at loop
      -- the unique index decides: a concurrent run that loses waits, then finds the winner's case below
      insert into private.account_review_cases (signal, reason, subject_user, evidence)
      values ('prior_suspension', 'suspended_number_reused', q.user_id, jsonb_build_object('record_id', r.id))
      on conflict do nothing
      returning id into v_case;
      if v_case is not null then
        insert into private.account_review_case_members (case_id, user_id) values (v_case, q.user_id) on conflict do nothing;
        v_opened := v_opened + 1;
        v_case := null;
        continue;
      end if;
      select c.id into v_case from private.account_review_cases c
       where c.signal = 'prior_suspension' and c.subject_user = q.user_id;
      if v_case is not null
         and not exists (select 1 from private.account_review_cases where id = v_case and evidence ->> 'record_id' = r.id::text) then
        -- lock the case, THEN look (a concurrent run's evidence for the same record is visible once it committed)
        perform 1 from private.account_review_cases where id = v_case for update;
        if not exists (select 1 from private.account_review_case_events e
                        where e.case_id = v_case and e.kind = 'new_evidence' and e.detail ->> 'record_id' = r.id::text) then
          -- its status as it is now (a close committed meanwhile counts), never an earlier read
          update private.account_review_cases
             set updated_at = now(), new_evidence_at = case when status = 'closed' then now() else new_evidence_at end
           where id = v_case
          returning status = 'closed' into v_closed;
          insert into private.account_review_case_events (case_id, kind, subject, detail)
          values (v_case, 'new_evidence', q.user_id, jsonb_build_object('record_id', r.id, 'while_closed', v_closed));
        end if;
      end if;
      v_case := null;
    end loop;
    delete from private.phone_match_queue where id = q.id;
  end loop;
  return v_opened;
end;
$function$;
revoke all on function private.match_suspended_numbers() from public, anon, authenticated;
drop function if exists private.match_unresolved_number(uuid, bytea);
drop function if exists private.open_returned_account_case(uuid, uuid, text);
drop function if exists private.retain_unresolved_account(uuid, text, boolean);
drop function if exists private.set_unresolved_account_retention(interval, text);

alter table private.account_review_case_events drop constraint account_review_case_events_kind_check,
  add constraint account_review_case_events_kind_check
  check (kind in ('opened', 'member_added', 'new_evidence', 'note', 'external_check', 'report_linked', 'closed', 'reopened'));
alter table private.account_review_cases drop constraint account_review_cases_subject_user_fkey,
  add constraint account_review_cases_subject_user_fkey foreign key (subject_user) references auth.users(id) on delete cascade;
drop index if exists private.account_review_cases_one_prior_unresolved;
drop index if exists private.account_review_cases_former_subject_idx;
alter table private.account_review_cases drop constraint account_review_cases_subject_check;
alter table private.account_review_cases drop column subject_deleted_at, drop column former_subject_id;
alter table private.account_review_cases add constraint account_review_cases_subject_check
  check ((signal = 'identical_photo') = (sha256 is not null)
         and (signal in ('behavior', 'report', 'prior_suspension', 'account_recovery')) = (subject_user is not null));
alter table private.account_review_cases drop constraint account_review_cases_reason_check;
alter table private.account_review_cases add constraint account_review_cases_reason_check
  check (reason in ('many_accounts', 'similar_names', 'behavior_pattern', 'reported_profile', 'suspended_number_reused', 'recovery_request', 'suspended_device'));
alter table private.account_review_cases drop constraint account_review_cases_signal_check;
alter table private.account_review_cases add constraint account_review_cases_signal_check
  check (signal in ('identical_photo', 'similar_photo', 'behavior', 'report', 'prior_suspension', 'account_recovery', 'shared_device', 'shared_text'));

delete from private.suspended_number_failures where step in ('retain_unresolved', 'match_unresolved');
alter table private.suspended_number_failures drop constraint suspended_number_failures_step_check;
alter table private.suspended_number_failures add constraint suspended_number_failures_step_check check (step in ('retain', 'queue'));

drop trigger if exists unresolved_event_guard on private.unresolved_account_events;
drop trigger if exists unresolved_record_guard on private.unresolved_account_records;
drop function if exists private._unresolved_event_guard();
drop function if exists private._unresolved_record_guard();
drop table private.unresolved_account_events;
drop table private.unresolved_account_device_keys;
drop table private.unresolved_account_records;
drop table private.unresolved_account_settings;
