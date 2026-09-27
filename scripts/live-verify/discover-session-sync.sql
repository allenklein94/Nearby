-- Discover session sync (20270242): one session per account, latest wins, clear everywhere, server-side 180-day retention,
-- private to the account. Rolled back.
begin;
do $$
declare
  a uuid; b uuid; s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); r jsonb; v_sub uuid; v_exp timestamptz; n int;
  cls jsonb := '{"intent":"gathering","dateWindow":"tonight","partyType":"friends","narrowGroup":"activities_recreation"}';
  t0 timestamptz := now();
begin
  select id into a from profiles order by created_at limit 1;
  select id into b from profiles where id <> a order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- device A saves; the account holds it
  r := save_discover_session(jsonb_build_object('session_id', s1, 'typed_text', 'something fun tonight with friends', 'classify_result', cls,
        'refined', true, 'client_updated_at', t0));
  if not (r->>'accepted')::boolean then raise exception 'first save refused %', r; end if;
  r := get_discover_session();
  if r->>'typed_text' <> 'something fun tonight with friends' or r->'classify_result'->>'narrowGroup' <> 'activities_recreation' then raise exception 'get %', r; end if;
  if (r->>'raw_text_expires_at')::timestamptz not between now() + interval '179 days' and now() + interval '181 days' then raise exception 'expiry %', r; end if;
  v_exp := (r->>'raw_text_expires_at')::timestamptz;

  -- a refinement (same session, later) updates it; the retention clock does not move
  r := save_discover_session(jsonb_build_object('session_id', s1, 'typed_text', 'something fun tonight with friends',
        'classify_result', cls || '{"budgetMax":25}', 'refined', true, 'client_updated_at', t0 + interval '1 minute'));
  if not (r->>'accepted')::boolean or (r->'session'->>'raw_text_expires_at')::timestamptz <> v_exp then raise exception 'refine %', r; end if;

  -- a stale device is refused and handed the newer session
  r := save_discover_session(jsonb_build_object('session_id', s1, 'typed_text', 'old', 'classify_result', cls, 'client_updated_at', t0));
  if (r->>'accepted')::boolean or r->'session'->'classify_result'->>'budgetMax' <> '25' then raise exception 'stale accepted %', r; end if;
  -- a client clock far in the future cannot lock the session
  r := save_discover_session(jsonb_build_object('session_id', s1, 'typed_text', 'x', 'classify_result', cls, 'client_updated_at', now() + interval '10 days'));
  if (r->'session'->>'client_updated_at')::timestamptz > now() + interval '6 minutes' then raise exception 'future clock kept %', r; end if;

  -- another account never sees it
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if get_discover_session() is not null then raise exception 'B sees A'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- clearing ends it everywhere: a tombstone, and the same session can never be re-saved by a stale device
  r := clear_discover_session(s1, now());
  if r->>'cleared_at' is null or r ? 'typed_text' then raise exception 'clear %', r; end if;
  r := save_discover_session(jsonb_build_object('session_id', s1, 'typed_text', 'back', 'classify_result', cls, 'client_updated_at', now() + interval '1 minute'));
  if (r->>'accepted')::boolean then raise exception 'cleared session came back %', r; end if;
  -- a new search after the clear is a new session
  r := save_discover_session(jsonb_build_object('session_id', s2, 'typed_text', 'coffee', 'classify_result', '{"category":"Coffee"}'::jsonb, 'client_updated_at', now() + interval '2 minutes'));
  if not (r->>'accepted')::boolean then raise exception 'new session refused %', r; end if;

  -- retention from the linked ask: its own server expiry; once passed the session ends (tombstone), on read and by the purge
  insert into intent_submissions (user_id, raw_text, intent_kind) values (a, 'coffee', 'gathering') returning id into v_sub;
  r := save_discover_session(jsonb_build_object('session_id', s2, 'typed_text', 'coffee', 'classify_result', '{"category":"Coffee"}'::jsonb,
        'submission_id', v_sub, 'client_updated_at', now() + interval '3 minutes'));
  if (r->'session'->>'raw_text_expires_at')::timestamptz <> (select raw_text_expires_at from intent_submissions where id = v_sub) then raise exception 'expiry not from the ask %', r; end if;
  -- the expiry can never move through a write
  update discover_sessions set raw_text_expires_at = now() + interval '900 days' where user_id = a;
  if (select raw_text_expires_at from discover_sessions where user_id = a) <> (select raw_text_expires_at from intent_submissions where id = v_sub) then raise exception 'expiry moved'; end if;
  -- simulate time passing (triggers bypassed only to backdate): the read ends it
  set local session_replication_role = replica;
  update discover_sessions set raw_text_expires_at = now() - interval '1 second' where user_id = a;
  set local session_replication_role = origin;
  r := get_discover_session();
  if r ? 'typed_text' or r->>'cleared_at' is null then raise exception 'expired still live on read %', r; end if;
  -- any write to an expired row ends it
  set local session_replication_role = replica;
  update discover_sessions set cleared_at = null, typed_text = 'coffee', classify_result = '{}' where user_id = a;
  set local session_replication_role = origin;
  update discover_sessions set refined = true where user_id = a;
  if (select cleared_at from discover_sessions where user_id = a) is null then raise exception 'expired write not cleared'; end if;
  -- and the hourly purge ends it
  set local session_replication_role = replica;
  update discover_sessions set cleared_at = null, typed_text = 'coffee', classify_result = '{}' where user_id = a;
  set local session_replication_role = origin;
  r := purge_expired_raw_ask_text();
  if (r->>'discover_sessions')::int < 1 or (select typed_text from discover_sessions where user_id = a) is not null then raise exception 'purge missed %', r; end if;

  -- no client reads the table; anon cannot call the functions
  set local role authenticated;
  begin perform 1 from discover_sessions; raise exception 'table readable'; exception when insufficient_privilege then null; end;
  reset role;
  if has_function_privilege('anon', 'public.get_discover_session()', 'execute') or has_function_privilege('anon', 'public.save_discover_session(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.clear_discover_session(uuid,timestamptz)', 'execute') then raise exception 'anon can execute'; end if;
end $$;
select 'ALL OK' as result;
rollback;
