const fs = require('fs');
const path = require('path');
const { toTimeParam, timeLabel } = require('./requestTime');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

test('time param is the picked wall-clock HH:MM, null when none', () => {
  expect(toTimeParam(new Date(2026, 8, 20, 18, 5))).toBe('18:05');
  expect(toTimeParam(null)).toBeNull();
  expect(toTimeParam('junk')).toBeNull();
  expect(timeLabel(null)).toBeNull();
});

test('targeted and broadcast requests share ONE model: same creators, target is only an optional recipient param', () => {
  const sql = read('supabase/migrations/20270137_targeted_business_request.sql');
  expect(sql).toMatch(/target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text/);
  expect(sql).not.toMatch(/create or replace function public\.create_targeted|create_directed_business_request/);
  // no fan-out or other matcher runs for a targeted request; exactly one recipient
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.create_business_request('));
  expect(body).toMatch(/if target_partner_id_param is not null then\s+perform public\._route_request_to_partner/);
  expect(sql).toMatch(/drop function if exists public\.create_business_request\(/);
});
test('the free-text note exists only on a targeted request and reaches only that business', () => {
  const sql = read('supabase/migrations/20270137_targeted_business_request.sql');
  expect(sql).toMatch(/'note', case when bro\.is_directed then br\.note_for_business else null end/);
  expect(sql).toMatch(/_clean_note_for_business/);
  expect(read('src/services/businessFulfillment.js')).toMatch(/note_param: targetPartnerId \? note : null/);
  // never in the summary or a push body
  const lines = sql.split('\n').filter((l) => !l.trim().startsWith('--'));
  expect(lines.filter((l) => /note_for_business/.test(l) && /(summary|'body'|title)/i.test(l))).toEqual([]);
  expect(sql).not.toMatch(/create or replace function public\.business_safe_request_summary/i);
});
test('the specific-business flow reuses AskBusiness instead of a thinner form', () => {
  expect(read('src/screens/RequestBusinessPartnerScreen.js')).toMatch(/navigation\.navigate\('AskBusiness'/);
  expect(read('src/screens/BusinessProfileScreen.js')).toMatch(/targetPartner: \{ id: partnerId/);
  expect(read('src/screens/AskBusinessScreen.js')).toMatch(/Ask \$\{targetPartner\.name\}/);
});
