import { unlockStatus } from './unlockProgress';
const offer = (o = {}) => ({ unlock_scope: 'community', unlock_min_members: 10, ...o });
test('no unlock rule = null', () => { expect(unlockStatus({ unlock_scope: null }, 3)).toBeNull(); });
test('known progress shows real x/N', () => {
  expect(unlockStatus(offer(), 4)).toMatchObject({ known: true, isLocked: true, label: '🔒 Unlocks at 10 community members (4/10 so far)' });
  expect(unlockStatus(offer(), 0).label).toMatch(/\(0\/10 so far\)/); // a real zero is still shown
  expect(unlockStatus(offer(), 10)).toMatchObject({ isLocked: false, label: '🔓 Unlocked' });
});
test('unknown progress is never printed as 0/N and stays locked', () => {
  for (const p of [undefined, null, NaN]) {
    const s = unlockStatus(offer(), p);
    expect(s.known).toBe(false);
    expect(s.isLocked).toBe(true);
    expect(s.label).toBe('🔒 Unlocks at 10 community members');
  }
});
test('singular noun', () => {
  expect(unlockStatus(offer({ unlock_min_members: 1, unlock_scope: 'gathering' }), null).label).toBe('🔒 Unlocks at 1 attendee');
});
