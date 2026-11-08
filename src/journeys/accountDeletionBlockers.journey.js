// Account deletion never refused, and never takes other people's plans or the money records with it (migration 20270405). Real group-plan
// and booking functions build the state; deletions run in delete-account's order (profile, then auth user) with every trigger on.
//   1-3. The organizer of a booked group plan leaves (owner, Option 1): a paid booking refuses the whole deletion, changing nothing; once resolved the plan ends through the
//        reservation cancellation, nobody is handed the role or a payment, the business and everyone in it are told, and each person's own request comes back.
//   4-5. A participant leaves: their rows go, the plan goes on. A plan already over ends quietly: no push, no request reopened.
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

const PEOPLE = ['v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_g', 'v_h', 'v_i', 'v_j', 'v_k', 'v_l', 'v_q3', 'v_o3', 'v_cu', 'v_cv', 'v_owner', 'v_admin', 'v_held'];

d('journey: account deletion (20270405)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares([...PEOPLE, 'v_partner'])}
      v_owner2 uuid;
      v_res jsonb; v_msg text; v_n int; v_m int; v_ok boolean; v_t text; v_id uuid; v_plan uuid;
      v_hint text; v_rl uuid; v_rm uuid; v_rn uuid; v_p4 uuid; v_req4 uuid; v_offer4 uuid; v_pay4 uuid;
      v_ra uuid; v_rb uuid; v_rc uuid; v_p uuid; v_req uuid; v_offer uuid; v_reserv uuid;
      v_p2 uuid; v_re uuid; v_rf uuid; v_p3 uuid; v_rg uuid; v_rh uuid; v_rg_new uuid;
      v_q uuid; v_q2 uuid; v_o uuid; v_o2 uuid; v_pay uuid; v_pay2 uuid; v_res1 uuid;
      v_bo uuid; v_red1 uuid; v_red2 uuid; v_sub uuid; v_scr uuid; v_note uuid; v_bpr uuid;
      v_rest uuid; v_ogp uuid; v_win uuid; v_lose uuid; v_row jsonb;`, `
  ${actorsSql({ people: PEOPLE, friends: [['v_a', 'v_b'], ['v_a', 'v_c'], ['v_d', 'v_e'], ['v_d', 'v_f'], ['v_g', 'v_h'], ['v_l', 'v_q3'], ['v_l', 'v_o3']], business: { owner: 'v_owner', partner: 'v_partner' } })}
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  update profiles set intent_visibility = 'friends' where id in (v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h, v_l, v_q3, v_o3);

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

  -- the booking is paid: the same refusal as a customer cancelling. Nothing changes and the answer says why.
  -- a group booking makes no payment row today (only a solo accept does; an add-on on the plan can), so the row is made here
  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider, stripe_payment_intent_id, stripe_charge_id)
    values (v_reserv, 'captured', 25, 'usd', v_a, 'stripe', 'pi_journey_group', 'ch_journey_group') returning id into v_pay;
  ${as('v_a')} v_res := account_deletion_plan_impact();
  ${rec('preview_says_unresolved', `(v_res->>'plans')::int = 1 and (v_res->>'bookings')::int = 1 and (v_res->>'unresolved')::int = 1`, 'v_res')}
  delete from push_outbox where recipient_id in (v_b, v_c, v_owner);
  v_hint := null;
  begin
    ${del('v_a')}
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  ${rec('preview_matches_refusal', `v_hint = 'group_plan_booking_unresolved'`, 'v_hint')}
  ${rec('paid_refusal_changes_nothing', `exists (select 1 from profiles where id = v_a)
      and (select initiator_id from group_plan_proposals where id = v_p) = v_a
      and (select status from business_request_offers where id = v_offer) = 'accepted'
      and (select status from business_reservations where id = v_reserv) = 'confirmed'
      and (select status from business_payments where id = v_pay) = 'captured'
      and (select status from business_requests where id = v_rb) = 'merged'
      and not exists (select 1 from push_outbox where recipient_id in (v_b, v_c, v_owner))`)}
  update business_payments set status = 'authorized' where id = v_pay;
  v_hint := null;
  begin
    ${del('v_a')}
  exception when others then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  ${rec('authorized_also_refused', `v_hint = 'group_plan_booking_unresolved' and exists (select 1 from profiles where id = v_a)`, 'v_hint')}

  -- the business refunds it (the webhook sets this): now it can go. c has muted planning pushes and their request's time has passed.
  update business_payments set status = 'refunded' where id = v_pay;
  ${as('v_a')} v_res := account_deletion_plan_impact();
  ${rec('preview_after_refund', `(v_res->>'plans')::int = 1 and (v_res->>'unresolved')::int = 0`, 'v_res')}
  ${as('v_b')} v_res := account_deletion_plan_impact();
  ${rec('preview_is_own_plans_only', `(v_res->>'plans')::int = 0`, 'v_res')}
  update profiles set notify_planning = false where id = v_c;
  update business_requests set expires_at = now() - interval '1 hour' where id = v_rc;
  ${del('v_a')}
  ${rec('organizer_ends_plan', `not exists (select 1 from group_plan_proposals where id = v_p)
      and not exists (select 1 from business_requests where id = v_req)
      and not exists (select 1 from group_plan_participants where user_id = v_a)
      and not exists (select 1 from group_plan_offer_confirmations where user_id = v_a)
      and not exists (select 1 from business_requests where id = v_ra)
      and not exists (select 1 from plans where id = v_plan)`)}
  ${rec('nobody_handed_the_role', `not exists (select 1 from push_outbox where title = 'You''re now organizing this group plan')
      and not exists (select 1 from business_requests where requester_id in (v_b, v_c) and id = v_req)`)}
  ${rec('booking_cancelled_through_the_rules', `exists (select 1 from cancellation_events where entity_type = 'business_reservation' and entity_id = v_offer and partner_id = v_partner and actor_role = 'requester')
      and exists (select 1 from cancellation_events where entity_type = 'group_plan' and entity_id = v_p)`)}
  ${rec('business_told', `(select count(*) from push_outbox where recipient_id = v_owner and data->>'type' = 'reservation_cancelled_by_customer' and data->>'offer_id' = v_offer::text) = 1`)}
  ${rec('business_push_is_safe', `not exists (select 1 from push_outbox where recipient_id = v_owner and data->>'offer_id' = v_offer::text and (body ilike '%journey del%' or data ? 'proposal_id'))`)}
  ${rec('participant_told_opens_own_request', `(select count(*) from push_outbox where recipient_id = v_b and data->>'type' = 'plan_cancelled' and data->>'request_id' = v_rb::text and body like '%booking was cancelled%') = 1`)}
  ${rec('muted_participant_not_pushed', `not exists (select 1 from push_outbox where recipient_id = v_c and data->>'type' = 'plan_cancelled')`)}
  ${rec('own_request_comes_back', `(select status = 'open' and superseded_by_group_plan_id is null from business_requests where id = v_rb)`,
    `(select jsonb_build_object('status', status) from business_requests where id = v_rb)`)}
  ${rec('past_request_reads_expired', `(select status = 'expired' and superseded_by_group_plan_id is null from business_requests where id = v_rc)`)}
  ${rec('refunded_record_stays_without_the_person', `(select status = 'refunded' and payer_id is null and reservation_id is null from business_payments where id = v_pay)`)}
  ${as('v_b')} v_res := create_business_request('journey del again', 40.1, -75.1, 'Coffee', 1, null, 40, null, null, null, 15, null);
  ${rec('participant_can_ask_again', `(v_res->>'requestId') is not null`, 'v_res')}

  -- a participant leaves: the plan goes on. Then the visit happens and the organizer leaves: a paid, completed booking is not an open obligation.
  ${ask('v_l', 'v_rl')} ${ask('v_q3', 'v_rm')} ${ask('v_o3', 'v_rn')}
  ${as('v_l')} v_p4 := propose_group_plan(v_rl, array[v_rm, v_rn]); perform set_group_plan_budget(v_p4, 40);
  ${as('v_q3')} perform respond_to_group_plan(v_p4, true);
  ${as('v_o3')} perform respond_to_group_plan(v_p4, true);
  ${as('v_l')} perform confirm_group_plan(v_p4);
  select resulting_request_id into v_req4 from group_plan_proposals where id = v_p4;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_req4, v_partner, 'offered', 'standard', 'We can do this.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', offer_description = 'We can do this.', valid_until = null
    returning id into v_offer4;
  ${as('v_l')} perform confirm_group_plan_offer(v_p4, v_offer4);
  ${as('v_q3')} perform confirm_group_plan_offer(v_p4, v_offer4);
  ${as('v_o3')} perform confirm_group_plan_offer(v_p4, v_offer4);
  ${del('v_o3')}
  ${rec('participant_leaves', `not exists (select 1 from group_plan_participants where user_id = v_o3)
      and not exists (select 1 from group_plan_offer_confirmations where user_id = v_o3)
      and not exists (select 1 from business_requests where id = v_rn)
      and (select initiator_id from group_plan_proposals where id = v_p4) = v_l
      and (select status from business_request_offers where id = v_offer4) = 'accepted'`)}
  insert into business_payments (reservation_id, status, amount, currency, payer_id, provider, stripe_payment_intent_id, stripe_charge_id)
    select r.id, 'captured', 25, 'usd', v_l, 'stripe', 'pi_journey_done', 'ch_journey_done' from business_reservations r where r.offer_id = v_offer4 returning id into v_pay4;
  ${as('v_l')} v_res := complete_business_reservation(v_offer4);
  v_res := account_deletion_plan_impact();
  ${rec('completed_plan_needs_no_warning', `(v_res->>'plans')::int = 0 and (v_res->>'unresolved')::int = 0`, 'v_res')}
  delete from push_outbox where recipient_id in (v_q3, v_owner);
  ${del('v_l')}
  ${rec('completed_plan_ends_quietly', `not exists (select 1 from profiles where id = v_l)
      and not exists (select 1 from group_plan_proposals where id = v_p4)
      and not exists (select 1 from push_outbox where recipient_id in (v_q3, v_owner) and data->>'type' in ('plan_cancelled', 'reservation_cancelled_by_customer'))
      and (select status from business_requests where id = v_rm) = 'merged'`)}
  ${rec('completed_paid_record_stays', `(select status = 'captured' and payer_id is null from business_payments where id = v_pay4)`)}

  -- a pending plan's organizer leaves: it ends; the others' own requests are as they were
  ${ask('v_d', 'v_id')} ${ask('v_e', 'v_re')} ${ask('v_f', 'v_rf')}
  ${as('v_d')} v_p2 := propose_group_plan(v_id, array[v_re, v_rf]);
  ${as('v_e')} perform respond_to_group_plan(v_p2, true);
  delete from push_outbox where recipient_id in (v_e, v_f);
  ${del('v_d')}
  ${rec('pending_plan_participants_told', `(select count(*) from push_outbox where recipient_id = v_e and data->>'type' = 'plan_cancelled' and data->>'request_id' = v_re::text and body not like '%booking%') = 1
      and (select count(*) from push_outbox where recipient_id = v_f and data->>'type' = 'plan_cancelled' and data->>'request_id' = v_rf::text) = 1`)}
  ${rec('pending_plan_ends', `not exists (select 1 from group_plan_proposals where id = v_p2)
      and not exists (select 1 from group_plan_participants where proposal_id = v_p2)
      and (select status from business_requests where id = v_re) = 'open'
      and (select status from business_requests where id = v_rf) = 'open'
      and exists (select 1 from cancellation_events where entity_type = 'group_plan' and entity_id = v_p2 and cancelled_by is null)`)}

  -- a confirmed plan everyone else left: it ends; the person who left gets their own request back
  ${ask('v_g', 'v_rg')} ${ask('v_h', 'v_rh')}
  ${as('v_g')} v_p3 := propose_group_plan(v_rg, array[v_rh]); perform set_group_plan_budget(v_p3, 40);
  ${as('v_h')} perform respond_to_group_plan(v_p3, true);
  ${as('v_g')} perform confirm_group_plan(v_p3);
  ${as('v_h')} perform leave_group_plan(v_p3);
  select resulting_request_id into v_rg_new from group_plan_proposals where id = v_p3;
  ${del('v_g')}
  ${rec('confirmed_alone_ends', `not exists (select 1 from group_plan_proposals where id = v_p3)
      and not exists (select 1 from business_requests where id = v_rg_new)
      and (select status = 'open' and superseded_by_group_plan_id is null from business_requests where id = v_rh)`)}

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
    'fixture_booked', 'preview_says_unresolved', 'preview_matches_refusal', 'paid_refusal_changes_nothing', 'authorized_also_refused', 'preview_after_refund', 'preview_is_own_plans_only',
    'organizer_ends_plan', 'nobody_handed_the_role', 'booking_cancelled_through_the_rules', 'business_told', 'business_push_is_safe', 'participant_told_opens_own_request', 'muted_participant_not_pushed',
    'own_request_comes_back', 'past_request_reads_expired', 'refunded_record_stays_without_the_person', 'participant_can_ask_again',
    'participant_leaves', 'completed_plan_needs_no_warning', 'completed_plan_ends_quietly', 'completed_paid_record_stays', 'pending_plan_participants_told', 'pending_plan_ends', 'confirmed_alone_ends', 'payment_knows_its_business', 'money_outlives_the_person', 'no_money_no_row',
    'nobody_reads_it', 'late_refund_lands', 'confirmed_redemption_stays', 'business_records_stay', 'late_review_no_failure',
    'live_admin_id_cant_be_cleared', 'admin_leaves_pause_stays', 'pause_still_lift_only', 'pause_still_lifts', 'winning_option_stays', 'no_refusing_keys_left',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    if (!s[n].ok) throw new Error(`${n}: ${JSON.stringify(s[n].data)}`);
  });
});
