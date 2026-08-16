-- Full System Acceptance Audit, Wave 2B (see PRODUCT_AUDIT/ACCEPTANCE_AUDIT_PROGRESS.md):
-- record_friend_discovery_swipe's mutual-match check had no row lock at
-- all -- a plain `select ... into v_reverse_like_exists` under default
-- READ COMMITTED isolation. If two people swipe "like" on each other in
-- the same narrow window (both transactions' own insert not yet
-- committed when the *other* transaction's reverse-check runs), both
-- checks correctly see "no reverse like yet" and both return
-- is_mutual_match: false -- a genuinely mutual like silently produces no
-- friendship/match, with no retry path (the candidate never resurfaces,
-- since get_friend_discovery_candidates already excludes anyone with any
-- existing swipe row).
--
-- Fixed the same way every other race in this schema is fixed --
-- SELECT ... FOR UPDATE on real rows, not a new advisory-lock primitive
-- this codebase has never used elsewhere. Locking both participants'
-- own profiles rows, in a fixed (least-id-first) order so two concurrent
-- opposite-direction calls can't deadlock each other, serializes any two
-- swipes between the same pair -- the second call's reverse-like check
-- now always runs after the first call's insert has either committed or
-- rolled back, so it's never possible for both sides to see "no reverse
-- like yet" when a real mutual like exists.
CREATE OR REPLACE FUNCTION public.record_friend_discovery_swipe(target_user_id uuid, direction_param text)
 RETURNS TABLE(is_mutual_match boolean, match_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  v_friendship_id uuid;
  v_match_id uuid;
  v_reverse_like_exists boolean;
  v_i_opted_in boolean;
  v_they_opted_in boolean;
  v_already_connected boolean;
  v_my_name text;
  v_service_key text;
  v_lock_ids uuid[];
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_me = target_user_id then
    raise exception 'You cannot swipe on yourself';
  end if;
  if direction_param not in ('like', 'pass') then
    raise exception 'Invalid direction';
  end if;

  -- Serialize any concurrent swipe between this exact pair (either
  -- direction) before reading or writing anything else -- closes the
  -- lost-mutual-match race described above.
  perform id from profiles where id in (least(v_me, target_user_id), greatest(v_me, target_user_id)) order by id for update;

  select open_to_friend_discovery into v_i_opted_in from profiles where id = v_me;
  select open_to_friend_discovery into v_they_opted_in from profiles where id = target_user_id;
  if not coalesce(v_i_opted_in, false) or not coalesce(v_they_opted_in, false) then
    return query select false, null::uuid;
    return;
  end if;

  if is_blocked(v_me, target_user_id) then
    return query select false, null::uuid;
    return;
  end if;

  -- Defensive re-check of the same exclusion rule the candidate RPC
  -- already applies -- a stale client shouldn't be trusted, and this
  -- covers friends/pending/declined (any friendships row) plus an
  -- existing dating match in one check each.
  select exists (
    select 1 from friendships f
    where (f.user_a = v_me and f.user_b = target_user_id) or (f.user_a = target_user_id and f.user_b = v_me)
  ) or exists (
    select 1 from matches m
    where (m.user_a = v_me and m.user_b = target_user_id) or (m.user_a = target_user_id and m.user_b = v_me)
  ) into v_already_connected;

  if v_already_connected then
    return query select false, null::uuid;
    return;
  end if;

  insert into friend_discovery_swipes (from_user, to_user, direction)
  values (v_me, target_user_id, direction_param)
  on conflict (from_user, to_user) do nothing;

  if direction_param = 'pass' then
    return query select false, null::uuid;
    return;
  end if;

  select exists (
    select 1 from friend_discovery_swipes
    where from_user = target_user_id and to_user = v_me and direction = 'like'
  ) into v_reverse_like_exists;

  if not v_reverse_like_exists then
    return query select false, null::uuid;
    return;
  end if;

  v_user_a := least(v_me, target_user_id);
  v_user_b := greatest(v_me, target_user_id);

  perform set_config('app.trusted_update', 'true', true);

  insert into friendships (user_a, user_b, status, requested_by)
  values (v_user_a, v_user_b, 'accepted', v_me)
  on conflict (user_a, user_b) do update set status = 'accepted'
  where friendships.status <> 'accepted'
  returning id into v_friendship_id;

  if v_friendship_id is null then
    select id into v_friendship_id from friendships where user_a = v_user_a and user_b = v_user_b;
  end if;

  insert into matches (user_a, user_b, source_friendship_id)
  values (v_user_a, v_user_b, v_friendship_id)
  on conflict (user_a, user_b) do update
    set source_friendship_id = coalesce(matches.source_friendship_id, excluded.source_friendship_id)
  returning id into v_match_id;

  perform set_config('app.trusted_update', 'false', true);

  select display_name into v_my_name from profiles where id = v_me;
  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
    body := jsonb_build_object(
      'recipient_id', target_user_id,
      'title', 'New friend!',
      'body', 'You and ' || coalesce(v_my_name, 'someone') || ' are now friends on Nearby. 🎉',
      'data', jsonb_build_object('type', 'friend_discovery_match', 'match_id', v_match_id)
    )
  );

  return query select true, v_match_id;
end;
$function$;

revoke all on function public.record_friend_discovery_swipe(uuid, text) from public, anon;
grant execute on function public.record_friend_discovery_swipe(uuid, text) to authenticated;
