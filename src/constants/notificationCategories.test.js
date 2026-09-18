import { NOTIFICATION_CATEGORIES, notificationOptOuts } from './notificationCategories';

describe('notificationOptOuts', () => {
  it('writes only explicit opt-outs', () => {
    expect(notificationOptOuts({ notify_social: false, notify_plans: false, notify_business: true })).toEqual({ notify_social: false });
  });
  it('handles missing choices', () => {
    expect(notificationOptOuts(undefined)).toEqual({});
  });
  it('only uses the 6 real category columns', () => {
    const real = ['notify_social', 'notify_dating', 'notify_discovery', 'notify_proximity', 'notify_planning', 'notify_business', 'notify_community'];
    NOTIFICATION_CATEGORIES.forEach((c) => expect(real).toContain(c.column));
  });
});
