// Owner decision 2026-10-20 (idea "244" follow-up, option 1 "Share button only"): a person explicitly shares a gathering
// into one of their own one-to-one chats as a compact card (share_gathering_in_chat, migration 20270331). Every actor runs
// under the real `authenticated` role + JWT claims, so the RLS policies, grants and the guard trigger are exercised:
//   share works for a chat participant who can see the gathering; the recipient sees the card's gathering ONLY through
//   their own item 147 read (public = row, friends-only of someone else's host = no row); the push says "Shared a
//   gathering" with no title; refused: a gathering the sender can't see, a chat they're not in, a blocked chat, a direct
//   insert/update of gathering_id, anon; a deleted gathering keeps the message as a share nobody can read through.
// One rolled-back transaction; pushes stay in the outbox. Not covered (device only): the sheet, the card, tap -> detail,
// Back -> chat, the real push on a phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

// One statement as `sub` under the real role; records 'ok' (or a value) or the error text.
function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then v_out := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}

d('journey: a gathering shared into a one-to-one chat', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_host', 'v_f', 'v_s'])}
      v_m_fs uuid; v_m_hf uuid; g_pub uuid; g_fr uuid; v_msg uuid; v_plain uuid; v_n int; v_start bigint; v_out jsonb;`, `
  ${actorsSql({ people: ['v_host', 'v_f', 'v_s'], friends: [['v_host', 'v_f']] })}
  perform set_config('app.push_handoff_test_failure', 'on', true);
  update profiles set notify_dating = true where id in (v_host, v_f, v_s);
  insert into matches (user_a, user_b) values (v_f, v_s) returning id into v_m_fs;
  insert into matches (user_a, user_b) values (v_host, v_f) returning id into v_m_hf;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public, discoverable)
    values (v_host, 'JSG public', now() + interval '1 day', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true, true) returning id into g_pub;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_host, 'JSG friends', now() + interval '1 day', 1.5, -150.5, 'Coffee', 'journey', 10, 'friends', false) returning id into g_fr;
  select coalesce(max(id), 0) into v_start from push_outbox;

  -- F (a friend of the host) shares the public gathering into F's chat with S
  ${as('share_public', 'v_f', 'v_msg := share_gathering_in_chat(v_m_fs, g_pub)')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'row', 'ok', true, 'data',
    (select jsonb_build_object('gathering', gathering_id = g_pub, 'sender', sender_id = v_f, 'body', body) from messages where id = v_msg)));
  -- S, the recipient, sees the message and (public) the gathering through their own read
  ${as('s_reads_msg', 'v_s', 'select count(*) into v_n from messages where id = v_msg and gathering_id = g_pub', 'v_n')}
  ${as('s_reads_pub', 'v_s', 'select count(*) into v_n from gatherings where id = g_pub', 'v_n')}

  -- F shares the host's friends-only gathering (F may see it); S may not, so S's read returns nothing
  ${as('share_friends', 'v_f', 'v_msg := share_gathering_in_chat(v_m_fs, g_fr)')}
  ${as('s_reads_fr', 'v_s', 'select count(*) into v_n from gatherings where id = g_fr', 'v_n')}
  ${as('f_reads_fr', 'v_f', 'select count(*) into v_n from gatherings where id = g_fr', 'v_n')}

  log := log || jsonb_build_array(jsonb_build_object('step', 'push', 'ok', true, 'data', (
    select jsonb_agg(jsonb_build_object('to_s', recipient_id = v_s, 'body', body, 'type', data->>'type',
      'chat', (data->>'match_id')::uuid = v_m_fs, 'has_title', (title || body) like '%JSG%') order by id)
    from push_outbox where id > v_start)));

  -- refusals
  ${as('s_shares_unseen', 'v_s', 'perform share_gathering_in_chat(v_m_fs, g_fr)')}
  ${as('s_not_in_chat', 'v_s', 'perform share_gathering_in_chat(v_m_hf, g_pub)')}
  ${as('direct_insert', 'v_f', `insert into messages (match_id, sender_id, body, gathering_id) values (v_m_fs, v_f, '', g_pub)`)}
  ${as('plain_insert', 'v_f', `insert into messages (match_id, sender_id, body) values (v_m_fs, v_f, 'hi') returning id into v_plain`)}
  ${as('direct_update', 'v_f', 'update messages set gathering_id = g_pub where id = v_plain')}
  ${as('mark_read_still_works', 'v_s', 'update messages set read_at = now() where match_id = v_m_fs and sender_id = v_f')}
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform share_gathering_in_chat(v_m_fs, g_pub); v_out := '"ok"';
  exception when others then v_out := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'anon', 'ok', true, 'data', v_out));
  insert into blocks (blocker_id, blocked_id) values (v_s, v_f);
  ${as('blocked', 'v_f', 'perform share_gathering_in_chat(v_m_fs, g_pub)')}
  delete from blocks where blocker_id = v_s and blocked_id = v_f;

  -- the host deletes the public gathering: the message stays a share (the card then reads "no longer available")
  delete from gatherings where id = g_pub;
  log := log || jsonb_build_array(jsonb_build_object('step', 'after_delete', 'ok', true, 'data',
    (select jsonb_build_object('messages', count(*), 'linked', count(gathering_id)) from messages where match_id = v_m_fs and body = '')));
  ${as('s_reads_deleted', 'v_s', 'select count(*) into v_n from gatherings where id = g_pub', 'v_n')}`);
    s = stepMap(log);
  }, 60000);

  test('a chat participant who can see the gathering shares it as one card message', () => {
    expect(s.share_public.data).toBe('ok');
    expect(s.row.data).toEqual({ gathering: true, sender: true, body: '' });
  });

  test('the recipient sees the card, and a public gathering through their own read', () => {
    expect(s.s_reads_msg.data).toBe(1);
    expect(s.s_reads_pub.data).toBe(1);
  });

  test('item 147: a friends-only gathering the recipient may not see stays unreadable to them', () => {
    expect(s.share_friends.data).toBe('ok');
    expect(s.f_reads_fr.data).toBe(1);
    expect(s.s_reads_fr.data).toBe(0);
  });

  test('the push says "Shared a gathering", opens the chat, and never carries the title', () => {
    expect(s.push.data).toHaveLength(2);
    for (const p of s.push.data) expect(p).toEqual({ to_s: true, body: 'Shared a gathering', type: 'message', chat: true, has_title: false });
  });

  test('refused: a gathering the sender cannot see, a chat they are not in, anon, a blocked chat', () => {
    expect(s.s_shares_unseen.data).toBe('Gathering not found');
    expect(s.s_not_in_chat.data).toBe('Chat not found');
    expect(String(s.anon.data)).toMatch(/permission denied/);
    expect(s.blocked.data).toBe('Chat not found');
  });

  test('gathering_id is never written directly; ordinary messages and read receipts still work', () => {
    expect(s.direct_insert.data).toBe('A gathering can only be shared with Share in a chat');
    expect(s.plain_insert.data).toBe('ok');
    expect(s.direct_update.data).toBe('A shared gathering can\'t be changed');
    expect(s.mark_read_still_works.data).toBe('ok');
  });

  test('a deleted gathering keeps both messages as shares, and reads as nothing', () => {
    expect(s.after_delete.data).toEqual({ messages: 2, linked: 2 });
    expect(s.s_reads_deleted.data).toBe(0);
  });
});
