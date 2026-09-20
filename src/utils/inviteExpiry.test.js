import { isInviteExpired, expiredInviteLabel } from './inviteExpiry';

const NOW = new Date('2026-08-31T12:00:00Z').getTime();

test('a past gathering invitation is expired, a future one is not', () => {
  expect(isInviteExpired({ inviteType: 'gathering', scheduledAt: '2026-08-30T19:00:00Z' }, NOW)).toBe(true);
  expect(isInviteExpired({ inviteType: 'gathering', scheduledAt: '2026-09-01T19:00:00Z' }, NOW)).toBe(false);
});
test('community invites and unknown times are never expired', () => {
  expect(isInviteExpired({ inviteType: 'community', scheduledAt: null }, NOW)).toBe(false);
  expect(isInviteExpired({ inviteType: 'gathering', scheduledAt: null }, NOW)).toBe(false);
});
test('label reads Invitation expired / date • Past, never Declined', () => {
  const l = expiredInviteLabel({ scheduledAt: '2026-08-30T19:00:00' });
  expect(l.title).toBe('Invitation expired');
  expect(l.detail).toBe('August 30 • Past');
  expect(JSON.stringify(l)).not.toMatch(/declin/i);
});

const { isGatheringRequestExpired, isOccasionInviteExpired, expiredDateLabel } = require('./inviteExpiry');
test('pending gathering request on a past gathering is expired', () => {
  expect(isGatheringRequestExpired({ scheduled_at: '2026-08-30T19:00:00Z' }, NOW)).toBe(true);
  expect(isGatheringRequestExpired({ scheduled_at: '2026-09-02T19:00:00Z' }, NOW)).toBe(false);
  expect(isGatheringRequestExpired({}, NOW)).toBe(false);
});
test('occasion invite expires only after its date; no date never expires', () => {
  const now = new Date(2026, 7, 31, 12);
  expect(isOccasionInviteExpired('2026-08-30', now)).toBe(true);
  expect(isOccasionInviteExpired('2026-08-31', now)).toBe(false);
  expect(isOccasionInviteExpired(null, now)).toBe(false);
  expect(expiredDateLabel('2026-08-30')).toBe('August 30 • Past');
});
