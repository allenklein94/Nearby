// Item 125: notifications are event-driven. Every core-loop domain action emits ONE canonical event, and the ONE
// dispatcher decides who (if anyone) is notified. This journey walks the whole loop in one rolled-back transaction:
// gathering created -> invitation sent / accepted / expired -> request sent (directed + fan-out) -> offer sent ->
// offer accepted -> offer redeemed, and checks for each: the event exists exactly once, who was notified, the exact
// push wording and deep link (from the pg_net queue), mutes, blocks, idempotency, and that reading state (what every
// screen does) never creates an event or a push. NOT covered: delivery by send-push itself (edge function), devices.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { DOMAIN_EVENTS } from '../constants/domainEvents';

const d = hasToken ? describe : describe.skip;

d('journey: domain events -> one notification layer (item 125)', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const people = await runSql(`select id from profiles where id <> '${owner.id}' order by id limit 3;`);
    const [a, b, c] = people.map((p) => p.id);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
      v_a uuid := '${a}'; v_b uuid := '${b}'; v_c uuid := '${c}';
      v_g1 uuid; v_g2 uuid; v_g3 uuid; v_g4 uuid; v_inv1 uuid; v_inv4 uuid; v_res jsonb; v_req uuid; v_req2 uuid; v_req3 uuid;
      v_offer uuid; v_ev bigint; v_n int; v_n2 int; v_q int; v_before int; v_title text; v_body text; v_x record;
      v_start bigint;`, `
  -- queue helper view: what send-push would receive, as jsonb
  create temp view jq as
    select id, convert_from(body, 'utf8')::jsonb as b from net.http_request_queue where url like '%/send-push';
  select coalesce(max(id), 0) into v_start from domain_events;

  -- setup: A and B are friends, nobody is blocked, the business is live at 40,-75, C wants Coffee nearby
  delete from blocks where blocker_id in (v_a, v_b, v_c, v_owner) or blocked_id in (v_a, v_b, v_c, v_owner);
  if not exists (select 1 from friendships where (user_a = v_a and user_b = v_b) or (user_a = v_b and user_b = v_a)) then
    insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_b, 'accepted', v_a);
  else
    update friendships set status = 'accepted' where (user_a = v_a and user_b = v_b) or (user_a = v_b and user_b = v_a);
  end if;
  update profiles set notify_planning = true, notify_business = true, notify_discovery = true where id in (v_a, v_b, v_c, v_owner);
  update profiles set interests = array['Coffee'], notify_things_to_do_categories = null, notify_things_to_do_max_distance_miles = null,
         notify_things_to_do_time_pref = 'anytime', notify_things_to_do_frequency = 'as_they_happen' where id = v_c;
  delete from presence_reports where user_id = v_c;
  delete from recommendation_push_log where user_id = v_c;
  insert into notification_areas (user_id, area, updated_at) values (v_c, '40,-75', now())
    on conflict (user_id) do update set area = excluded.area, updated_at = now();
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;

  -- 1. GATHERING_CREATED: C (declared Coffee, nearby) gets the exact "This matches you" push, once
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_a, 'Journey coffee', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone', true) returning id into v_g1;
  select count(*) into v_n from domain_events where type = 'GATHERING_CREATED' and object_id = v_g1;
  select count(*) into v_q from jq where b->>'recipient_id' = v_c::text and b->'data'->>'gathering_id' = v_g1::text;
  select b->>'title', b->>'body' into v_title, v_body from jq where b->>'recipient_id' = v_c::text and b->'data'->>'gathering_id' = v_g1::text limit 1;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_created','ok', v_n = 1 and v_q = 1,
    'data', jsonb_build_object('events', v_n, 'pushes', v_q, 'title', v_title, 'body', v_body,
      'type', (select b->'data'->>'type' from jq where b->'data'->>'gathering_id' = v_g1::text limit 1),
      'logged', (select count(*) from recommendation_push_log where user_id = v_c and source_id = v_g1))));

  -- 1b. blocked: C blocks A; A's next gathering is recorded but C is not notified
  insert into blocks (blocker_id, blocked_id) values (v_c, v_a);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_a, 'Journey coffee 2', now() + interval '4 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone', true) returning id into v_g2;
  delete from blocks where blocker_id = v_c and blocked_id = v_a;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_created_blocked','ok',
    (select count(*) from domain_events where type = 'GATHERING_CREATED' and object_id = v_g2) = 1
    and (select count(*) from jq where b->'data'->>'gathering_id' = v_g2::text and b->>'recipient_id' = v_c::text) = 0,
    'data', jsonb_build_object('outcome', (select n.outcome from domain_event_notifications n join domain_events e on e.id = n.event_id
                                            where e.object_id = v_g2 and n.recipient_id = v_c))));

  -- 1c. not eligible (link only): recorded, nobody notified
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public, discoverable)
    values (v_a, 'Journey link only', now() + interval '5 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone', true, false) returning id into v_g3;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_created_no_recipient','ok',
    (select count(*) from domain_events where type = 'GATHERING_CREATED' and object_id = v_g3) = 1
    and (select count(*) from domain_event_notifications n join domain_events e on e.id = n.event_id where e.object_id = v_g3) = 0
    and (select count(*) from jq where b->'data'->>'gathering_id' = v_g3::text) = 0));

  -- 2. INVITATION_SENT via invite_friend_to_gathering: B gets the exact invite push; inviting again sends nothing new
  perform invite_friend_to_gathering(v_g1, v_b);
  perform invite_friend_to_gathering(v_g1, v_b);
  select id into v_inv1 from social_invites where inviter_id = v_a and invitee_id = v_b and target_id = v_g1 and status = 'pending';
  select b->>'title', b->>'body' into v_title, v_body from jq where b->>'recipient_id' = v_b::text and b->'data'->>'type' = 'gathering_invite' and b->'data'->>'gathering_id' = v_g1::text limit 1;
  log := log || jsonb_build_array(jsonb_build_object('step','invitation_sent','ok',
    (select count(*) from domain_events where type = 'INVITATION_SENT' and object_id = v_inv1) = 1
    and (select count(*) from jq where b->>'recipient_id' = v_b::text and b->'data'->>'gathering_id' = v_g1::text) = 1,
    'data', jsonb_build_object('title', v_title, 'body', v_body,
      'inviter', (select display_name from profiles where id = v_a), 'source', (select source from domain_events where object_id = v_inv1 and type = 'INVITATION_SENT'))));

  -- 2b. muted: B turned Plans notifications off -> recorded, outcome muted, no push
  update profiles set notify_planning = false where id = v_b;
  perform invite_friend_to_gathering(v_g2, v_b);
  update profiles set notify_planning = true where id = v_b;
  log := log || jsonb_build_array(jsonb_build_object('step','invitation_sent_muted','ok',
    (select count(*) from jq where b->>'recipient_id' = v_b::text and b->'data'->>'gathering_id' = v_g2::text) = 0,
    'data', jsonb_build_object('outcome', (select n.outcome from domain_event_notifications n join domain_events e on e.id = n.event_id
      join social_invites i on i.id = e.object_id where i.target_id = v_g2 and n.recipient_id = v_b))));

  -- 2c. send_social_invite: recorded as INVITATION_SENT, no push (it never pushed)
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_a, 'Journey soon past', now() + interval '6 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone', true) returning id into v_g4;
  select count(*) into v_before from jq;
  perform send_social_invite('gathering', v_g4, v_b);
  select id into v_inv4 from social_invites where inviter_id = v_a and invitee_id = v_b and target_id = v_g4;
  log := log || jsonb_build_array(jsonb_build_object('step','invitation_sent_record_only','ok',
    (select count(*) from domain_events where type = 'INVITATION_SENT' and object_id = v_inv4) = 1
    and (select count(*) from jq) = v_before));

  -- 3. INVITATION_ACCEPTED (record only) and 3b. INVITATION_EXPIRED (record only)
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_before from jq;
  perform respond_to_social_invite(v_inv1, true);
  update gatherings set scheduled_at = now() - interval '1 hour' where id = v_g4;
  perform respond_to_social_invite(v_inv4, false);
  log := log || jsonb_build_array(jsonb_build_object('step','invitation_accepted_expired','ok',
    (select count(*) from domain_events where type = 'INVITATION_ACCEPTED' and object_id = v_inv1) = 1
    and (select count(*) from domain_events where type = 'INVITATION_EXPIRED' and object_id = v_inv4) = 1
    and (select count(*) from jq) = v_before
    and (select status from social_invites where id = v_inv4) = 'expired'));

  -- 4. BUSINESS_REQUEST_SENT (directed): the owner gets "A customer asked for your business"
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := create_business_request_for_gathering(v_g1, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  select b->>'title', b->>'body' into v_title, v_body from jq where b->>'recipient_id' = v_owner::text and b->'data'->>'request_id' = v_req::text limit 1;
  log := log || jsonb_build_array(jsonb_build_object('step','request_sent_directed','ok',
    (select count(*) from domain_events where type = 'BUSINESS_REQUEST_SENT' and object_id = v_offer) = 1
    and (select count(*) from jq where b->>'recipient_id' = v_owner::text and b->'data'->>'request_id' = v_req::text) = 1,
    'data', jsonb_build_object('title', v_title, 'body', v_body, 'summary', business_safe_request_summary(v_req),
      'type', (select b->'data'->>'type' from jq where b->'data'->>'request_id' = v_req::text limit 1),
      'leaks_raw_text', position('Coffee for the group' in coalesce(v_body, '')) > 0)));

  -- 4b. muted business: recorded, outcome muted, no push
  update profiles set notify_business = false where id = v_owner;
  v_res := create_business_request_for_gathering(v_g2, 'Another ask', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req2 := (v_res->>'requestId')::uuid;
  update profiles set notify_business = true where id = v_owner;
  log := log || jsonb_build_array(jsonb_build_object('step','request_sent_muted','ok',
    (select count(*) from jq where b->'data'->>'request_id' = v_req2::text) = 0,
    'data', jsonb_build_object('outcome', (select n.outcome from domain_event_notifications n join domain_events e on e.id = n.event_id
      where e.type = 'BUSINESS_REQUEST_SENT' and e.payload->>'request_id' = v_req2::text and n.recipient_id = v_owner))));

  -- 4c. fan-out: every business the request reached has exactly one BUSINESS_REQUEST_SENT
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := create_business_request('coffee today', 40.0, -75.0, null, 2, null, null, current_date, null, null, 15, null);
  v_req3 := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','request_sent_fanout','ok',
    (select count(*) from business_request_offers where request_id = v_req3)
      = (select count(*) from domain_events where type = 'BUSINESS_REQUEST_SENT' and payload->>'request_id' = v_req3::text)
    and not exists (select 1 from domain_events where payload->>'request_id' = v_req3::text group by idempotency_key having count(*) > 1),
    'data', jsonb_build_object('offers', (select count(*) from business_request_offers where request_id = v_req3),
      'reached_partner', exists (select 1 from business_request_offers where request_id = v_req3 and partner_id = v_partner),
      'owner_titles', (select jsonb_agg(b->>'title') from jq where b->'data'->>'request_id' = v_req3::text and b->>'recipient_id' = v_owner::text))));

  -- 5. BUSINESS_OFFER_SENT: A (the requester) gets the reply push worded by _business_reply_push
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := submit_business_offer(request_id_param := v_req, offer_type_param := 'standard',
     offer_description_param := 'We can accommodate this as requested.', offer_price_param := 12.5);
  select p.title, p.body into v_title, v_body from _business_reply_push(v_offer) p;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_sent','ok',
    (select count(*) from domain_events where type = 'BUSINESS_OFFER_SENT' and object_id = v_offer) = 1
    and (select count(*) from jq where b->>'recipient_id' = v_a::text and b->'data'->>'type' = 'business_offer_received'
           and b->>'title' = v_title and b->>'body' = v_body and b->'data'->>'offer_id' = v_offer::text) = 1,
    'data', jsonb_build_object('title', v_title, 'body', v_body)));

  -- 6. many screens read the same state: no event, no push
  select count(*) into v_before from domain_events; select count(*) into v_q from jq;
  perform get_business_opportunities(v_partner); perform get_business_opportunities(v_partner);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform * from business_requests where id = v_req;
  perform * from business_request_offers where request_id = v_req;
  perform * from _business_reply_push(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','reads_never_notify','ok',
    (select count(*) from domain_events) = v_before and (select count(*) from jq) = v_q));

  -- 7. BUSINESS_OFFER_ACCEPTED: the business is told, and A gets "Reservation Confirmed"
  v_res := accept_business_offer(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','offer_accepted','ok',
    (select count(*) from domain_events where type = 'BUSINESS_OFFER_ACCEPTED' and object_id = v_offer) = 1
    and (select count(*) from jq where b->>'recipient_id' = v_owner::text and b->'data'->>'type' = 'business_offer_accepted'
           and b->>'title' = 'Your offer was accepted!' and b->>'body' = 'A customer accepted your offer: ' || business_safe_request_summary(v_req)) = 1
    and (select count(*) from jq where b->>'recipient_id' = v_a::text and b->'data'->>'type' = 'business_reservation_confirmed') = 1,
    'data', jsonb_build_object('consumer_title', (select b->>'title' from jq where b->'data'->>'type' = 'business_reservation_confirmed'
                                                    and b->'data'->>'offer_id' = v_offer::text limit 1))));

  -- 7b. idempotency: re-emitting the same accept does nothing
  select count(*) into v_q from jq;
  log := log || jsonb_build_array(jsonb_build_object('step','idempotent','ok',
    _emit_event('BUSINESS_OFFER_ACCEPTED', 'business_request_offer', v_offer, v_a, 'accept_business_offer', '{}'::jsonb,
                'BUSINESS_OFFER_ACCEPTED:' || v_offer) is null
    and (select count(*) from jq) = v_q
    and (select count(*) from domain_events where type = 'BUSINESS_OFFER_ACCEPTED' and object_id = v_offer) = 1));

  -- 8. OFFER_REDEEMED: recorded only
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select count(*) into v_q from jq;
  v_res := complete_business_reservation(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','offer_redeemed','ok',
    (select count(*) from domain_events where type = 'OFFER_REDEEMED' and object_id = v_offer) = 1
    and (select count(*) from jq) = v_q));

  -- 9. privacy: event payloads carry ids and flags only (no text); every push came through a recorded decision
  log := log || jsonb_build_array(jsonb_build_object('step','payload_minimum','ok', true,
    'data', jsonb_build_object(
      'types', (select jsonb_agg(distinct type) from domain_events where id > v_start),
      'keys', (select jsonb_agg(distinct k) from domain_events e, jsonb_object_keys(e.payload) k where e.id > v_start),
      'non_id_values', (select jsonb_agg(v) from domain_events e, jsonb_each(e.payload) kv(k, v) where e.id > v_start
          and not (jsonb_typeof(v) = 'boolean' or v #>> '{}' ~ '^[0-9a-f-]{36}$'
                   or (k in ('invite_type') and v #>> '{}' in ('gathering', 'community')))),
      -- (pushes of types this layer owns; other legacy triggers, e.g. group_intent_signal, are outside item 125's registry)
      'unrecorded_types', (select jsonb_agg(jq.b->'data'->>'type') from jq where jq.b->'data'->>'type' in ('recommended_gathering', 'gathering_invite', 'business_opportunity_received',
          'business_offer_received', 'business_offer_accepted', 'business_reservation_confirmed', 'group_plan_reservation_confirmed') and not exists (
          select 1 from domain_event_notifications n where n.outcome = 'sent' and n.recipient_id::text = jq.b->>'recipient_id'
            and n.notification_type = jq.b->'data'->>'type')),
      'unrecorded_pushes', (select count(*) from jq where jq.b->'data'->>'type' in ('recommended_gathering', 'gathering_invite', 'business_opportunity_received',
          'business_offer_received', 'business_offer_accepted', 'business_reservation_confirmed', 'group_plan_reservation_confirmed') and not exists (
          select 1 from domain_event_notifications n where n.outcome = 'sent' and n.recipient_id::text = jq.b->>'recipient_id'
            and n.notification_type = jq.b->'data'->>'type')))));`);
    s = stepMap(log);
  }, 120000);

  it('GATHERING_CREATED notifies a matching nearby person once, with the unchanged wording', () => {
    expect(s.gathering_created.ok).toBe(true);
    expect(s.gathering_created.data.title).toBe('🎯 This matches you');
    expect(s.gathering_created.data.body).toMatch(/^"Journey coffee" is happening .+ and you like Coffee\.$/);
    expect(s.gathering_created.data.type).toBe('recommended_gathering');
    expect(s.gathering_created.data.logged).toBe(1);
  });
  it('a blocked person gets nothing; an ineligible gathering notifies no one', () => {
    expect(s.gathering_created_blocked.ok).toBe(true);
    expect(s.gathering_created_blocked.data.outcome).toBe('blocked');
    expect(s.gathering_created_no_recipient.ok).toBe(true);
  });
  it('INVITATION_SENT keeps the gathering-invite push, once, and honors the Plans mute', () => {
    expect(s.invitation_sent.ok).toBe(true);
    expect(s.invitation_sent.data.title).toBe(`${s.invitation_sent.data.inviter || 'A friend'} invited you to a gathering`);
    expect(s.invitation_sent.data.body).toBe('Journey coffee — tap to see the details.');
    expect(s.invitation_sent.data.source).toBe('invite_friend_to_gathering');
    expect(s.invitation_sent_muted.ok).toBe(true);
    expect(s.invitation_sent_muted.data.outcome).toBe('muted');
    expect(s.invitation_sent_record_only.ok).toBe(true);
  });
  it('acceptance and expiry are recorded, never pushed', () => {
    expect(s.invitation_accepted_expired.ok).toBe(true);
  });
  it('BUSINESS_REQUEST_SENT: directed push unchanged, business mute honored, one event per business reached', () => {
    expect(s.request_sent_directed.ok).toBe(true);
    expect(s.request_sent_directed.data.title).toBe('A customer asked for your business');
    expect(s.request_sent_directed.data.body).toBe(`New request: ${s.request_sent_directed.data.summary}`);
    expect(s.request_sent_directed.data.type).toBe('business_opportunity_received');
    expect(s.request_sent_directed.data.leaks_raw_text).toBe(false);
    expect(s.request_sent_muted.ok).toBe(true);
    expect(s.request_sent_muted.data.outcome).toBe('muted');
    expect(s.request_sent_fanout.ok).toBe(true);
    // an urgent (today) fan-out that reached the business pings its owner with the fan-out wording
    if (s.request_sent_fanout.data.reached_partner) {
      expect(s.request_sent_fanout.data.owner_titles).toEqual(['New opportunity nearby!']);
    }
  });
  it('BUSINESS_OFFER_SENT tells the customer with the one reply builder', () => {
    expect(s.offer_sent.ok).toBe(true);
    expect(s.offer_sent.data.title).toMatch(/responded$/);
  });
  it('screens reading state never create events or pushes', () => {
    expect(s.reads_never_notify.ok).toBe(true);
  });
  it('BUSINESS_OFFER_ACCEPTED notifies business and customer once; re-emitting is a no-op', () => {
    expect(s.offer_accepted.ok).toBe(true);
    expect(s.offer_accepted.data.consumer_title).toMatch(/Reservation Confirmed!$/);
    expect(s.idempotent.ok).toBe(true);
  });
  it('OFFER_REDEEMED is recorded only', () => {
    expect(s.offer_redeemed.ok).toBe(true);
  });
  it('event payloads are canonical ids only, and every push is a recorded decision', () => {
    const p = s.payload_minimum.data;
    expect(p.non_id_values).toBeNull();
    expect(p.unrecorded_types).toBeNull();
    expect(p.types.slice().sort()).toEqual(DOMAIN_EVENTS.slice().sort());
  });
});
