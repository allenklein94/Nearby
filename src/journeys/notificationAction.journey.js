// Items 140 + 141 as a CORE JOURNEY: notification -> action. Each notification is produced by the REAL database sender
// (one rolled-back transaction), read back exactly as it was queued (push_outbox: title, body, data), then put through
// the SAME client code the phone runs: the button on the notification (NOTIFICATION_ACTION_BY_TYPE + its translated
// label, the categoryId send-push sets), where the tap/button opens (notificationDestination, the real push-tap table),
// and how loudly it arrives (notificationPriority). The owner's examples:
//   approved to a gathering          -> View Plan       -> that gathering        (medium)
//   a business sent an offer         -> View Offer      -> the request, on that offer (high)
//   a spot opened (off the waitlist) -> View Plan       -> that gathering        (medium)
//   your gathering starts soon       -> View Plan       -> that gathering        (high)
//   your business request expires    -> Review Request  -> the dashboard, on that request (high)
//   something nearby fits you        -> View Gathering  -> that gathering        (low)
// plus a sweep: EVERY push the transaction produced has a button, a destination and a priority.
// Labels are navigation only (item 140, LOCKED): "a spot opened" does not say Join, because the waitlisted person is
// already in when it is sent (auto-approved) and a button cannot know the current state; Join stays on the screen.
// NOT covered: the OS rendering the button, send-push delivery, a device (none exists).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { NOTIFICATION_ACTION_BY_TYPE, categoryIdFor } from '../constants/notificationActions';
import { notificationPriority } from '../constants/notificationTier';
import { notificationDestination } from '../navigation/notificationDestinations';
import { UI_LANGUAGES } from '../i18n/ui';
import { translate } from '../i18n/translate';

const d = hasToken ? describe : describe.skip;

