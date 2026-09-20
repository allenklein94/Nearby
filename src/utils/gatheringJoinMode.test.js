const { needsApproval, joinLabel } = require('./gatheringJoinMode');

describe('gathering join mode', () => {
  test('public gatherings default to Anyone: one tap', () => {
    expect(needsApproval({ is_public: true, requires_approval: false })).toBe(false);
    expect(needsApproval({ is_public: true })).toBe(false);
    expect(joinLabel({ is_public: true })).toBe('Join Gathering');
  });
  test('host-enabled approval requires a request', () => {
    expect(needsApproval({ is_public: true, requires_approval: true })).toBe(true);
    expect(joinLabel({ is_public: true, requires_approval: true })).toBe('Request to Join');
  });
  test('non-public (invite-only) keeps requiring review, as before', () => {
    expect(needsApproval({ is_public: false })).toBe(true);
  });
  test('full gatherings say waitlist regardless of mode', () => {
    expect(joinLabel({ is_public: true }, { isFull: true })).toBe('Join Waitlist');
    expect(joinLabel({ is_public: true, requires_approval: true }, { isFull: true })).toBe('Join Waitlist');
  });
  test('missing gathering never needs approval', () => {
    expect(needsApproval(null)).toBe(false);
  });
});
