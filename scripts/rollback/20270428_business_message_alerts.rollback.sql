-- Rollback of 20270428 (business message alerts): customer messages stop alerting the business again. Messages are
-- untouched; only the alert windows (timestamps per conversation, no content) are dropped. Queued pushes already in the
-- outbox are left as they are (they carry no message text).
drop trigger if exists zz_alert_business_message on public.business_messages;
drop function if exists private._alert_business_message();
drop function if exists private._business_message_recipients(uuid);
drop table if exists private.business_message_alert_windows;
delete from public.notification_type_groups where type = 'business_message_received';
