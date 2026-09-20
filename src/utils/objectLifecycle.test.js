import { canDo, gatheringLifecycleState, offerLifecycleState, LIFECYCLE } from './objectLifecycle';

const now = new Date('2026-08-31T12:00:00Z');

describe('object lifecycle', () => {
  it('a past gathering allows View only, whoever asks', () => {
    const past = { scheduled_at: '2026-08-30T19:00:00Z' };
    for (const myStatus of [null, 'approved', 'pending']) {
      const s = gatheringLifecycleState({ ...past, myStatus }, now);
      for (const a of ['join', 'request', 'accept', 'interested']) expect(canDo('gathering', s, a)).toBe(false);
      expect(canDo('gathering', s, 'view')).toBe(true);
    }
  });

  it('an upcoming open gathering allows join, an unknown date does not', () => {
    expect(canDo('gathering', gatheringLifecycleState({ scheduled_at: '2026-09-05T19:00:00Z' }, now), 'join')).toBe(true);
    expect(canDo('gathering', gatheringLifecycleState({ scheduled_at: null }, now), 'join')).toBe(false);
  });

  it('an expired offer cannot be accepted even if still stored as offered', () => {
    const offer = { status: 'offered', valid_until: '2026-08-31T10:00:00Z' };
    expect(canDo('offer', offerLifecycleState(offer, now), 'accept')).toBe(false);
    expect(canDo('offer', offerLifecycleState({ status: 'offered' }, now), 'accept')).toBe(true);
  });

  it('unknown kind, state or action is refused', () => {
    expect(canDo('nope', 'open', 'view')).toBe(false);
    expect(canDo('request', 'weird', 'view')).toBe(false);
    expect(canDo('request', 'open', 'teleport')).toBe(false);
  });

  it('every state allows View', () => {
    for (const states of Object.values(LIFECYCLE)) for (const acts of Object.values(states)) expect(acts).toContain('view');
  });

  it('an ended request never offers Accept', () => {
    for (const s of ['fulfilled', 'expired', 'cancelled', 'merged']) expect(canDo('request', s, 'accept_offer')).toBe(false);
  });
});
