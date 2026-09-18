import { anticipationTier } from './anticipationTier';

describe('anticipationTier', () => {
  test('today', () => {
    expect(anticipationTier(0)).toBe('today');
  });

  test('1-3 days -> close', () => {
    expect(anticipationTier(1)).toBe('close');
    expect(anticipationTier(3)).toBe('close');
  });

  test('4-14 days -> building', () => {
    expect(anticipationTier(4)).toBe('building');
    expect(anticipationTier(14)).toBe('building');
  });

  test('more than 14 days -> none', () => {
    expect(anticipationTier(15)).toBe('none');
    expect(anticipationTier(365)).toBe('none');
  });

  test('missing/invalid/negative -> none, never fabricated', () => {
    expect(anticipationTier(null)).toBe('none');
    expect(anticipationTier(undefined)).toBe('none');
    expect(anticipationTier(NaN)).toBe('none');
    expect(anticipationTier(-1)).toBe('none');
  });
});