d('journey: every notification leads to one direct next action (items 140 + 141)', () => {
  let s;
  let pushes;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const [h, g, w] = (await runSql(`select id from profiles where managed_partner_id is null order by id limit 3;`)).map((p) => p.id);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
      v_h uuid := '${h}'; v_g uuid := '${g}'; v_w uuid := '${w}';
      v_start bigint; v_g1 uuid; v_g2 uuid; v_g3 uuid; v_g4 uuid; v_g5 uuid; v_int uuid; v_req uuid; v_req2 uuid; v_offer uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'true', true);  -- queued exactly as sent, never handed to send-push
  select coalesce(max(id), 0) into v_start from push_outbox;

  -- setup: nobody blocked or muted, the business is live at 40,-75, the guest likes Coffee nearby
  delete from blocks where blocker_id in (v_h, v_g, v_w, v_owner) or blocked_id in (v_h, v_g, v_w, v_owner);
  update profiles set notification_mutes = '{}' where id in (v_h, v_g, v_w, v_owner);
  update profiles set interests = array['Coffee'], notify_things_to_do_categories = null, notify_things_to_do_max_distance_miles = null,
         notify_things_to_do_time_pref = 'anytime', notify_things_to_do_frequency = 'as_they_happen' where id = v_g;
  delete from presence_reports where user_id = v_g;
  delete from recommendation_push_log where user_id = v_g;
  insert into notification_areas (user_id, area, updated_at) values (v_g, '40,-75', now())
    on conflict (user_id) do update set area = excluded.area, updated_at = now();
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;

  -- 1. the host approves the guest's request to join (gathering starts in 30 minutes, approval required)
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public, requires_approval, reminder_sent)
    values (v_h, 'Board game night', now() + interval '30 minutes', 40.0, -75.0, 'Board Games', 'journey', 6, 'everyone', true, true, false)
    returning id into v_g1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform join_gathering(v_g1);
  select id into v_int from gathering_interest where gathering_id = v_g1 and user_id = v_g;
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  perform approve_gathering_interest(v_int);
  log := log || jsonb_build_array(jsonb_build_object('step','approved','ok', true, 'data', jsonb_build_object('gathering', v_g1, 'guest', v_g)));

  -- 2. a spot opens: host + 1 guest; the waiter is waitlisted, the guest leaves, the waiter is in
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_h, 'Trivia at the pub', now() + interval '3 days', 40.0, -75.0, 'Board Games', 'journey', 2, 'everyone', true)
    returning id into v_g2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform join_gathering(v_g2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_w, 'role', 'authenticated')::text, true);
  perform join_gathering(v_g2);
  log := log || jsonb_build_array(jsonb_build_object('step','waitlisted','ok',
    (select status from gathering_interest where gathering_id = v_g2 and user_id = v_w) = 'waitlisted'));
  perform set_config('request.jwt.claims', json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform leave_gathering(v_g2);
  log := log || jsonb_build_array(jsonb_build_object('step','spot_opened','ok',
    (select status from gathering_interest where gathering_id = v_g2 and user_id = v_w) = 'approved',
    'data', jsonb_build_object('gathering', v_g2, 'waiter', v_w)));

  -- 3. starts soon: the reminder job runs (gathering 1 is 30 minutes away)
  perform send_gathering_reminders();
  log := log || jsonb_build_array(jsonb_build_object('step','reminder','ok', true, 'data', jsonb_build_object('gathering', v_g1)));

  -- 4. the host asks Coastal-Coffee-style business directly; the business sends an offer
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_h, 'Coffee catch-up', now() + interval '1 day', 40.0, -75.0, 'Board Games', 'journey', 4, 'everyone', true)
    returning id into v_g3;
  v_req := (create_business_request_for_gathering(v_g3, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_req, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','offer','ok', v_offer is not null,
    'data', jsonb_build_object('request', v_req, 'offer', v_offer, 'host', v_h)));

  -- 5. another request to the business sits unanswered and is about to expire
  perform set_config('request.jwt.claims', json_build_object('sub', v_h, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_h, 'Weekend brunch', now() + interval '2 days', 40.0, -75.0, 'Board Games', 'journey', 4, 'everyone', true)
    returning id into v_g4;
  v_req2 := (create_business_request_for_gathering(v_g4, 'Brunch for the group', 'Coffee', 20, 15, null, null, v_partner, null)->>'requestId')::uuid;
  update business_requests set created_at = now() - interval '1 day', expires_at = now() + interval '100 minutes' where id = v_req2;
  update business_request_offers set created_at = now() - interval '1 day' where request_id = v_req2;
  perform send_business_request_expiry_warnings();
  log := log || jsonb_build_array(jsonb_build_object('step','expiring','ok', true, 'data', jsonb_build_object('request', v_req2, 'owner', v_owner)));

  -- 6. low: a Coffee gathering appears near the guest, who declared Coffee
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_h, 'Morning coffee walk', now() + interval '4 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone', true)
    returning id into v_g5;
  log := log || jsonb_build_array(jsonb_build_object('step','recommended','ok', true, 'data', jsonb_build_object('gathering', v_g5, 'guest', v_g)));

  -- everything the transaction queued, exactly as queued
  log := log || jsonb_build_array(jsonb_build_object('step','pushes','ok', true, 'data',
    (select coalesce(jsonb_agg(jsonb_build_object('to', recipient_id, 'title', title, 'body', body, 'data', data) order by id), '[]')
       from push_outbox where id > v_start)));
