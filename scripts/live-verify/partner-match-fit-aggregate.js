#!/usr/bin/env node
// get_partner_match_fit: owner-only, returns nothing below demand_min_people() (5) DISTINCT reviewers, percentages only.
// Rolled back; FK/trigger checks are skipped inside the transaction (session_replication_role) so synthetic rows suffice.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/partner-match-fit-aggregate.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('partner-match-fit-aggregate: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [stranger] = await runSql(`select id from profiles where managed_partner_id is null limit 1;`);
  if (!owner || !stranger) throw new Error('Needs a business owner and a non-owner profile.');
  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_out jsonb := '{}'::jsonb;
  v_offer uuid;
  i int;
  r record;
begin
  set local session_replication_role = replica;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  -- 4 distinct people (one of them answers twice): below the floor
  for i in 1..5 loop
    v_offer := gen_random_uuid();
    insert into business_request_offers (id, request_id, partner_id) values (v_offer, gen_random_uuid(), v_partner);
    insert into business_offer_outcomes (offer_id, reviewer_id, satisfaction_rating, would_repeat, match_fit)
    values (v_offer, ('00000000-0000-0000-0000-00000000000' || least(i, 4))::uuid, 'good', 'yes',
            case i when 1 then 'yes' when 2 then 'yes' when 3 then 'somewhat' when 4 then 'no' else 'yes' end);
  end loop;
  select count(*) as n into r from get_partner_match_fit(v_partner);
  v_out := v_out || jsonb_build_object('four_people_rows', r.n);
  -- a 5th distinct person
  v_offer := gen_random_uuid();
  insert into business_request_offers (id, request_id, partner_id) values (v_offer, gen_random_uuid(), v_partner);
  insert into business_offer_outcomes (offer_id, reviewer_id, satisfaction_rating, would_repeat, match_fit)
  values (v_offer, '00000000-0000-0000-0000-000000000009', 'good', 'yes', 'yes');
  select * into r from get_partner_match_fit(v_partner);
  v_out := v_out || jsonb_build_object('five', to_jsonb(r));
  -- a non-owner is refused
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', '${stranger.id}', 'role', 'authenticated')::text, true);
    perform * from get_partner_match_fit(v_partner);
    v_out := v_out || jsonb_build_object('stranger', 'allowed');
  exception when others then
    v_out := v_out || jsonb_build_object('stranger', 'refused');
  end;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let result;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; result = JSON.parse(m[1]); }
  assert(result.four_people_rows === 0, `4 distinct people (5 answers) -> nothing returned (got ${result.four_people_rows})`);
  assert(result.five.people_count === 5, `5 distinct people -> returned (got ${JSON.stringify(result.five)})`);
  assert(Number(result.five.pct_yes) === 67 && Number(result.five.pct_somewhat) === 17 && Number(result.five.pct_no) === 17, `percentages over the 6 answers: 4 yes / 1 somewhat / 1 no (got ${JSON.stringify(result.five)})`);
  assert(result.stranger === 'refused', 'a non-owner is refused');
  const [after] = await runSql(`select count(*) c from business_offer_outcomes where reviewer_id::text like '00000000-0000-0000-0000-00000000000%';`);
  assert(after.c === 0, 'nothing committed');
  summarize('partner-match-fit-aggregate');
}
main().catch((e) => { console.error('partner-match-fit-aggregate: failed to run:', e.message); process.exitCode = 1; });
