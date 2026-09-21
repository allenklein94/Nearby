-- 20270185: friends-only interest summary. Rolled back. Needs 4 profiles.
begin;
do $$
declare me uuid; f1 uuid; f2 uuid; st uuid; r record; n int;
begin
  select id into me from profiles order by created_at limit 1;
  select id into f1 from profiles order by created_at offset 1 limit 1;
  select id into f2 from profiles order by created_at offset 2 limit 1;
  select id into st from profiles order by created_at offset 3 limit 1;
  update profiles set interests = array['Coffee','Hiking'] where id in (f1, f2, st);
  update profiles set display_name = 'Sam' where id = f1;
  update profiles set display_name = 'Alex' where id = f2;
  insert into friendships (user_a, user_b, status, requested_by) values (me, f1, 'accepted', me), (f2, me, 'accepted', f2);
  -- st is a stranger; a pending friendship must not count either
  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role','authenticated')::text, true);
  set local role authenticated;
  select * into r from get_friends_interested_in(array['Coffee','Yoga']);
  assert r.tag = 'Coffee' and r.friend_count = 2, 'two accepted friends, not the stranger: ' || coalesce(r.friend_count::text,'null');
  assert r.sample_names = array['Alex','Sam'], 'two names, ordered';
  select count(*) into n from get_friends_interested_in(array['Yoga']);
  assert n = 0, 'a tag no friend has returns nothing';
  reset role;
  -- a block in either direction removes that friend
  insert into blocks (blocker_id, blocked_id) values (f1, me);
  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role','authenticated')::text, true);
  set local role authenticated;
  select * into r from get_friends_interested_in(array['Coffee']);
  assert r.friend_count = 1 and r.sample_names = array['Alex'], 'blocked friend excluded';
  -- the stranger sees no one
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role','authenticated')::text, true);
  set local role authenticated;
  -- prod's 4 profiles may already be friends with each other, so compare with an independent count of THIS person's own
  -- accepted, unblocked friends who have Coffee; the function must return exactly that and never anything about me.
  select coalesce(sum(friend_count), 0) into n from get_friends_interested_in(array['Coffee']);
  reset role;
  assert n = (select count(*) from friendships fr join profiles p on p.id = case when fr.user_a = st then fr.user_b else fr.user_a end
              where fr.status = 'accepted' and st in (fr.user_a, fr.user_b) and 'Coffee' = any (p.interests)
                and not exists (select 1 from blocks b where (b.blocker_id = st and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = st))),
         'the stranger sees exactly their own friends';
  reset role;
  -- anonymous: no access
  set local role anon;
  begin perform get_friends_interested_in(array['Coffee']); assert false, 'anon must be refused';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'ALL OK';
end $$;
rollback;
