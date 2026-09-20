import { canEditNight, canRemoveStop, moveStopIds, removeStopCopy } from './experienceStopEdit';

const stops = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('only the owner of a live night can edit', () => {
  expect(canEditNight('draft', true)).toBe(true);
  expect(canEditNight('confirmed', true)).toBe(true);
  expect(canEditNight('cancelled', true)).toBe(false);
  expect(canEditNight('completed', true)).toBe(false);
  expect(canEditNight('draft', false)).toBe(false);
});
test('remove needs more than two stops and a not-done stop', () => {
  expect(canRemoveStop({ state: 'chosen' }, 3)).toBe(true);
  expect(canRemoveStop({ state: 'chosen' }, 2)).toBe(false);
  expect(canRemoveStop({ state: 'done' }, 4)).toBe(false);
});
test('moveStopIds swaps neighbours and refuses out of range', () => {
  expect(moveStopIds(stops, 1, -1)).toEqual(['b', 'a', 'c']);
  expect(moveStopIds(stops, 1, 1)).toEqual(['a', 'c', 'b']);
  expect(moveStopIds(stops, 0, -1)).toBeNull();
  expect(moveStopIds(stops, 2, 1)).toBeNull();
});
test('remove copy only promises a cancellation when one will happen', () => {
  const biz = { title: 'Chef tasting', stopType: 'business_availability', requestId: 'r' };
  expect(removeStopCopy({ ...biz, state: 'booked' }).message).toMatch(/cancels your reservation/);
  expect(removeStopCopy({ ...biz, state: 'requested' }).message).toMatch(/cancels your request/);
  expect(removeStopCopy({ ...biz, state: 'cancelled' }).message).not.toMatch(/cancels/);
  expect(removeStopCopy({ ...biz, state: 'chosen', requestId: null }).message).not.toMatch(/cancels/);
  expect(removeStopCopy({ title: 'Trivia', stopType: 'gathering', state: 'booked' }).message).not.toMatch(/cancels/);
});