`);
    s = stepMap(log);
    pushes = s.pushes.data;
  }, 120000);

  const find = (to, type, key, id) => pushes.find((p) => p.to === to && p.data.type === type && (!key || p.data[key] === id));
  const label = (type, lang = 'en') => translate(lang, `ui.notificationActions.${NOTIFICATION_ACTION_BY_TYPE[type]}`);

  test('the story ran', () => {
    for (const k of ['approved', 'waitlisted', 'spot_opened', 'reminder', 'offer', 'expiring', 'recommended']) expect(s[k].ok).toBe(true);
  });

  test('approved -> View Plan -> that gathering, medium', async () => {
    const { gathering, guest } = s.approved.data;
    const p = find(guest, 'gathering_approved', 'gathering_id', gathering);
    expect(p).toBeDefined();
    expect(p.body).toMatch(/You're in/);
    expect(label(p.data.type)).toBe('View Plan');
    expect(await notificationDestination(p.data)).toEqual(expect.objectContaining({ name: 'GatheringDetail', params: expect.objectContaining({ gatheringId: gathering }) }));
    expect(notificationPriority(p.data.type)).toBe('medium');
  });

  test('a business sent an offer -> View Offer -> the request, opened on that offer, high', async () => {
    const { request, offer, host } = s.offer.data;
    const p = find(host, 'business_offer_received', 'request_id', request);
    expect(p).toBeDefined();
    expect(p.data.offer_id).toBe(offer);
    expect(label(p.data.type)).toBe('View Offer');
    expect(await notificationDestination(p.data)).toEqual({ name: 'BusinessRequestDetail', params: expect.objectContaining({ requestId: request, focusOfferId: offer }) });
    expect(notificationPriority(p.data.type)).toBe('high');
  });

  test('a spot opened -> View Plan (already in, so never Join) -> that gathering', async () => {
    const { gathering, waiter } = s.spot_opened.data;
    const p = find(waiter, 'gathering_approved', 'gathering_id', gathering);
    expect(p).toBeDefined();
    expect(p.body).toMatch(/spot opened/i);
    expect(label(p.data.type)).toBe('View Plan');
    expect(await notificationDestination(p.data)).toEqual(expect.objectContaining({ name: 'GatheringDetail', params: expect.objectContaining({ gatheringId: gathering }) }));
  });

  test('starts soon -> View Plan -> that gathering, high, and says the real time left', async () => {
    const { gathering } = s.reminder.data;
    const p = find(s.approved.data.guest, 'gathering_reminder', 'gathering_id', gathering);
    expect(p).toBeDefined();
    expect(p.body).toMatch(/starts in about (25|30|35) minutes/);
    expect(label(p.data.type)).toBe('View Plan');
    expect(await notificationDestination(p.data)).toEqual(expect.objectContaining({ name: 'GatheringDetail', params: expect.objectContaining({ gatheringId: gathering }) }));
    expect(notificationPriority(p.data.type)).toBe('high');
  });

  test('your business request expires soon -> Review Request -> the dashboard on that request, high', async () => {
    const { request, owner } = s.expiring.data;
    const p = find(owner, 'business_request_expiring', 'request_id', request);
    expect(p).toBeDefined();
    expect(label(p.data.type)).toBe('Review Request');
    expect(await notificationDestination(p.data)).toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests', focusRequestId: request } });
    expect(notificationPriority(p.data.type)).toBe('high');
  });

  test('something nearby fits you -> View Gathering -> that gathering, low (never interrupts)', async () => {
    const { gathering, guest } = s.recommended.data;
    const p = pushes.find((x) => x.to === guest && x.data.gathering_id === gathering);
    expect(p).toBeDefined();
    expect(notificationPriority(p.data.type)).toBe('low');
    expect(label(p.data.type)).toBe('View Gathering');
    expect(await notificationDestination(p.data)).toEqual(expect.objectContaining({ name: 'GatheringDetail', params: expect.objectContaining({ gatheringId: gathering }) }));
  });

  test('sweep: every push the story produced has one button (translated everywhere), a destination and a priority', async () => {
    expect(pushes.length).toBeGreaterThanOrEqual(6);
    for (const p of pushes) {
      const key = NOTIFICATION_ACTION_BY_TYPE[p.data.type];
      expect({ type: p.data.type, key }).toEqual({ type: p.data.type, key: expect.any(String) });
      expect(categoryIdFor(p.data.type)).toBe(`nearby_${key}`);
      for (const lang of UI_LANGUAGES) expect(label(p.data.type, lang)).not.toMatch(/^ui\./);
      expect(await notificationDestination(p.data)).not.toBeNull();
      expect(['high', 'medium', 'low']).toContain(notificationPriority(p.data.type));
    }
  });
});
