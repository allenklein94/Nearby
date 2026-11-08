// Account deletion never refused, and never takes other people's plans or the money records with it (migration 20270405). Real group-plan
// and booking functions build the state; deletions run in delete-account's order (profile, then auth user) with every trigger on.
//   1-3. The organizer of a booked group plan leaves: the plan, its request and the booking pass to the earliest to accept, without the person's location or dietary needs.
//   4-5. A participant leaves: their rows go, the plan goes on. A plan that can't go on ends; nobody else's request changes.
//   6-8. A customer leaves: a payment with money behind it stays with no person on it, nobody can read it, a late refund still lands; one with nothing behind it goes.
//   9.   Confirmed redemptions stay for billing without the person; an unconfirmed claim goes.
//   10.  A business owner leaves: the business and its records stay, without their id; a late review doesn't fail.
//   11.  An admin leaves: their pauses stay without their id, and stay lift-only. A live person's id can't be cleared by hand.
//   12.  A winning occasion option stays without its author; their other suggestions go.
//   13.  Nothing left in the graph can refuse a deletion (the sweep tries every one for real: scripts/replay/account-deletion-sweep.js).
// Not covered here: the real function, Auth and Storage (held-evidence-function-local.js section F), races (account-deletion-concurrency.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const as = (u) => `perform set_config('request.jwt.claims', json_build_object('sub', ${u}, 'role', 'authenticated')::text, true);`;
const del = (v) => `perform set_config('request.jwt.claims', '', true); delete from profiles where id = ${v}; delete from auth.users where id = ${v};`;
const rec = (step, ok, data = 'null::text') => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', coalesce(${ok}, false), 'data', to_jsonb(${data})));`;
const ask = (u, into) => `${as(u)} v_res := create_business_request('journey del', 40.1, -75.1, 'Coffee', 1, null, 40, null, null, null, 15, null); ${into} := (v_res->>'requestId')::uuid;`;

const PEOPLE = ['v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_g', 'v_h', 'v_i', 'v_j', 'v_k', 'v_cu', 'v_cv', 'v_owner', 'v_admin', 'v_held'];

