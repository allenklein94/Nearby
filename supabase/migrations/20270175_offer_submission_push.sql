-- Item 83 follow-up: tell the owner when a background-screened offer reaches a final answer, so nobody has to sit on
-- the dashboard. One push type, business_offer_review_result (owner "offers" mute group, important tier), fired only on
-- a real transition: reviewing -> sent / needs changes / not sent, or a held offer decided by the Nearby team.
-- Body never carries offer content, only the outcome.

create or replace function public._push_offer_submission_result(user_id_param uuid, outcome_param text, submission_id_param uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  v_title text;
  v_body text;
begin
  v_title := case outcome_param
    when 'published' then 'Your offer was sent'
    when 'needs_changes' then 'Your offer needs changes'
    else 'Your offer couldn''t be sent' end;
  v_body := case outcome_param
    when 'published' then 'It cleared review and the customer can see it now.'
    when 'needs_changes' then 'Open Nearby to see what to change and resend.'
    else 'Open Nearby to see why.' end;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is null then return; end if;
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', user_id_param, 'title', v_title, 'body', v_body,
      'data', jsonb_build_object('type', 'business_offer_review_result', 'submission_id', submission_id_param, 'outcome', outcome_param)
    )
  );
exception when others then
  null; -- a failed push must never fail the write that caused it
end;
$$;
revoke all on function public._push_offer_submission_result(uuid, text, uuid) from public, anon, authenticated;

-- reviewing -> a final answer from the background screening
create or replace function public.notify_offer_submission_settled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'reviewing' and new.status in ('published', 'needs_changes', 'not_sent') then
    perform public._push_offer_submission_result(new.submitted_by, new.status, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_offer_submission_settled() from public, anon, authenticated;
drop trigger if exists trg_notify_offer_submission_settled on business_offer_submissions;
create trigger trg_notify_offer_submission_settled after update of status on business_offer_submissions
  for each row execute function public.notify_offer_submission_settled();

-- a held offer decided by the team
create or replace function public.notify_offer_review_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_sub business_offer_submissions;
begin
  if new.review_outcome in ('approved', 'denied') and old.review_outcome is distinct from new.review_outcome then
    select * into v_sub from business_offer_submissions where screening_id = new.id and status = 'in_review' limit 1;
    if found then
      perform public._push_offer_submission_result(v_sub.submitted_by, case when new.review_outcome = 'approved' then 'published' else 'needs_changes' end, v_sub.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_offer_review_decided() from public, anon, authenticated;
drop trigger if exists trg_notify_offer_review_decided on business_content_screening_results;
create trigger trg_notify_offer_review_decided after update of review_outcome on business_content_screening_results
  for each row execute function public.notify_offer_review_decided();
