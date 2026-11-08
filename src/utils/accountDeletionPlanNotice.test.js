const fs = require('fs');
const path = require('path');
const { deletionPlanNotice, isDeletionPlanRefusal, DELETION_PLAN_HINT } = require('./accountDeletionPlanNotice');
const settings = require('../i18n/ui/settings').default;

const repo = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];

describe('account deletion: group plans the person organizes (20270405)', () => {
  test('a booking to resolve comes first', () => {
    expect(deletionPlanNotice({ plans: 2, bookings: 1, unresolved: 1 })).toBe('unresolved');
  });
  test('plans that will end get the warning, booked or not', () => {
    expect(deletionPlanNotice({ plans: 1, bookings: 1, unresolved: 0 })).toBe('ends_plans');
    expect(deletionPlanNotice({ plans: 1, bookings: 0, unresolved: 0 })).toBe('ends_plans');
  });
  test('nothing to say: no plans, or the read failed', () => {
    expect(deletionPlanNotice({ plans: 0, bookings: 0, unresolved: 0 })).toBeNull();
    expect(deletionPlanNotice(null)).toBeNull();
  });
  test('the refusal is recognised by its hint alone', () => {
    expect(isDeletionPlanRefusal({ hint: DELETION_PLAN_HINT })).toBe(true);
    expect(isDeletionPlanRefusal({ hint: 'step_up_required' })).toBe(false);
    expect(isDeletionPlanRefusal(new Error('x'))).toBe(false);
  });
  test.each(LANGS)('%s has all three strings', (l) => {
    for (const k of ['deletionEndsGroupPlans', 'deletionBlockedGroupPlanTitle', 'deletionBlockedGroupPlanBody']) {
      expect(settings[l][k]).toBeTruthy();
    }
  });
  test('the app, the function and the database use the same hint', () => {
    expect(repo('supabase/functions/delete-account/index.ts')).toContain(`'${DELETION_PLAN_HINT}'`);
    expect(repo('supabase/migrations/20270405_account_deletion_blockers.sql')).toContain(`hint = '${DELETION_PLAN_HINT}'`);
  });
  test('nobody is handed the role: the deletion never reassigns a plan or a request', () => {
    const sql = repo('supabase/migrations/20270405_account_deletion_blockers.sql');
    expect(sql).not.toMatch(/set initiator_id/i);
    expect(sql).not.toMatch(/set requester_id/i);
  });
});
