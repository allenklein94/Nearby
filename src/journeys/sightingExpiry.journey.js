// Journey (owner, 2026-10-23, migration 20270339): a "crossed paths" record lasts 48 hours after two people were last near
// each other, then it is neither shown nor stored. Rolled back. Under the real `authenticated` role with a JWT:
//   read: A sees the active crossing with C, never the expired one with B (Dating + Friends Crossed Paths and Activity all read
//     sightings through this one policy); a blocked pair stays hidden; a stranger sees neither;
//   purge (purge_expired_sightings, every 10 min by cron): deletes the expired record, keeps the active one and the person's
//     other data; app roles cannot run it;
//   crossing again: within 48 h updates the same record (no new push); after expiry + purge it is a new record and a new
//     "You crossed paths!" push (the owner-known effect of deleting records).
// Not covered: the live report-presence edge function itself (its upsert is reproduced here), a device.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const visibleTo = (who) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(jsonb_agg(case when user_a = ${who} then user_b else user_a end), '[]') into v_seen from (select user_a, user_b from sightings) x;
  reset role;`;
const cross = (a, b) => `insert into sightings (user_a, user_b, last_seen_at, expires_at)
    values (least(${a}, ${b}), greatest(${a}, ${b}), now(), now() + interval '48 hours')
    on conflict (user_a, user_b) do update set last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at`;
const pushes = (who) => `(select count(*) from push_outbox where recipient_id = ${who} and data->>'type' = 'crossed_paths_sighting')`;

d('journey: a crossed-paths record is gone 48 hours after the last crossing', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_c', 'v_x', 'v_blk'])}
      v_seen jsonb; v_msg text; v_n int; v_id uuid;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c', 'v_x', 'v_blk'] })}
  perform set_config('app.push_handoff_test_failure', 'on', true);
  log := log || jsonb_build_array(jsonb_build_object('step','ids','ok', true, 'data', jsonb_build_object('b', v_b, 'c', v_c, 'blk', v_blk)));

  -- A crossed B 49 h ago (expired an hour ago), C an hour ago (active), and a blocked person an hour ago
  insert into sightings (user_a, user_b, last_seen_at, expires_at)
    values (least(v_a, v_b), greatest(v_a, v_b), now() - interval '49 hours', now() - interval '1 hour'),
           (least(v_a, v_c), greatest(v_a, v_c), now() - interval '1 hour', now() + interval '47 hours'),
           (least(v_a, v_blk), greatest(v_a, v_blk), now() - interval '1 hour', now() + interval '47 hours');
  insert into blocks (blocker_id, blocked_id) values (v_blk, v_a);

  ${visibleTo('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step','a_sees_only_active','ok', v_seen = jsonb_build_array(v_c), 'data', v_seen));
  ${visibleTo('v_b')}
  log := log || jsonb_build_array(jsonb_build_object('step','b_no_longer_sees_a','ok', v_seen = '[]'::jsonb, 'data', v_seen));
  ${visibleTo('v_x')}
  log := log || jsonb_build_array(jsonb_build_object('step','stranger_sees_none','ok', v_seen = '[]'::jsonb, 'data', v_seen));

  -- the purge
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform purge_expired_sightings(); v_msg := 'RAN'; exception when others then v_msg := sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','app_cannot_purge','ok', v_msg <> 'RAN', 'data', v_msg));
  perform purge_expired_sightings();
  log := log || jsonb_build_array(jsonb_build_object('step','expired_deleted','ok',
     not exists (select 1 from sightings where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b))));
  log := log || jsonb_build_array(jsonb_build_object('step','active_kept','ok',
     exists (select 1 from sightings where user_a = least(v_a, v_c) and user_b = greatest(v_a, v_c))
     and exists (select 1 from sightings where user_a = least(v_a, v_blk) and user_b = greatest(v_a, v_blk))
     and exists (select 1 from profiles where id = v_b)));
  log := log || jsonb_build_array(jsonb_build_object('step','scheduled','ok',
     exists (select 1 from cron.job where jobname = 'purge-expired-sightings' and command ~ 'purge_expired_sightings')));

  -- crossing again: within 48 h = the same record, no new push; after expiry = a new record and a new push
  v_n := ${pushes('v_a')};
  select id into v_id from sightings where user_a = least(v_a, v_c) and user_b = greatest(v_a, v_c);
  ${cross('v_a', 'v_c')};
  log := log || jsonb_build_array(jsonb_build_object('step','recross_within_48h_same_record','ok',
     (select id = v_id and expires_at > now() + interval '47 hours 59 minutes' from sightings where user_a = least(v_a, v_c) and user_b = greatest(v_a, v_c))
     and ${pushes('v_a')} = v_n));
  ${cross('v_a', 'v_b')};
  log := log || jsonb_build_array(jsonb_build_object('step','recross_after_expiry_new_record_and_push','ok',
     exists (select 1 from sightings where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b) and expires_at > now())
     and ${pushes('v_a')} = v_n + 1));
  ${visibleTo('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step','a_sees_b_again','ok',
     v_seen @> jsonb_build_array(v_b) and v_seen @> jsonb_build_array(v_c) and not v_seen @> jsonb_build_array(v_blk), 'data', v_seen));
`);
    s = stepMap(log);
    ids = s.ids.data;
  }, 60000);

  test.each([
    'a_sees_only_active', 'b_no_longer_sees_a', 'stranger_sees_none', 'app_cannot_purge', 'expired_deleted', 'active_kept',
    'scheduled', 'recross_within_48h_same_record', 'recross_after_expiry_new_record_and_push', 'a_sees_b_again',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
  test('the blocked person is never among what A sees', () => {
    expect(s.a_sees_b_again.data).not.toContain(ids.blk);
  });
});
