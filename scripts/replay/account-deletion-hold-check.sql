-- Local replay only, never production. Deletes a legally held account (delete-account's order: profile, auth user) in a rolled-back
-- transaction and prints which moderation records survive. Findings: PRODUCT_AUDIT/ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md
\set ON_ERROR_STOP 1
begin;
set local session_replication_role = replica;  -- fixtures only; real triggers are ON for the deletion below
insert into auth.users (id, email, phone, phone_confirmed_at) values
 ('10000000-0000-0000-0000-00000000000a','t@x.invalid','15615550191',now()),
 ('10000000-0000-0000-0000-00000000000b','admin@x.invalid',null,null),
 ('10000000-0000-0000-0000-00000000000c','rep@x.invalid',null,null),
 ('10000000-0000-0000-0000-00000000000d','other@x.invalid',null,null);
insert into profiles (id, display_name, birthdate, suspended_at) values
 ('10000000-0000-0000-0000-00000000000a','Target','1990-01-01',now()),
 ('10000000-0000-0000-0000-00000000000b','Admin','1990-01-01',null),
 ('10000000-0000-0000-0000-00000000000c','Reporter','1990-01-01',null),
 ('10000000-0000-0000-0000-00000000000d','Other','1990-01-01',null);
insert into reports (id, reporter_id, reported_id, reason, details, content_excerpt) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','10000000-0000-0000-0000-00000000000a','harassment','details kept','server copy kept');
insert into report_actions (report_id, admin_id, action, note) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','resolved','note kept');
insert into account_moderation_actions (user_id, action, reason, report_id, admin_id) values
 ('10000000-0000-0000-0000-00000000000a','suspend','Suspended after review of report','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b');
insert into private.account_review_cases (id, signal, reason, subject_user) values
 ('30000000-0000-0000-0000-000000000001','report','reported_profile','10000000-0000-0000-0000-00000000000a');
insert into private.account_review_cases (id, signal, reason, sha256) values
 ('30000000-0000-0000-0000-000000000002','identical_photo','many_accounts','abc');
insert into private.account_review_case_members (case_id, user_id) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000d');
insert into private.account_review_case_events (case_id, kind, subject) values
 ('30000000-0000-0000-0000-000000000001','opened','10000000-0000-0000-0000-00000000000a'),
 ('30000000-0000-0000-0000-000000000002','opened','10000000-0000-0000-0000-00000000000a');
insert into private.account_restrictions (id, user_id, capability, reason, report_id, review_case_id, admin_id, expires_at) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','messages','Pause from the held report',  '20000000-0000-0000-0000-000000000001',null,'10000000-0000-0000-0000-00000000000b',now()+interval '7 days'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000a','links','Pause from the held review case',null,'30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b',now()+interval '7 days');
insert into private.account_restriction_events (restriction_id, user_id, action, admin_id, reason) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000a','restrict','10000000-0000-0000-0000-00000000000b','Pause from the held report');
insert into private.legal_holds (target_type, target_id, reason, placed_by) values
 ('report','20000000-0000-0000-0000-000000000001','Preservation request received','10000000-0000-0000-0000-00000000000b'),
 ('review_case','30000000-0000-0000-0000-000000000001','Preservation request received','10000000-0000-0000-0000-00000000000b'),
 ('review_case','30000000-0000-0000-0000-000000000002','Preservation request received','10000000-0000-0000-0000-00000000000b');
set local session_replication_role = origin;
create temp view v as
 select 'report row + server copy' what, count(*)::text n from reports where id='20000000-0000-0000-0000-000000000001' and content_excerpt is not null
 union all select 'report_actions', count(*)::text from report_actions where report_id='20000000-0000-0000-0000-000000000001'
 union all select 'suspension decisions (account_moderation_actions)', count(*)::text from account_moderation_actions where report_id='20000000-0000-0000-0000-000000000001'
 union all select 'suspended_account_records copy', count(*)::text from private.suspended_account_records where former_account_id='10000000-0000-0000-0000-00000000000a'
 union all select 'pauses from held report/case', count(*)::text from private.account_restrictions where id in ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002')
 union all select 'pause history events', count(*)::text from private.account_restriction_events where restriction_id='40000000-0000-0000-0000-000000000001'
 union all select 'held case WITH subject_user', count(*)::text from private.account_review_cases where id='30000000-0000-0000-0000-000000000001'
 union all select 'held case WITHOUT subject_user', count(*)::text from private.account_review_cases where id='30000000-0000-0000-0000-000000000002'
 union all select 'its history events (no subject case)', count(*)::text from private.account_review_case_events where case_id='30000000-0000-0000-0000-000000000002'
 union all select 'its member row for the deleted account', count(*)::text from private.account_review_case_members where case_id='30000000-0000-0000-0000-000000000002' and user_id='10000000-0000-0000-0000-00000000000a'
 union all select 'legal_holds rows', count(*)::text from private.legal_holds;
\echo == BEFORE
select * from v;
delete from public.profiles where id='10000000-0000-0000-0000-00000000000a';
delete from auth.users where id='10000000-0000-0000-0000-00000000000a';
\echo == AFTER deletion
select * from v;
\echo == report reference, legal hold pointing at missing case
select reported_id is null as reported_cleared, reported_deleted_at is not null as stamped, details from reports where id='20000000-0000-0000-0000-000000000001';
select h.target_type, exists(select 1 from private.account_review_cases c where c.id=h.target_id) case_exists from private.legal_holds h where target_type='review_case';
select jsonb_pretty(decisions) from private.suspended_account_records where former_account_id='10000000-0000-0000-0000-00000000000a';
rollback;
