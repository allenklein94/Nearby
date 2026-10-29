-- The trusted-write flag counts only inside a server function (owner security review, 2026-10-29; staged after 20270359,
-- deploy only with its own approval).
--
-- `app.trusted_update` is an ordinary setting: any session can set it with set_config(). Through the real API no client can
-- (pg_catalog is not exposed, no client-callable function runs dynamic SQL or set_config on client input, anon /
-- authenticated cannot log in), but the 12 column guards below trusted the flag whoever set it: a session running as
-- authenticated that sets it can give itself is_admin / is_premium (proven in a rolled-back transaction). This makes the
-- flag useless to the client roles, so the guards no longer depend on "no path to set_config" staying true.
--
-- Change (each body otherwise byte-identical to its definition after 20270359; owner, search_path and grants kept):
-- 1. Every guard runs as the caller (SECURITY INVOKER; none of them reads a table, they only compare NEW with OLD and
--    call auth.uid()). In a trigger `current_user` is then the role running the statement: `anon` / `authenticated`
--    for a direct client write, the function's owner for a write made inside a SECURITY DEFINER server function.
-- 2. The protection applies when the flag is not 'true' OR the statement runs as anon / authenticated. A trusted server
--    function (definer, owner postgres) keeps writing exactly as before; a client write is protected with or without the flag.
-- Not changed (same class, lower impact, recorded): a forged flag also skips the friend-request daily limit and the 0356
-- rate limits (their checks run inside definer functions, where current_user is always the owner); reachable only with raw
-- SQL as a client role, which the API does not allow.
-- Every later migration that (re)defines a guard reading the flag must keep both: `trustedWriteScopeGuard.test.js` checks
-- later files, the DO block below checks the catalog.

-- _guard_extra_photo_screening() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public._guard_extra_photo_screening()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if tg_op = 'INSERT' then
      new.photo_verified := false;
      new.screened_object_id := null;
      if new.photo_url is null or split_part(new.photo_url, '/', 1) <> new.user_id::text then
        raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
      end if;
    else
      new.user_id := old.user_id;
      if new.photo_url is distinct from old.photo_url then
        if new.photo_url is null or split_part(new.photo_url, '/', 1) <> old.user_id::text then
          raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
        end if;
        new.photo_verified := false;
        new.screened_object_id := null;
      else
        if coalesce(new.photo_verified, false) and not coalesce(old.photo_verified, false) then
          new.photo_verified := old.photo_verified;
        end if;
        new.screened_object_id := old.screened_object_id;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- _guard_identity_verified() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public._guard_identity_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if tg_op = 'INSERT' then
      new.id_verified := false;
      new.id_verified_at := null;
    else
      new.id_verified := old.id_verified;
      new.id_verified_at := old.id_verified_at;
    end if;
  end if;
  return new;
end;
$function$;

-- _guard_profile_photo_screening() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public._guard_profile_photo_screening()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.photo_url is distinct from old.photo_url then
      if new.photo_url is not null and split_part(new.photo_url, '/', 1) <> old.id::text then
        raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
      end if;
      new.photo_verified := false;
      new.photo_object_id := null;
    else
      if coalesce(new.photo_verified, false) and not coalesce(old.photo_verified, false) then
        new.photo_verified := old.photo_verified;
      end if;
      new.photo_object_id := old.photo_object_id;
    end if;
  end if;
  return new;
end;
$function$;

-- _guard_profile_privileged_insert() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public._guard_profile_privileged_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    new.is_admin := false;
    new.is_premium := false;
    new.photo_verified := false;
    new.photo_object_id := null;
    new.managed_partner_id := null;
    new.referred_by := null;
    new.bonus_notices := 0;
    new.ai_uses_today := 0;
    new.ai_uses_date := current_date;
    new.browse_views_today := 0;
    new.browse_views_date := current_date;
    new.gatherings_created_today := 0;
    new.gatherings_created_date := null;
    new.communities_created_today := 0;
    new.communities_created_date := null;
    new.friend_requests_sent_today := 0;
    new.friend_requests_sent_date := null;
    new.stories_posted_today := 0;
    new.stories_posted_date := null;
    new.contacts_matched_calls_today := 0;
    new.contacts_matched_date := null;
    if new.photo_url is not null and split_part(new.photo_url, '/', 1) <> new.id::text then
      raise exception 'Photo not found' using errcode = '42501', hint = 'photo_not_own';
    end if;
  end if;
  return new;
end;
$function$;

-- _guard_suspension() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public._guard_suspension()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if tg_op = 'INSERT' then
      new.suspended_at := null;
    else
      new.suspended_at := old.suspended_at;
      if old.suspended_at is not null then
        new.profile_hidden := old.profile_hidden;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_community_status_self_edit() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.prevent_community_status_self_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.status is distinct from old.status then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_friendship_participant_edit()
