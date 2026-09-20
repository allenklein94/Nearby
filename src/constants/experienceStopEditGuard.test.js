const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270131_experience_reorder_remove_stops.sql'), 'utf8');

test('remove cancels only through the existing cancellation RPCs, never a new system', () => {
  expect(sql).toMatch(/perform public\.cancel_business_request\(/);
  expect(sql).toMatch(/perform public\.cancel_business_reservation\(/);
  expect(sql).not.toMatch(/insert into cancellation_events/);
  expect(sql).not.toMatch(/net\.http_post/);
});
test('the child plan is detached before the cancel so it cannot cascade to the parent night', () => {
  expect(sql.indexOf('set parent_plan_id = null')).toBeGreaterThan(-1);
  expect(sql.indexOf('set parent_plan_id = null')).toBeLessThan(sql.indexOf('perform public.cancel_business_request('));
});
test('owner-only, idempotent, refuses completed stops and below two', () => {
  expect(sql).toMatch(/created_by = v_uid and plan_type = 'experience'/);
  expect(sql).toMatch(/'removed', false/);
  expect(sql).toMatch(/already done and stays in your night/);
  expect(sql).toMatch(/at least two stops/);
});
test('a business never sees "stop removed" as a reason (multi-part night stays private)', () => {
  expect(sql).toMatch(/when ce\.reason_code = 'stop_removed' then 'changed_plans'/);
});
