-- Closes a real, disclosed gap named in CLAUDE.md's Aug 15 2026 SECDEF audit (Phase 1 item 1):
-- match_contacts_to_users(phone_numbers) had no rate limit and no per-call size bound -- any
-- authenticated caller could call it directly, bypassing the app's own one-tap "find friends
-- from contacts" UI, with an arbitrarily large phone_numbers array, as many times as they liked.
-- Since a match returns a real display_name/photo_url, this was a genuine phone-number-
-- enumeration vector (learn whether a specific phone number belongs to a real Nearby account),
-- not just a cost/abuse concern. Fixed with the same two-part shape this schema already uses
-- for every other real scarcity/abuse guard: a hard per-call array-size cap, plus a real
-- SELECT ... FOR UPDATE daily counter on profiles (same pattern as ai_uses_today/browse_views_
-- today/gatherings_created_today/etc.) -- both new counter columns are added to
-- prevent_self_premium_edit()'s existing guarded-column list so a client can't just self-reset
-- them via a direct UPDATE, matching every other privileged profiles column in this schema.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contacts_matched_calls_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contacts_matched_date date;

CREATE OR REPLACE FUNCTION public.prevent_self_premium_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
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

-- Real caps: 3000 phone numbers per call (generous for a real device contact list -- the app's
-- own findFriendsFromContacts() sends the caller's whole deduped contact list in one call, but
-- normalizePhone() keeps this to real US-shaped 10/11-digit numbers only), 10 calls per real
-- calendar day (the legitimate flow is "once per import tap", not per-search -- this still
-- leaves headroom for retries after a transient failure without meaningfully weakening the
-- enumeration bound, which is the actual point of the limit).
CREATE OR REPLACE FUNCTION public.match_contacts_to_users(phone_numbers text[])
 RETURNS TABLE(id uuid, display_name text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_calls_today integer;
  v_call_date date;
begin
  if array_length(phone_numbers, 1) > 3000 then
    raise exception 'Too many contacts submitted at once.';
  end if;

  select p.contacts_matched_calls_today, p.contacts_matched_date
    into v_calls_today, v_call_date
    from profiles p
    where p.id = auth.uid()
    for update;

  if v_call_date is distinct from current_date then
    v_calls_today := 0;
  end if;

  if v_calls_today >= 10 then
    raise exception 'Too many contact-matching requests today -- try again tomorrow.';
  end if;

  perform set_config('app.trusted_update', 'true', true);
  update profiles p
    set contacts_matched_calls_today = v_calls_today + 1,
        contacts_matched_date = current_date
    where p.id = auth.uid();

  return query
    select p.id, p.display_name, p.photo_url
    from profiles p
    join auth.users u on u.id = p.id
    where u.phone = any(phone_numbers)
    and p.id != auth.uid();
end;
$function$;

REVOKE ALL ON FUNCTION public.match_contacts_to_users(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_contacts_to_users(text[]) TO authenticated;
