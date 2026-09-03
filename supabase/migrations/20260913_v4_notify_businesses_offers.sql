-- Sep 3 2026 (CLAUDE.md, "global onboarding -> product wiring" master
-- plan, Phase C) -- closes the one real, currently-fully-ungated push
-- notification found by this pass's own audit: notify_business_update()
-- sent a real push to every one of a business's followers on every
-- broadcast update, with zero preference check of any kind -- confirmed
-- by pulling the live function body fresh before touching it (byte-
-- identical to the version in 00000000000000_baseline.sql, no drift).
-- Only the one new guard is added; every other line is unchanged.
--
-- This is deliberately the ONE new notification-preference column this
-- pass adds, not the user's full proposed 7-category taxonomy. The other
-- 6 categories (Things to Do / Friends / Dating / Plans / Events matching
-- interests / Nearby Opportunities) would require carefully re-tracing
-- and splitting notify_matches, which today is genuinely overloaded
-- across dating matches (notify_new_match), friend requests/accepts
-- (notify_friend_request*), AND gathering interest/approval
-- (notify_gathering_interest/notify_gathering_approved) -- three
-- different real concepts sharing one flag. Splitting that safely needs
-- its own dedicated pass (tracing every real call site of `matches`/
-- `source_gathering_id`/`source_friendship_id` first) -- locked as its
-- own scoped future phase in CLAUDE.md rather than guessed at here.
-- notify_gathering_cancelled() and notify_aggregated_demand_threshold()/
-- notify_group_intent_threshold() were also checked and found equally
-- ungated -- the first is left that way on purpose (a cancellation is a
-- critical status change, not something that should be silenceable); the
-- other two are business-owner-facing (a different persona/settings
-- surface, not part of this consumer-facing taxonomy) and are flagged,
-- not fixed, in the same future phase.
alter table public.profiles
  add column if not exists notify_businesses_offers boolean not null default true;

create or replace function public.notify_business_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  service_key text;
  partner_name text;
  follower record;
  follower_wants_notif boolean;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into partner_name from brand_partners where id = new.partner_id;

  for follower in
    select user_id from business_followers where brand_partner_id = new.partner_id
  loop
    select coalesce(notify_businesses_offers, true) into follower_wants_notif from profiles where id = follower.user_id;
    if not follower_wants_notif then
      continue;
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', follower.user_id,
        'title', coalesce(partner_name, 'Business') || ': ' || new.title,
        'body', coalesce(new.body, ''),
        'data', jsonb_build_object('type', 'business_update', 'partner_id', new.partner_id)
      )
    );
  end loop;

  return new;
end;
$function$;
