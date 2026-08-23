const { PLAN_STATUS, resolveGatheringPlanStatus, resolveGroupPlanStatus } = require('./planStatus');

describe('resolveGatheringPlanStatus', () => {
  it('a past gathering is always Completed, regardless of role', () => {
    expect(resolveGatheringPlanStatus({ role: 'attending', isPast: true })).toBe(PLAN_STATUS.COMPLETED);
    expect(resolveGatheringPlanStatus({ role: 'hosting', isPast: true })).toBe(PLAN_STATUS.COMPLETED);
  });

  it('an upcoming approved attendance or hosting slot is Confirmed', () => {
    expect(resolveGatheringPlanStatus({ role: 'attending', attendeeStatus: 'approved' })).toBe(PLAN_STATUS.CONFIRMED);
    expect(resolveGatheringPlanStatus({ role: 'hosting' })).toBe(PLAN_STATUS.CONFIRMED);
  });

  it('a pending or waitlisted attendance request is Pending', () => {
    expect(resolveGatheringPlanStatus({ role: 'attending', attendeeStatus: 'pending' })).toBe(PLAN_STATUS.PENDING);
    expect(resolveGatheringPlanStatus({ role: 'attending', attendeeStatus: 'waitlisted' })).toBe(PLAN_STATUS.PENDING);
  });

  it('a declined attendance request is Declined', () => {
    expect(resolveGatheringPlanStatus({ role: 'attending', attendeeStatus: 'declined' })).toBe(PLAN_STATUS.DECLINED);
  });
});

describe('resolveGroupPlanStatus', () => {
  it('maps fulfilled to Confirmed', () => {
    expect(resolveGroupPlanStatus('fulfilled')).toBe(PLAN_STATUS.CONFIRMED);
  });

  it('maps cancelled/expired to Cancelled', () => {
    expect(resolveGroupPlanStatus('cancelled')).toBe(PLAN_STATUS.CANCELLED);
    expect(resolveGroupPlanStatus('expired')).toBe(PLAN_STATUS.CANCELLED);
  });

  it('maps everything else (e.g. open) to Pending', () => {
    expect(resolveGroupPlanStatus('open')).toBe(PLAN_STATUS.PENDING);
    expect(resolveGroupPlanStatus('merged')).toBe(PLAN_STATUS.PENDING);
  });
});
