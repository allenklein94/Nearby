import { gatheringPrimaryAction, peoplePrimaryAction, offerPrimaryAction } from './primaryAction';

const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const base = { id: 'g', host_id: 'host', scheduled_at: '2026-09-20T23:00:00Z', is_public: true, capacity: null, attendees: [] };

test('open public gathering -> Join + View', () => {
  expect(gatheringPrimaryAction(base, 'me', NOW)).toEqual({ kind: 'join', label: 'Join', showView: true });
});
test('approval required -> Request to Join; full -> Join Waitlist', () => {
  expect(gatheringPrimaryAction({ ...base, requires_approval: true }, 'me', NOW).label).toBe('Request to Join');
  expect(gatheringPrimaryAction({ ...base, capacity: 1, attendees: [{ user_id: 'x', status: 'approved' }] }, 'me', NOW).label).toBe('Join Waitlist');
});
test('attending or hosting -> single View Plan', () => {
  expect(gatheringPrimaryAction({ ...base, attendees: [{ user_id: 'me', status: 'approved' }] }, 'me', NOW)).toEqual({ kind: 'view_plan', label: 'View Plan', showView: false });
  expect(gatheringPrimaryAction(base, 'host', NOW).kind).toBe('view_plan');
});
test('pending shows status plus View, never Join again', () => {
  const a = gatheringPrimaryAction({ ...base, attendees: [{ user_id: 'me', status: 'pending' }] }, 'me', NOW);
  expect(a).toEqual({ kind: 'requested', label: 'Requested', showView: true });
});
test('unknown viewer state, invite-only, or started -> View only', () => {
  expect(gatheringPrimaryAction({ ...base, attendees: undefined }, 'me', NOW).kind).toBe('view');
  expect(gatheringPrimaryAction({ ...base, visibility: 'invite_only' }, 'me', NOW).kind).toBe('view');
  expect(gatheringPrimaryAction({ ...base, scheduled_at: '2026-09-20T10:00:00Z' }, 'me', NOW).kind).toBe('view');
  expect(gatheringPrimaryAction(base, null, NOW).kind).toBe('view');
});

test('lowCommitment (Trending): open join -> I\'m Interested toggle; attending/pending unchanged', () => {
  const o = { lowCommitment: true, interestedIds: new Set() };
  expect(gatheringPrimaryAction(base, 'me', NOW, o)).toEqual({ kind: 'interested', label: "I'm Interested", on: false, showView: true });
  expect(gatheringPrimaryAction(base, 'me', NOW, { ...o, interestedIds: new Set(['g']) }).on).toBe(true);
  expect(gatheringPrimaryAction({ ...base, attendees: [{ user_id: 'me', status: 'approved' }] }, 'me', NOW, o).kind).toBe('view_plan');
  expect(gatheringPrimaryAction(base, 'me', NOW).kind).toBe('join');
});

test('Meet People only with real people nearby', () => {
  expect(peoplePrimaryAction(3).label).toBe('Meet People');
  expect(peoplePrimaryAction(0)).toBeNull();
  expect(peoplePrimaryAction(undefined)).toBeNull();
});

test('View Offer only while the offer is still open', () => {
  expect(offerPrimaryAction({ status: 'offered' }).label).toBe('View Offer');
  ['accepted', 'declined', 'completed', 'withdrawn', undefined].forEach((st) => expect(offerPrimaryAction({ status: st })).toBeNull());
  expect(offerPrimaryAction(null)).toBeNull();
});
