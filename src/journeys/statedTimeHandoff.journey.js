// Journey (owner idea "305", 2026-10-20): what the words state is carried, never re-asked or invented. "Dinner at Coastal Coffee
// at 7 for four" -> "Ask Nearby Businesses" -> the request carries Restaurants, 4 people and 7 PM; only the missing day is asked
// (the person picks tomorrow); Send stores time_window_start 19:00; a business's hand-written reply then meets that stated
// time (item 63's "Fits" reason). The client half uses the real handoff (askBusinessParamsFromAsk), the screen's own start
// value (startTimeFromMinutes -> toTimeParam) and Send's missing-field rule; the database half is the real
// create_business_request + submit_business_offer. One rolled-back transaction; pushes stay in the outbox.
// Not covered (device only): the Time chip reading "🕐 7:00 PM" on a phone and the "Fits" line on the request screen
// (item 84 checklist + offer experience checklist). "Coastal Coffee" is not recognised as a business (deferred, idea "305").
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: () => {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { askBusinessParamsFromAsk } from '../services/askToBusiness';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { askMissingFields } from '../utils/askMissing';
import { startTimeFromMinutes, toTimeParam } from '../utils/requestTime';
import { replyMeetsRequest } from '../utils/replyFit';

const d = hasToken ? describe : describe.skip;
const TEXT = 'Dinner at Coastal Coffee at 7 for four';

d('journey: a stated time carries into the business request (idea 305)', () => {
  let p;
  let s;
  beforeAll(async () => {
    p = askBusinessParamsFromAsk({ classifyResult: toClassification(resolveAsk(TEXT, null)), typedText: TEXT, submissionId: null });
    const time = toTimeParam(startTimeFromMinutes(p.prefillStartMinutes));
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o uuid := gen_random_uuid(); v_p uuid := gen_random_uuid(); v_res jsonb; v_req uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox, never handed to send-push
  perform set_config('app.trusted_update', 'on', true);
  insert into auth.users (id, aud, role, email) values (v_c, 'authenticated', 'authenticated', v_c || '@j305.test'), (v_o, 'authenticated', 'authenticated', v_o || '@j305.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (v_c, v_o);
  insert into profiles (id, display_name, birthdate) values (v_c, 'J305 Customer', date '1990-01-01'), (v_o, 'J305 Owner', date '1990-01-01');
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'J305 Bistro', true, 0.73, 0.73, ${sqlText(p.prefillCategory)});
  update profiles set managed_partner_id = v_p where id = v_o;

  -- the customer sends the form as the screen built it: carried category/party/time + the day they picked (tomorrow)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := ${sqlText(TEXT)}, latitude_param := 0.73, longitude_param := 0.73,
     category_param := ${sqlText(p.prefillCategory)}, party_size_param := ${Number(p.prefillPartySize)}, date_param := current_date + 1,
     time_window_start_param := ${time ? `${sqlText(time)}::time` : 'null'}, radius_miles_param := 10);
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','sent','ok', v_req is not null, 'data', (select jsonb_build_object(
     'date', to_char(date, 'YYYY-MM-DD'), 'time_window_start', to_char(time_window_start, 'HH24:MI'), 'party_size', party_size,
     'category', category, 'reached', (v_res->>'notifiedCount')::int) from business_requests where id = v_req)));

  -- the business replies by hand ("as requested")
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  v_res := submit_business_offer(request_id_param := v_req, offer_type_param := 'standard', offer_description_param := 'A table for four at 7.');
  log := log || jsonb_build_array(jsonb_build_object('step','replied','ok', coalesce((v_res->>'success')::boolean, false), 'data', (select to_jsonb(x) from (
     select status, offer_type, availability_id, package_id, auto_reply, available_from, available_until from business_request_offers where request_id = v_req and partner_id = v_p) x)));
`);
    s = stepMap(log);
  }, 60000);

  test('the handoff carries 7 PM and four people; the day is the one thing asked', () => {
    expect(p).toMatchObject({ prefillCategory: 'Restaurants', prefillPartySize: 4, prefillStartMinutes: 19 * 60, prefillDateWindow: null });
    expect(askMissingFields({ text: p.prefillText, category: p.prefillCategory, partySize: '4', dateWindow: null }).map((m) => m.key)).toEqual(['day']);
    expect(askMissingFields({ text: p.prefillText, category: p.prefillCategory, partySize: '4', dateWindow: 'tomorrow' })).toEqual([]);
  });

  test('Send stores the stated time with the request', () => {
    expect(s.sent.ok).toBe(true);
    expect(s.sent.data).toMatchObject({ time_window_start: '19:00', party_size: 4, category: 'Restaurants', reached: 1 });
  });

  test('a hand-written reply meets the stored time: the "Fits" reason carries 7 PM', () => {
    expect(s.replied.ok).toBe(true);
    const fit = replyMeetsRequest({ date: s.sent.data.date, time_window_start: s.sent.data.time_window_start }, s.replied.data);
    expect(fit.qualifies).toBe(true);
    expect(fit.reasons).toEqual([{ kind: 'time', date: s.sent.data.date, startMin: 19 * 60 }]);
  });
});

function sqlText(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}
