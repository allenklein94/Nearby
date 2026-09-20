-- Interested does something (owner item 37): (1) the 2-hour "starting soon" reminder also reaches people who marked
-- Interested; (2) an Interested person is told once when an accepted FRIEND becomes an approved attendee.
-- Same send-push path and `notify_planning` mute as every other gathering push. Interested people never notify the host.

-- 1) Reminder: approved attendees UNION Interested (upcoming is guaranteed by the loop; a block with the host skips them).
create or replace function public.send_gathering_reminders()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  g record;
  attendee record;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for g in
    select id, host_id, title, scheduled_at
    from gatherings
    where reminder_sent = false
      and scheduled_at > now()
      and scheduled_at <= now() + interval '2 hours'
  loop
    if coalesce((select notify_planning from profiles where id = g.host_id), true) then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', g.host_id,
          'title', 'Your gathering starts soon',
          'body', '"' || g.title || '" starts ' || case
              when g.scheduled_at - now() < interval '50 minutes'
                then 'in about ' || greatest(5, (round(extract(epoch from g.scheduled_at - now()) / 300) * 5)::int) || ' minutes'
              when g.scheduled_at - now() < interval '90 minutes' then 'in about an hour'
              else 'in about 2 hours'
            end || '.',
          'data', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id)
        )
      );
    end if;

    for attendee in
      select gi.user_id from gathering_interest gi where gi.gathering_id = g.id and gi.status = 'approved'
      union
      select gd.user_id from gathering_interested gd
       where gd.gathering_id = g.id
         and not exists (select 1 from blocks b
                          where (b.blocker_id = g.host_id and b.blocked_id = gd.user_id)
                             or (b.blocker_id = gd.user_id and b.blocked_id = g.host_id))
    loop
      if coalesce((select notify_planning from profiles where id = attendee.user_id), true) then
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', attendee.user_id,
            'title', 'Gathering starting soon',
            'body', '"' || g.title || '" starts ' || case
              when g.scheduled_at - now() < interval '50 minutes'
                then 'in about ' || greatest(5, (round(extract(epoch from g.scheduled_at - now()) / 300) * 5)::int) || ' minutes'
              when g.scheduled_at - now() < interval '90 minutes' then 'in about an hour'
              else 'in about 2 hours'
            end || '.',
            'data', jsonb_build_object('type', 'gathering_reminder', 'gathering_id', g.id)
          )
        );
      end if;
    end loop;

    update gatherings set reminder_sent = true where id = g.id;
  end loop;
end;
$function$;

-- 2) Friend joined. One push per Interested person per gathering, ever (PK dedupe).
create table if not exists public.gathering_interested_friend_pushes (
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (gathering_id, user_id)
);
alter table public.gathering_interested_friend_pushes enable row level security;
revoke all on public.gathering_interested_friend_pushes from public, anon, authenticated;

create or replace function public.notify_interested_friend_joined()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  g record;
  joiner_name text;
  r record;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return new;
  end if;

  select id, host_id, title, scheduled_at into g from gatherings where id = new.gathering_id;
  if g.id is null or g.scheduled_at <= now() or g.host_id = new.user_id then
    return new;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into joiner_name from profiles where id = new.user_id;

  for r in
    select gd.user_id from gathering_interested gd
     where gd.gathering_id = new.gathering_id
       and gd.user_id <> new.user_id
       -- accepted friends only (not matches, not strangers)
       and exists (select 1 from friendships f where f.status = 'accepted'
                    and ((f.user_a = gd.user_id and f.user_b = new.user_id) or (f.user_a = new.user_id and f.user_b = gd.user_id)))
       and not exists (select 1 from blocks b
                        where (b.blocker_id = gd.user_id and b.blocked_id = new.user_id)
                           or (b.blocker_id = new.user_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = g.host_id and b.blocked_id = gd.user_id)
                           or (b.blocker_id = gd.user_id and b.blocked_id = g.host_id))
  loop
    if not coalesce((select notify_planning from profiles where id = r.user_id), true) then
      continue;
    end if;
    insert into gathering_interested_friend_pushes (gathering_id, user_id) values (new.gathering_id, r.user_id)
      on conflict do nothing;
    if not found then
      continue;
    end if;
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', r.user_id,
        'title', 'A friend is going',
        'body', coalesce(joiner_name, 'A friend') || ' is going to "' || g.title || '". Want to join?',
        'data', jsonb_build_object('type', 'friend_joined_gathering', 'gathering_id', g.id)
      )
    );
  end loop;
  return new;
end;
$function$;
revoke all on function public.notify_interested_friend_joined() from public, anon, authenticated;

drop trigger if exists on_gathering_interest_friend_joined on public.gathering_interest;
create trigger on_gathering_interest_friend_joined
  after insert or update of status on public.gathering_interest
  for each row execute function public.notify_interested_friend_joined();
