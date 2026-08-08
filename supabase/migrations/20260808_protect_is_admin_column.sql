-- profiles.is_admin was NOT in prevent_self_premium_edit()'s guarded column
-- list, and "Users can update own profile" is a plain auth.uid() = id
-- UPDATE policy with no column-level restriction -- meaning any
-- authenticated user could grant themselves full admin access with a
-- single direct client update:
--   supabase.from('profiles').update({ is_admin: true }).eq('id', myId)
-- Verified live against production: as a real, genuinely non-admin
-- profile, this update succeeded and set is_admin = true. Reverted
-- immediately after confirming. There is no legitimate client-side path
-- anywhere in src/ that ever sets is_admin (grepped for it) -- it's meant
-- to be granted by hand via the service role only -- so guarding it here
-- has zero risk of breaking any real app flow.
create or replace function public.prevent_self_premium_edit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and coalesce(current_setting('app.trusted_update', true), '') <> 'true' then
    if new.is_premium is distinct from old.is_premium then
      new.is_premium := old.is_premium;
    end if;
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
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
  end if;
  return new;
end;
$function$;
