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

describe('opportunity and invite helpers', () => {
  const { canRespondToOpportunity, inviteLifecycleState } = require('./objectLifecycle');
  it('a pending opportunity is answerable only while its request is open', () => {
    expect(canRespondToOpportunity({ status: 'pending', business_requests: { status: 'open' } })).toBe(true);
    expect(canRespondToOpportunity({ status: 'pending', business_requests: { status: 'cancelled' } })).toBe(false);
    expect(canRespondToOpportunity({ status: 'offered', business_requests: { status: 'open' } })).toBe(false);
    expect(canRespondToOpportunity({ status: 'pending' })).toBe(false);
  });
  it('an invite for a past gathering is expired and only dismissable', () => {
    expect(inviteLifecycleState({ inviteType: 'gathering', scheduledAt: '2020-01-01T00:00:00Z' }, now)).toBe('expired');
    expect(inviteLifecycleState({ inviteType: 'community' }, now)).toBe('pending');
    expect(canDo('invite', 'expired', 'accept')).toBe(false);
    expect(canDo('invite', 'expired', 'dismiss')).toBe(true);
  });
});

describe('view vs action classes', () => {
  const { lifecycleClass, viewLabel } = require('./objectLifecycle');
  it('classifies the four kinds of state', () => {
    expect(lifecycleClass('gathering', 'upcoming_none')).toBe('actionable');
    expect(lifecycleClass('offer', 'offered')).toBe('actionable');
    expect(lifecycleClass('gathering', 'past_attending')).toBe('completed');
    expect(lifecycleClass('offer', 'completed')).toBe('completed');
    expect(lifecycleClass('gathering', 'past_requested')).toBe('expired');
    expect(lifecycleClass('offer', 'expired')).toBe('expired');
    expect(lifecycleClass('nope', 'x')).toBe('view');
  });
  it('an expired or completed state never classes as actionable', () => {
    for (const [kind, states] of Object.entries(LIFECYCLE)) {
      for (const st of Object.keys(states)) {
        if (['expired', 'completed', 'cancelled', 'declined', 'withdrawn'].includes(st) || st.startsWith('past_')) {
          const acts = states[st].filter((a) => a !== 'view' && a !== 'dismiss' && a !== 'reopen');
          if (lifecycleClass(kind, st) === 'actionable') throw new Error(`${kind}.${st} is actionable: ${acts}`);
        }
      }
    }
  });
  it('labels only what is true', () => {
    expect(viewLabel('gathering', 'past_attending')).toBe('View Past Event');
    expect(viewLabel('gathering', 'upcoming_attending')).toBe('View Plan');
    expect(viewLabel('gathering', 'past_requested')).toBe('Expired');
    expect(viewLabel('request', 'open')).toBe('View');
  });
});

describe('request deadline (item 66)', () => {
  const { requestLifecycleState, canRespondToOpportunity, canDo } = require('./objectLifecycle');
  const now = new Date('2030-01-10T12:00:00Z');
  it('an open request past its deadline is expired before the sweep runs', () => {
    expect(requestLifecycleState({ status: 'open', expires_at: '2030-01-10T11:59:00Z' }, now)).toBe('expired');
    expect(requestLifecycleState({ status: 'open', expires_at: '2030-01-10T12:01:00Z' }, now)).toBe('open');
    expect(requestLifecycleState({ status: 'open' }, now)).toBe('open');
    expect(requestLifecycleState({ status: 'cancelled', expires_at: '2020-01-01' }, now)).toBe('cancelled');
  });
  it('a business cannot respond to a lapsed request but can still see it', () => {
    const o = (exp) => ({ status: 'pending', business_requests: { status: 'open', expires_at: exp } });
    expect(canRespondToOpportunity(o('2030-01-10T11:00:00Z'), now)).toBe(false);
    expect(canRespondToOpportunity(o('2030-01-10T13:00:00Z'), now)).toBe(true);
  });
  it('only an expired request can be reopened', () => {
    expect(canDo('request', 'expired', 'reopen')).toBe(true);
    expect(canDo('request', 'open', 'reopen')).toBe(false);
    expect(canDo('request', 'cancelled', 'reopen')).toBe(false);
  });
});
