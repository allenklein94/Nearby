// Guard for migration 20270120: every path that frees a slot goes through the ONE promotion helper, and the helper uses
// the same "needs approval" predicate as join_gathering (non-public OR requires_approval). Behavior itself is proven
// live by scripts/live-verify/waitlist-promotion-approval.js (SQL cannot run under Jest).
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270120_waitlist_promotion_respects_approval.sql'), 'utf8');
const fn = (name) => sql.slice(sql.indexOf(`function public.${name}(`), sql.indexOf('$fn$;', sql.indexOf(`function public.${name}(`)) + 5);

describe('waitlist promotion respects approval', () => {
  test('leave and host removal both delegate to the one helper', () => {
    expect(sql.match(/_promote_from_waitlist\(/g).length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/v_my_status in \('approved', 'pending'\)/);
    expect(sql).toMatch(/v_row\.status in \('approved', 'pending'\)/);
  });
  test('helper promotes to pending when approval is needed and to approved otherwise', () => {
    const helper = fn('_promote_from_waitlist');
    expect(helper).toMatch(/not coalesce\(is_public, true\)\) or coalesce\(requires_approval, false\)/);
    expect(helper).toMatch(/set status = 'pending'/);
    expect(helper).toMatch(/set status = 'approved'/);
    expect(helper).toMatch(/order by created_at asc/);
  });
  test('a pending person holds the freed slot for approval-required gatherings only', () => {
    expect(fn('_promote_from_waitlist')).toMatch(/v_needs_approval and v_approved \+ v_pending >= v_capacity/);
  });
});