d('journey: account deletion (20270405)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares([...PEOPLE, 'v_partner'])}
      v_owner2 uuid;
      v_res jsonb; v_msg text; v_n int; v_m int; v_ok boolean; v_t text; v_id uuid; v_plan uuid;
      v_ra uuid; v_rb uuid; v_rc uuid; v_p uuid; v_req uuid; v_offer uuid; v_reserv uuid;
      v_p2 uuid; v_re uuid; v_rf uuid; v_p3 uuid; v_rg uuid; v_rh uuid; v_rg_new uuid;
      v_q uuid; v_q2 uuid; v_o uuid; v_o2 uuid; v_pay uuid; v_pay2 uuid; v_res1 uuid;
      v_bo uuid; v_red1 uuid; v_red2 uuid; v_sub uuid; v_scr uuid; v_note uuid; v_bpr uuid;
      v_rest uuid; v_ogp uuid; v_win uuid; v_lose uuid; v_row jsonb;`, `
  ${actorsSql({ people: PEOPLE, friends: [['v_a', 'v_b'], ['v_a', 'v_c'], ['v_d', 'v_e'], ['v_d', 'v_f'], ['v_g', 'v_h']], business: { owner: 'v_owner', partner: 'v_partner' } })}
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  update profiles set intent_visibility = 'friends' where id in (v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h);

  -- a booked group plan: a organizes, b accepts first, c second; a's request carries a's location and a dietary need
  ${ask('v_a', 'v_ra')} ${ask('v_b', 'v_rb')} ${ask('v_c', 'v_rc')}
  update business_requests set dietary = '{halal}', latitude = 41.5, longitude = -74.5 where id = v_ra;
  update business_requests set dietary = '{vegan}', latitude = 40.2, longitude = -75.2 where id = v_rb;
  ${as('v_a')} v_p := propose_group_plan(v_ra, array[v_rb, v_rc]); perform set_group_plan_budget(v_p, 40);
  ${as('v_b')} perform respond_to_group_plan(v_p, true);
  update group_plan_participants set responded_at = now() - interval '2 hours' where proposal_id = v_p and user_id = v_b;
  ${as('v_c')} perform respond_to_group_plan(v_p, true);
  ${as('v_a')} perform confirm_group_plan(v_p);
  select resulting_request_id into v_req from group_plan_proposals where id = v_p;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_req, v_partner, 'offered', 'standard', 'We can do this.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', offer_description = 'We can do this.', valid_until = null
    returning id into v_offer;
  ${as('v_a')} perform confirm_group_plan_offer(v_p, v_offer);
  ${as('v_b')} perform confirm_group_plan_offer(v_p, v_offer);
  ${as('v_c')} perform confirm_group_plan_offer(v_p, v_offer);
  select id into v_reserv from business_reservations where offer_id = v_offer;
  insert into plans (plan_type, created_by, resulting_business_request_id) values ('business_request', v_a, v_req) returning id into v_plan;
  ${rec('fixture_booked', "v_reserv is not null and (select status from business_request_offers where id = v_offer) = 'accepted'")}

  delete from push_outbox where recipient_id in (v_b, v_c);
  ${del('v_a')}
  ${rec('organizer_passes_plan', `(select initiator_id from group_plan_proposals where id = v_p) = v_b
      and (select requester_id from business_requests where id = v_req) = v_b
      and (select created_by from plans where id = v_plan) = v_b
      and not exists (select 1 from group_plan_participants where user_id = v_a)
      and not exists (select 1 from group_plan_offer_confirmations where user_id = v_a)
      and not exists (select 1 from business_requests where id = v_ra)
      and exists (select 1 from group_plan_participants where proposal_id = v_p and user_id = v_c and status = 'accepted')`,
    `(select jsonb_build_object('initiator', initiator_id = v_b, 'status', status) from group_plan_proposals where id = v_p)`)}
  ${rec('booking_survives', `(select status from business_request_offers where id = v_offer) = 'accepted'
      and (select status from business_reservations where id = v_reserv) = 'confirmed'`)}
  ${rec('person_removed_from_request', `(select latitude = 40.2 and longitude = -75.2 from business_requests where id = v_req)
      and (select dietary = '{vegan}' from business_requests where id = v_req)`,
    `(select jsonb_build_object('lat', latitude, 'dietary', dietary) from business_requests where id = v_req)`)}
  ${rec('new_organizer_told_once', `(select count(*) from push_outbox where recipient_id = v_b and data->>'type' = 'group_plan_confirmed' and data->>'proposal_id' = v_p::text) = 1
      and not exists (select 1 from push_outbox where recipient_id = v_c and data->>'proposal_id' = v_p::text)`)}
  ${as('v_b')} v_res := complete_business_reservation(v_offer);
  ${rec('new_organizer_can_act', `(v_res->>'success')::boolean`, 'v_res')}

  -- a participant leaves: the plan goes on
  ${del('v_c')}
  ${rec('participant_leaves', `not exists (select 1 from group_plan_participants where user_id = v_c)
      and not exists (select 1 from group_plan_offer_confirmations where user_id = v_c)
      and not exists (select 1 from business_requests where id = v_rc)
      and (select initiator_id from group_plan_proposals where id = v_p) = v_b
      and (select status from business_request_offers where id = v_offer) = 'completed'`)}

  -- a pending plan's organizer leaves: it ends; the others' own requests are as they were
  ${ask('v_d', 'v_id')} ${ask('v_e', 'v_re')} ${ask('v_f', 'v_rf')}
  ${as('v_d')} v_p2 := propose_group_plan(v_id, array[v_re, v_rf]);
  ${as('v_e')} perform respond_to_group_plan(v_p2, true);
  ${del('v_d')}
  ${rec('pending_plan_ends', `not exists (select 1 from group_plan_proposals where id = v_p2)
      and not exists (select 1 from group_plan_participants where proposal_id = v_p2)
      and (select status from business_requests where id = v_re) = 'open'
      and (select status from business_requests where id = v_rf) = 'open'
      and exists (select 1 from cancellation_events where entity_type = 'group_plan' and entity_id = v_p2 and cancelled_by is null)`)}

  -- a confirmed plan everyone else left: nothing to pass on; the person who left keeps their own request
  ${ask('v_g', 'v_rg')} ${ask('v_h', 'v_rh')}
  ${as('v_g')} v_p3 := propose_group_plan(v_rg, array[v_rh]); perform set_group_plan_budget(v_p3, 40);
  ${as('v_h')} perform respond_to_group_plan(v_p3, true);
  ${as('v_g')} perform confirm_group_plan(v_p3);
  ${as('v_h')} perform leave_group_plan(v_p3);
  select resulting_request_id into v_rg_new from group_plan_proposals where id = v_p3;
  ${del('v_g')}
  ${rec('confirmed_alone_ends', `not exists (select 1 from group_plan_proposals where id = v_p3)
      and not exists (select 1 from business_requests where id = v_rg_new)
      and exists (select 1 from business_requests where id = v_rh and superseded_by_group_plan_id is null)`)}

  -- a customer's payments
  ${as('v_i')} v_res := create_business_request('journey pay', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_q := (v_res->>'requestId')::uuid;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description) values (v_q, v_partner, 'offered', 'standard', 'Yes')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', offer_description = 'Yes', valid_until = null returning id into v_o;
  v_res := accept_business_offer(v_o);
  select p.id, p.reservation_id into v_pay, v_res1 from business_payments p join business_reservations r on r.id = p.reservation_id where r.offer_id = v_o;
  ${rec('payment_knows_its_business', `(select partner_id from business_payments where id = v_pay) = v_partner`)}
  update business_payments set status = 'captured', amount = 42.50, stripe_payment_intent_id = 'pi_journey_del', stripe_charge_id = 'ch_journey_del', application_fee_amount = 2.5, failure_reason = 'A previous attempt mentioned someone' where id = v_pay;
  ${as('v_j')} v_res := create_business_request('journey pay 2', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_q2 := (v_res->>'requestId')::uuid;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description) values (v_q2, v_partner, 'offered', 'standard', 'Yes')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', offer_description = 'Yes', valid_until = null returning id into v_o2;
  v_res := accept_business_offer(v_o2);
  select p.id into v_pay2 from business_payments p join business_reservations r on r.id = p.reservation_id where r.offer_id = v_o2;
  update business_payments set status = 'not_required' where id = v_pay2;
  ${del('v_i')} ${del('v_j')}
  ${rec('money_outlives_the_person', `not exists (select 1 from business_requests where id = v_q)
      and (select reservation_id is null and payer_id is null and failure_reason is null and detached_at is not null and partner_id = v_partner
             and amount = 42.50 and status = 'captured' and stripe_payment_intent_id = 'pi_journey_del' and stripe_charge_id = 'ch_journey_del' and application_fee_amount = 2.5
           from business_payments where id = v_pay)`,
    `(select to_jsonb(p) from business_payments p where id = v_pay)`)}
  ${rec('no_money_no_row', `not exists (select 1 from business_payments where id = v_pay2) and not exists (select 1 from business_requests where id = v_q2)`)}
  ${as('v_owner')} set local role authenticated;
  select count(*) into v_n from business_payments where id = v_pay;
  reset role;
  ${as('v_b')} set local role authenticated;
  select count(*) into v_m from business_payments where id = v_pay;
  reset role; perform set_config('request.jwt.claims', '', true);
  ${rec('nobody_reads_it', 'v_n = 0 and v_m = 0', `jsonb_build_object('owner', v_n, 'other', v_m)`)}
  update business_payments set status = 'refunded' where stripe_payment_intent_id = 'pi_journey_del';
  ${rec('late_refund_lands', `(select status from business_payments where id = v_pay) = 'refunded'`)}

  -- redemptions
  insert into brand_offers (partner_id, title, reward_type) values (v_partner, 'Free coffee', 'free_item') returning id into v_bo;
  insert into offer_redemptions (offer_id, user_id, confirmed_at, confirmed_by) values (v_bo, v_k, now(), v_owner) returning id into v_red1;
  update offer_redemptions set confirmation_code = '111111' where id = v_red1;
  select count(*) into v_n from offer_redemptions where offer_id = v_bo;
  insert into brand_offers (partner_id, title, reward_type) values (v_partner, 'Second coffee', 'free_item') returning id into v_id;
  insert into offer_redemptions (offer_id, user_id) values (v_id, v_k) returning id into v_red2;
  ${del('v_k')}
  ${rec('confirmed_redemption_stays', `(select user_id is null and confirmed_at is not null from offer_redemptions where id = v_red1) and not exists (select 1 from offer_redemptions where id = v_red2)`)}

  -- a business owner leaves
  insert into business_content_screening_results (partner_id, target_type, submitted_by, reviewed_by, content_snapshot, risk_tier)
    values (v_partner, 'offer', v_owner, v_admin, '{}', 'low') returning id into v_scr;
  ${as('v_cu')} v_res := create_business_request('journey sub', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_q := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', '', true);
  insert into business_offer_submissions (partner_id, request_id, submitted_by, payload, status, screening_id) values (v_partner, v_q, v_owner, '{}', 'in_review', v_scr) returning id into v_sub;
  insert into business_customer_notes (partner_id, customer_user_id, note, updated_by) values (v_partner, v_cv, 'Likes the window seat', v_owner) returning id into v_note;
  ${del('v_owner')}
  ${rec('business_records_stay', `exists (select 1 from brand_partners where id = v_partner)
      and (select submitted_by is null and reviewed_by = v_admin from business_content_screening_results where id = v_scr)
      and (select submitted_by is null from business_offer_submissions where id = v_sub)
      and (select updated_by is null from business_customer_notes where id = v_note)`)}
  update business_offer_submissions set status = 'needs_changes' where id = v_sub;
  ${rec('late_review_no_failure', `(select status from business_offer_submissions where id = v_sub) = 'needs_changes'`)}

  -- an admin leaves
  insert into private.account_restrictions (user_id, capability, reason, admin_id, starts_at, expires_at)
    values (v_held, 'messages', 'Repeated unwanted messages', v_admin, now(), now() + interval '7 days') returning id into v_rest;
  begin update private.account_restrictions set admin_id = null where id = v_rest; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  ${rec('live_admin_id_cant_be_cleared', `v_msg like '%can only be lifted%'`, 'v_msg')}
  ${del('v_admin')}
  ${rec('admin_leaves_pause_stays', `(select admin_id is null and lifted_at is null and reason = 'Repeated unwanted messages' from private.account_restrictions where id = v_rest)
      and (select reviewed_by is null from business_content_screening_results where id = v_scr)`)}
  begin update private.account_restrictions set reason = 'Someone rewrote the reason' where id = v_rest; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  ${rec('pause_still_lift_only', `v_msg like '%can only be lifted%'`, 'v_msg')}
  update private.account_restrictions set lifted_at = now(), lift_reason = 'The review is finished now' where id = v_rest;
  ${rec('pause_still_lifts', `(select lifted_at is not null from private.account_restrictions where id = v_rest)`)}

  -- a suggestion the group chose
  insert into occasion_group_plans (host_id, occasion_type, title, status) values (v_cu, 'birthday', 'Birthday', 'decided') returning id into v_ogp;
  insert into occasion_group_plan_options (group_plan_id, activity_type, proposed_by) values (v_ogp, 'dinner', v_cv) returning id into v_win;
  insert into occasion_group_plan_options (group_plan_id, activity_type, proposed_by) values (v_ogp, 'party', v_cv) returning id into v_lose;
  update occasion_group_plans set winning_option_id = v_win where id = v_ogp;
  ${del('v_cv')}
  ${rec('winning_option_stays', `(select winning_option_id from occasion_group_plans where id = v_ogp) = v_win
      and (select proposed_by is null from occasion_group_plan_options where id = v_win)
      and not exists (select 1 from occasion_group_plan_options where id = v_lose)`)}

  -- nothing left in the graph refuses
  with recursive cl as (
    select 'auth.users'::regclass::oid t
    union select c.conrelid from pg_constraint c join cl on c.confrelid = cl.t where c.contype = 'f' and c.confdeltype = 'c'
  )
  select coalesce(jsonb_agg(c.conrelid::regclass::text || '.' || c.conname), '[]') into v_row
    from pg_constraint c join cl on c.confrelid = cl.t
    where c.contype = 'f' and c.confdeltype in ('a', 'r') and c.conrelid <> 'storage.buckets'::regclass;
  ${rec('no_refusing_keys_left', `v_row = '[]'::jsonb`, 'v_row')}
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'fixture_booked', 'organizer_passes_plan', 'booking_survives', 'person_removed_from_request', 'new_organizer_told_once', 'new_organizer_can_act',
    'participant_leaves', 'pending_plan_ends', 'confirmed_alone_ends', 'payment_knows_its_business', 'money_outlives_the_person', 'no_money_no_row',
    'nobody_reads_it', 'late_refund_lands', 'confirmed_redemption_stays', 'business_records_stay', 'late_review_no_failure',
    'live_admin_id_cant_be_cleared', 'admin_leaves_pause_stays', 'pause_still_lift_only', 'pause_still_lifts', 'winning_option_stays', 'no_refusing_keys_left',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    if (!s[n].ok) throw new Error(`${n}: ${JSON.stringify(s[n].data)}`);
  });
});
