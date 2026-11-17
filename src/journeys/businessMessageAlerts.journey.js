// Business message alerts (owner, 2026-11-17; migration 20270428): a customer writes to a business -> the people who manage
// THAT location get one alert through _send_push (the outbox; send-push emails it only when they have no app). Never the
// sender, never the customer, never a suspended manager, never a manager blocked either way with the customer, never a
// muted one ("New requests"), never another business's managers. A burst is ONE alert per conversation per 5 minutes; every
// message is still stored. A business reply alerts nobody. The alert names no text, no customer. A failing alert never
// refuses the message. On the multi-location tree (20270424), a member of the location who is acting for another one still
// gets it, naming the location the message is about.
// One rolled-back transaction; app.push_handoff_test_failure keeps every push in the outbox (never handed to send-push).
// Concurrency (two messages in parallel transactions) = scripts/replay/business-message-alert-concurrency.js.
// Not covered (device/email): the push on a phone, the email in an inbox, the tap opening the conversation on a device.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { notificationDestination } = require('../navigation/notificationDestinations');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
const alertsSince = (step) => rec(step, `(select coalesce(jsonb_agg(jsonb_build_object('to', o.recipient_id, 'title', o.title, 'body', o.body,
    'data', o.data, 'dedupe', o.dedupe_key) order by o.id), '[]'::jsonb)
    from push_outbox o where o.id > v_start and o.data->>'type' = 'business_message_received')`);
const mark = `select coalesce(max(id), 0) into v_start from push_outbox;`;
const send = (who, partner, body) => `${as(who)}
  insert into business_messages (partner_id, sender_id, conversation_with_id, from_business, body) values (${partner}, ${who}, ${who}, false, '${body}');
  reset role;`;

