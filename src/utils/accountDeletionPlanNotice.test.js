const fs = require('fs');
const path = require('path');
const { deletionPlanNotice } = require('./accountDeletionPlanNotice');
const settings = require('../i18n/ui/settings').default;

const repo = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const SQL = 'supabase/migrations/20270405_account_deletion_blockers.sql';

describe('account deletion: group plans and paid bookings (20270405)', () => {
  test('each line shows only for what is true', () => {
    expect(deletionPlanNotice({ plans: 1, bookings: 1, paid: 0 })).toEqual({ endsPlans: true, paidBooking: false });
    expect(deletionPlanNotice({ plans: 0, bookings: 0, paid: 2 })).toEqual({ endsPlans: false, paidBooking: true });
    expect(deletionPlanNotice({ plans: 1, bookings: 1, paid: 1 })).toEqual({ endsPlans: true, paidBooking: true });
    expect(deletionPlanNotice({ plans: 0, bookings: 0, paid: 0 })).toEqual({ endsPlans: false, paidBooking: false });
  });
  test('nothing readable: no extra line, and the deletion still offered', () => {
    expect(deletionPlanNotice(null)).toEqual({ endsPlans: false, paidBooking: false });
  });
  test.each(LANGS)('%s has both lines', (l) => {
    expect(settings[l].deletionEndsGroupPlans).toBeTruthy();
    expect(settings[l].deletionPaidBooking).toBeTruthy();
    expect(settings[l].deletionBlockedGroupPlanBody).toBeUndefined();
  });
  test('nobody is handed the role: the deletion never reassigns a plan or a request', () => {
    expect(repo(SQL)).not.toMatch(/set initiator_id/i);
    expect(repo(SQL)).not.toMatch(/set requester_id/i);
  });
  test('a deletion is never refused for a booking, and delete-account is untouched by it', () => {
    expect(repo(SQL)).not.toMatch(/group_plan_booking_unresolved/);
    expect(repo('supabase/functions/delete-account/index.ts')).not.toMatch(/plan_check|group_plan/);
  });
  test('the webhook writes statuses only: the exception is the database\'s job, so no path can miss it', () => {
    expect(repo('supabase/functions/stripe-connect-webhook/index.ts')).not.toMatch(/payment_exception/);
    expect(repo(SQL)).toMatch(/create trigger z_business_payment_status_changed after update of status/);
  });
});
