import { countLabel } from './plural';
test('singular, plural, zero, irregular', () => {
  expect(countLabel(1, 'person', 'people')).toBe('1 person');
  expect(countLabel(0, 'person', 'people')).toBe('0 people');
  expect(countLabel(2, 'spot')).toBe('2 spots');
  expect(countLabel('1', 'day')).toBe('1 day');
});
test('unknown count is null, never NaN', () => {
  for (const v of [null, undefined, '', 'x', NaN]) expect(countLabel(v, 'spot')).toBeNull();
});