d('journey: a customer writes to a business -> its managers get one alert, opening that conversation', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_oa', 'v_om', 'v_os', 'v_omute', 'v_oblk', 'v_ob', 'v_c', 'v_c2', 'v_c3'];
    const log = await runJourney(`${actorDeclares(people)} v_pa uuid := gen_random_uuid(); v_pb uuid := gen_random_uuid(); v_start bigint; v_n int; v_multi boolean;`, `
  ${actorsSql({ people, business: { owner: 'v_oa', partner: 'v_pa' } })}
  ${actorsSql({ people: [], business: { owner: 'v_ob', partner: 'v_pb', lat: 40.01 } })}
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox as 'retry', never handed to send-push
  perform set_config('app.trusted_update', 'true', true);
  -- location A: owner OA + four more managers (OM ordinary, OS suspended, OMUTE muted "New requests", OBLK, whom customer C3 blocked)
  update profiles set managed_partner_id = v_pa where id in (v_om, v_os, v_omute, v_oblk);
  update profiles set suspended_at = now() where id = v_os;
  update profiles set notification_mutes = array['owner_requests'] where id = v_omute;
  insert into blocks (blocker_id, blocked_id) values (v_c3, v_oblk);
  insert into business_followers (brand_partner_id, user_id) values (v_pa, v_c), (v_pa, v_c2), (v_pa, v_c3), (v_pb, v_c), (v_pa, v_oa);
  v_multi := to_regclass('private.business_memberships') is not null;
  if v_multi then
    -- OB acts for B but is also staff at A (the second-location gate is lifted only for this fixture, rolled back)
    execute 'alter table private.business_memberships disable trigger gate_second_location';
    execute format('insert into private.business_memberships (user_id, partner_id, role) values (%L, %L, ''staff'') on conflict do nothing', v_ob, v_pa);
    execute 'alter table private.business_memberships enable trigger gate_second_location';
  end if;
  perform set_config('app.trusted_update', 'false', true);
  ${rec('meta', `jsonb_build_object('multi', v_multi, 'pa', v_pa, 'pb', v_pb, 'ids', jsonb_build_object('oa', v_oa, 'om', v_om, 'os', v_os, 'omute', v_omute, 'oblk', v_oblk, 'ob', v_ob, 'c', v_c, 'c2', v_c2, 'c3', v_c3))`)}

  -- 1. C's first message to A
  ${mark}
  ${send('v_c', 'v_pa', 'Do you have oat milk?')}
  ${alertsSince('first')}

  -- 2. C writes four more right away: stored, no new alert
  ${mark}
  ${send('v_c', 'v_pa', 'And is the patio open?')}
  ${send('v_c', 'v_pa', 'For 4 people')}
  ${send('v_c', 'v_pa', 'Around 7')}
  ${alertsSince('burst')}
  ${rec('stored', `(select count(*) from business_messages where partner_id = v_pa and conversation_with_id = v_c)`)}

  -- 3. another customer's conversation with A alerts on its own
  ${mark}
  ${send('v_c2', 'v_pa', 'Hello')}
  ${alertsSince('other_customer')}

  -- 4. A replies (from the business): nobody is alerted, and the window is untouched
  ${mark}
  ${as('v_oa')}
  insert into business_messages (partner_id, sender_id, conversation_with_id, from_business, body) values (v_pa, v_oa, v_c, true, 'Yes to both!');
  reset role;
  ${alertsSince('reply')}

  -- 5. C writes to B: only B's people (never A's), naming B
  ${mark}
  ${send('v_c', 'v_pb', 'Are you open Sunday?')}
  ${alertsSince('other_business')}

  -- 6. five minutes later C writes to A again: one new alert
  update private.business_message_alert_windows set last_alerted_at = last_alerted_at - interval '5 minutes 1 second'
   where partner_id = v_pa and customer_id = v_c;
  ${mark}
  ${send('v_c', 'v_pa', 'Booking for tomorrow instead')}
  ${alertsSince('after_window')}

  -- 7. A's own owner writes to A as a customer: never alerted about their own message
  ${mark}
  ${send('v_oa', 'v_pa', 'Testing my own inbox')}
  ${alertsSince('own_message')}

  -- 8. what the customer and another business's manager can read of the windows and the outbox
  ${as('v_c')}
  begin
    perform 1 from private.business_message_alert_windows;
    ${rec('cust_windows', `'"allowed"'::jsonb`)}
  exception when others then
    ${rec('cust_windows', `'"refused"'::jsonb`)}
  end;
  begin
    select count(*) into v_n from push_outbox where data->>'type' = 'business_message_received';
    ${rec('cust_outbox', 'to_jsonb(v_n)')}
  exception when others then
    ${rec('cust_outbox', `'"refused"'::jsonb`)}
  end;
  reset role;

  -- 8b. C3 blocked a manager of A: the app's message policy already refuses C3 writing to A at all; a server-side insert
  -- (no policy) still never alerts the blocked manager
  ${as('v_c3')}
  begin
    insert into business_messages (partner_id, sender_id, conversation_with_id, from_business, body) values (v_pa, v_c3, v_c3, false, 'hi');
    ${rec('blocked_policy', `'"allowed"'::jsonb`)}
  exception when others then
    ${rec('blocked_policy', `'"refused"'::jsonb`)}
  end;
  reset role;
  ${mark}
  insert into business_messages (partner_id, sender_id, conversation_with_id, from_business, body) values (v_pa, v_c3, v_c3, false, 'hi');
  ${alertsSince('blocked')}

  -- 9. a failing alert never refuses the message (the recipient helper is broken for this step only, rolled back)
  execute $f$create or replace function private._business_message_recipients(p_partner uuid) returns setof uuid
    language plpgsql security definer set search_path to 'public' as $b$ begin raise exception 'simulated alert failure'; end $b$;$f$;
  update private.business_message_alert_windows set last_alerted_at = now() - interval '1 hour' where partner_id = v_pa and customer_id = v_c2;
  ${mark}
  ${send('v_c2', 'v_pa', 'Still there?')}
  ${alertsSince('failure_alerts')}
  ${rec('failure_stored', `(select count(*) from business_messages where partner_id = v_pa and conversation_with_id = v_c2 and body = 'Still there?')`)}
  ${rec('failure_window', `(select to_jsonb(last_alerted_at < now() - interval '30 minutes') from private.business_message_alert_windows where partner_id = v_pa and customer_id = v_c2)`)}
`);
    s = stepMap(log);
  }, 120000);

  const to = (step) => s[step].data.map((a) => a.to).sort();
  const ids = () => s.meta.data.ids;

  test('first message: A\'s managers (and on multi-location, A\'s staff acting for B); never the suspended or muted manager, the customer or B', () => {
    const { oa, om, oblk, ob } = ids();
    expect(to('first')).toEqual((s.meta.data.multi ? [oa, om, oblk, ob] : [oa, om, oblk]).sort());
  });
  test('a manager blocked either way with the customer is never alerted (and the policy refuses that customer already)', () => {
    expect(s.blocked_policy.data).toBe('refused');
    expect(to('blocked')).not.toContain(ids().oblk);
    expect(to('blocked')).toContain(ids().oa);
  });
  test('the alert says nothing about the customer or the text, names the message and the location, one dedupe key per message + person', () => {
    for (const a of s.first.data) {
      expect(a.title).toBe('New message from a customer');
      expect(a.body).toBe('Open it to read and reply.');
      expect(Object.keys(a.data).sort()).toEqual(['message_id', 'partner_id', 'type']);
      expect(a.data.partner_id).toBe(s.meta.data.pa);
      expect(a.dedupe).toBe(`business_message:${a.data.message_id}:${a.to}`);
    }
    expect(JSON.stringify(s.first.data)).not.toMatch(/oat milk/);
    expect(JSON.stringify(s.first.data)).not.toContain(ids().c);
  });
  test('a burst: every message stored, no second alert inside 5 minutes', () => {
    expect(s.burst.data).toEqual([]);
    expect(s.stored.data).toBe(4);
  });
  test('another customer\'s conversation alerts on its own', () => {
    expect(s.other_customer.data.length).toBeGreaterThan(0);
  });
  test('a business reply alerts nobody', () => {
    expect(s.reply.data).toEqual([]);
  });
  test('a message to B reaches only B\'s people and names B', () => {
    expect(to('other_business')).toEqual([ids().ob]);
    expect(s.other_business.data[0].data.partner_id).toBe(s.meta.data.pb);
  });
  test('after 5 minutes the same conversation alerts again, once', () => {
    expect(to('after_window')).toEqual(to('first'));
  });
  test('the sender is never alerted about their own message (an owner writing to their own business)', () => {
    expect(to('own_message')).not.toContain(ids().oa);
    expect(to('own_message')).toContain(ids().om);
  });
  test('the customer can\'t read the windows or any business alert', () => {
    expect(s.cust_windows.data).toBe('refused');
    expect([0, 'refused']).toContain(s.cust_outbox.data);
  });
  test('a failing alert: the message is stored, no alert, the window not claimed', () => {
    expect(s.failure_alerts.data).toEqual([]);
    expect(s.failure_stored.data).toBe(1);
    expect(s.failure_window.data).toBe(true);
  });
  test('the queued payload opens the inbox on that message', async () => {
    const a = s.first.data[0];
    expect(await notificationDestination(a.data)).toEqual({ name: 'BusinessDashboard', params: { initialSection: 'inbox_modal', focusMessageId: a.data.message_id } });
  });
});
