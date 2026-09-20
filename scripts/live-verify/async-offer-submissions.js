#!/usr/bin/env node
// Item 83: async offer screening progress. Owner-only read, stalled/held folding, one active submission per request, dismiss rules. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/async-offer-submissions.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}'; v_other uuid := '${other.id}'; v_partner uuid := '${owner.managed_partner_id}';
  v_req uuid; v_sub uuid; v_sub2 uuid; v_scr uuid; v_out jsonb := '{}'::jsonb; v_rows int; v_status text; v_retry boolean; v_reason text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select id into v_req from business_requests limit 1;
  if v_req is null then
    insert into business_requests (requester_id, raw_text, category, party_size, status, expires_at) values (v_other, 'lv', 'Coffee', 2, 'open', now() + interval '2 days') returning id into v_req;
  end if;
  insert into business_offer_submissions (partner_id, request_id, submitted_by, payload) values (v_partner, v_req, v_owner, '{"offerDescription":"lv"}') returning id into v_sub;
  -- a stranger cannot read or dismiss
  begin perform 1 from get_my_offer_submissions(v_partner); v_out := v_out || jsonb_build_object('stranger_read','allowed'); exception when others then v_out := v_out || jsonb_build_object('stranger_read','refused'); end;
  begin perform dismiss_offer_submission(v_sub); v_out := v_out || jsonb_build_object('stranger_dismiss','allowed'); exception when others then v_out := v_out || jsonb_build_object('stranger_dismiss','refused'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select status, retryable into v_status, v_retry from get_my_offer_submissions(v_partner) where id = v_sub;
  v_out := v_out || jsonb_build_object('fresh_status', v_status, 'fresh_retryable', v_retry);
  begin perform dismiss_offer_submission(v_sub); v_out := v_out || jsonb_build_object('dismiss_reviewing','allowed'); exception when others then v_out := v_out || jsonb_build_object('dismiss_reviewing','refused'); end;
  -- one active per request
  begin insert into business_offer_submissions (partner_id, request_id, submitted_by, payload) values (v_partner, v_req, v_owner, '{}'); v_out := v_out || jsonb_build_object('second_active','allowed');
  exception when unique_violation then v_out := v_out || jsonb_build_object('second_active','refused'); end;
  -- stalled reviewing reads as unavailable + retryable
  update business_offer_submissions set updated_at = now() - interval '10 minutes' where id = v_sub;
  select status, retryable into v_status, v_retry from get_my_offer_submissions(v_partner) where id = v_sub;
  v_out := v_out || jsonb_build_object('stalled_status', v_status, 'stalled_retryable', v_retry);
  begin perform dismiss_offer_submission(v_sub); v_out := v_out || jsonb_build_object('dismiss_stalled','allowed'); exception when others then v_out := v_out || jsonb_build_object('dismiss_stalled','refused'); end;
  -- after dismiss a new submission for the same request is allowed and the old one is hidden
  insert into business_offer_submissions (partner_id, request_id, submitted_by, payload, status) values (v_partner, v_req, v_owner, '{}', 'in_review') returning id into v_sub2;
  select count(*) into v_rows from get_my_offer_submissions(v_partner) where id = v_sub;
  v_out := v_out || jsonb_build_object('dismissed_hidden', v_rows = 0);
  -- held row folds in the human decision
  insert into business_content_screening_results (partner_id, target_type, content_snapshot, risk_tier, matched_categories, model_reasoning)
    values (v_partner, 'offer_response', '{}', 'medium', '{}', 'lv') returning id into v_scr;
  update business_offer_submissions set screening_id = v_scr where id = v_sub2;
  select status into v_status from get_my_offer_submissions(v_partner) where id = v_sub2;
  v_out := v_out || jsonb_build_object('held_pending', v_status);
  begin perform dismiss_offer_submission(v_sub2); v_out := v_out || jsonb_build_object('dismiss_held','allowed'); exception when others then v_out := v_out || jsonb_build_object('dismiss_held','refused'); end;
  update business_content_screening_results set review_outcome = 'approved', reviewed_at = now() where id = v_scr;
  select status into v_status from get_my_offer_submissions(v_partner) where id = v_sub2;
  v_out := v_out || jsonb_build_object('held_approved', v_status);
  update business_content_screening_results set review_outcome = 'denied' where id = v_scr;
  select status, reason into v_status, v_reason from get_my_offer_submissions(v_partner) where id = v_sub2;
  v_out := v_out || jsonb_build_object('held_denied', v_status, 'held_denied_reason', v_reason is not null);
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(r.stranger_read === 'refused' && r.stranger_dismiss === 'refused', 'a non-owner can neither read nor dismiss');
  assert(r.fresh_status === 'reviewing' && r.fresh_retryable === false, 'a fresh submission is reviewing and not retryable');
  assert(r.dismiss_reviewing === 'refused', 'cannot dismiss while being reviewed');
  assert(r.second_active === 'refused', 'one active submission per request');
  assert(r.stalled_status === 'unavailable' && r.stalled_retryable === true, 'a stalled review is retryable');
  assert(r.dismiss_stalled === 'allowed' && r.dismissed_hidden === true, 'a stalled one can be discarded and disappears');
  assert(r.held_pending === 'in_review' && r.dismiss_held === 'refused', 'a held offer waits for the team');
  assert(r.held_approved === 'published', 'approval by the team reads as sent');
  assert(r.held_denied === 'needs_changes' && r.held_denied_reason === true, 'denial reads as needs changes with a reason');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });
