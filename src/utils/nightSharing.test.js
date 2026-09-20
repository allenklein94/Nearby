import { shareCandidates, shareRowLabel } from './nightSharing';

test('candidates are only people already connected, deduped, minus already-shared, sorted', () => {
  const friends = [{ id: 'b', display_name: 'Bea' }, { id: 'a', display_name: 'Al' }];
  const matches = [{ id: 'a', display_name: 'Al' }, { id: 'c', display_name: 'Cy' }];
  expect(shareCandidates(friends, matches, [{ userId: 'c' }]).map((p) => p.id)).toEqual(['a', 'b']);
  expect(shareCandidates([], [], [])).toEqual([]);
  expect(shareCandidates(null, undefined, null)).toEqual([]);
});
test('row labels: friend is "Can view"; guest shows its real expiry, expired says so', () => {
  expect(shareRowLabel({ kind: 'friend', displayName: 'Bea' })).toEqual({ title: 'Bea', subtitle: 'Can view' });
  const now = new Date('2026-09-20T12:00:00Z').getTime();
  expect(shareRowLabel({ kind: 'guest', guestName: 'Sam', expiresAt: '2026-10-20T12:00:00Z' }, now).subtitle).toMatch(/^Guest link · works until/);
  expect(shareRowLabel({ kind: 'guest', guestName: 'Sam', expiresAt: '2026-09-01T12:00:00Z' }, now).subtitle).toBe('Link expired');
});