CREATE OR REPLACE FUNCTION public.prevent_friendship_participant_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.user_a is distinct from old.user_a then
      new.user_a := old.user_a;
    end if;
    if new.user_b is distinct from old.user_b then
      new.user_b := old.user_b;
    end if;
    if new.requested_by is distinct from old.requested_by then
      new.requested_by := old.requested_by;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_gathering_interest_identity_edit()
CREATE OR REPLACE FUNCTION public.prevent_gathering_interest_identity_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.gathering_id is distinct from old.gathering_id then
      new.gathering_id := old.gathering_id;
    end if;
    if new.user_id is distinct from old.user_id then
      new.user_id := old.user_id;
    end if;
    if new.match_id is distinct from old.match_id then
      new.match_id := old.match_id;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_gathering_question_identity_edit()
CREATE OR REPLACE FUNCTION public.prevent_gathering_question_identity_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.gathering_id is distinct from old.gathering_id then
      new.gathering_id := old.gathering_id;
    end if;
    if new.asker_id is distinct from old.asker_id then
      new.asker_id := old.asker_id;
    end if;
    if new.question_body is distinct from old.question_body then
      new.question_body := old.question_body;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_hosting_partner_self_edit() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.prevent_hosting_partner_self_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.hosting_partner_id is distinct from old.hosting_partner_id then
      new.hosting_partner_id := old.hosting_partner_id;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_match_participant_edit()
CREATE OR REPLACE FUNCTION public.prevent_match_participant_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.user_a is distinct from old.user_a then
      new.user_a := old.user_a;
    end if;
    if new.user_b is distinct from old.user_b then
      new.user_b := old.user_b;
    end if;
  end if;
  return new;
end;
$function$;

-- prevent_self_premium_edit() (was SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.prevent_self_premium_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and (coalesce(current_setting('app.trusted_update', true), '') <> 'true' or current_user in ('anon', 'authenticated')) then
    if new.is_premium is distinct from old.is_premium then
      new.is_premium := old.is_premium;
    end if;
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
    end if;
    if new.bonus_notices is distinct from old.bonus_notices then
      new.bonus_notices := old.bonus_notices;
    end if;
    if new.referred_by is distinct from old.referred_by then
      new.referred_by := old.referred_by;
    end if;
    if new.ai_uses_today is distinct from old.ai_uses_today then
      new.ai_uses_today := old.ai_uses_today;
    end if;
    if new.ai_uses_date is distinct from old.ai_uses_date then
      new.ai_uses_date := old.ai_uses_date;
    end if;
    if new.browse_views_today is distinct from old.browse_views_today then
      new.browse_views_today := old.browse_views_today;
    end if;
    if new.browse_views_date is distinct from old.browse_views_date then
      new.browse_views_date := old.browse_views_date;
    end if;
    if new.managed_partner_id is distinct from old.managed_partner_id then
      new.managed_partner_id := old.managed_partner_id;
    end if;
    if new.gatherings_created_today is distinct from old.gatherings_created_today then
      new.gatherings_created_today := old.gatherings_created_today;
    end if;
    if new.gatherings_created_date is distinct from old.gatherings_created_date then
      new.gatherings_created_date := old.gatherings_created_date;
    end if;
    if new.communities_created_today is distinct from old.communities_created_today then
      new.communities_created_today := old.communities_created_today;
    end if;
    if new.communities_created_date is distinct from old.communities_created_date then
      new.communities_created_date := old.communities_created_date;
    end if;
    if new.friend_requests_sent_today is distinct from old.friend_requests_sent_today then
      new.friend_requests_sent_today := old.friend_requests_sent_today;
    end if;
    if new.friend_requests_sent_date is distinct from old.friend_requests_sent_date then
      new.friend_requests_sent_date := old.friend_requests_sent_date;
    end if;
    if new.stories_posted_today is distinct from old.stories_posted_today then
      new.stories_posted_today := old.stories_posted_today;
    end if;
    if new.stories_posted_date is distinct from old.stories_posted_date then
      new.stories_posted_date := old.stories_posted_date;
    end if;
    if new.contacts_matched_calls_today is distinct from old.contacts_matched_calls_today then
      new.contacts_matched_calls_today := old.contacts_matched_calls_today;
    end if;
    if new.contacts_matched_date is distinct from old.contacts_matched_date then
      new.contacts_matched_date := old.contacts_matched_date;
    end if;
  end if;
  return new;
end;
$function$;

-- No guard may trust the flag on its own any more.
do $check$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ~ 'current_setting\(''app\.trusted_update'', true\), ''''\) <> ''true'''
     and (p.prosecdef or p.prosrc !~ 'current_user in \(''anon'', ''authenticated''\)');
  if v_bad is not null then
    raise exception 'guards that trust a forgeable flag: %', v_bad;
  end if;
end
$check$;
