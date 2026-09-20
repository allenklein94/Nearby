-- "Keep me updated" for Interested people: the existing gathering edit/cancel pushes now also reach people who marked
-- Interested (gathering_interested, 20270115), not only approved attendees. Same push path, same `notify_planning`
-- mute, same payloads as attendees get (title only; the cancel payload carries no gathering id), so an Interested
-- person learns nothing they were not already entitled to. Extra guards for Interested only: the gathering must still
-- be upcoming (nobody needs updates on something that already happened) and no block may exist with the host.
-- Meaningful edit = time, title or place (area). Description/photo/capacity/etc. tweaks stay silent, as before.

create or replace function public.notify_gathering_updated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  recipient record;
  time_changed boolean;
begin
  time_changed := old.scheduled_at is distinct from new.scheduled_at;

  if not time_changed and old.title = new.title and old.area is not distinct from new.area then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for recipient in
    select gi.user_id from gathering_interest gi
     where gi.gathering_id = new.id and gi.status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = new.id
       and new.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = new.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = new.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', recipient.user_id,
          'title', 'Gathering Updated',
          'body', case
            when time_changed then '"' || new.title || '" changed to a new time — tap to see details.'
            else '"' || new.title || '" was updated — tap to see details.'
          end,
          'data', jsonb_build_object('type', 'gathering_updated', 'gathering_id', new.id)
        )
      );
    end if;
  end loop;

  return new;
end;
$function$;

create or replace function public.notify_gathering_cancelled()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  recipient record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for recipient in
    select user_id from gathering_interest where gathering_id = old.id and status = 'approved'
    union
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = old.id
       and old.scheduled_at >= now()
       and not exists (select 1 from blocks b
                        where (b.blocker_id = old.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = old.host_id))
  loop
    if coalesce((select notify_planning from profiles where id = recipient.user_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', recipient.user_id,
          'title', 'A gathering was cancelled',
          'body', '"' || old.title || '" has been cancelled by the host.',
          'data', jsonb_build_object('type', 'gathering_cancelled')
        )
      );
    end if;
  end loop;
  return old;
end;
$function$;
