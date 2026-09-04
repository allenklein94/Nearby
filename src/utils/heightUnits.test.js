const {
  MIN_HEIGHT_INCHES,
  MAX_HEIGHT_INCHES,
  feetInchesToTotalInches,
  isBlankHeightPair,
  totalInchesToFeetInches,
  formatHeightInches,
} = require('./heightUnits');

describe('feetInchesToTotalInches', () => {
  test('converts a real feet+inches pair to total inches', () => {
    expect(feetInchesToTotalInches('5', '10')).toBe(70);
    expect(feetInchesToTotalInches('6', '0')).toBe(72);
  });

  test('returns null when either field fails to parse', () => {
    expect(feetInchesToTotalInches('', '10')).toBeNull();
    expect(feetInchesToTotalInches('5', '')).toBeNull();
    expect(feetInchesToTotalInches('abc', '10')).toBeNull();
  });

  test('rejects a value below the real 4\'0" bound', () => {
    expect(feetInchesToTotalInches('3', '11')).toBeNull(); // 47in
    expect(feetInchesToTotalInches('4', '0')).toBe(MIN_HEIGHT_INCHES); // 48in, inclusive
  });

  test('rejects a value above the real 7\'0" bound', () => {
    expect(feetInchesToTotalInches('7', '1')).toBeNull(); // 85in
    expect(feetInchesToTotalInches('7', '0')).toBe(MAX_HEIGHT_INCHES); // 84in, inclusive
  });

  test('rejects a garbage picker mis-tap producing 0', () => {
    expect(feetInchesToTotalInches('0', '0')).toBeNull();
  });
});

describe('isBlankHeightPair', () => {
  test('true only when both fields are genuinely empty', () => {
    expect(isBlankHeightPair('', '')).toBe(true);
    expect(isBlankHeightPair(undefined, null)).toBe(true);
    expect(isBlankHeightPair('  ', '')).toBe(true);
  });

  test('false when either field has real content, even invalid content', () => {
    expect(isBlankHeightPair('5', '')).toBe(false);
    expect(isBlankHeightPair('', '10')).toBe(false);
    expect(isBlankHeightPair('abc', '')).toBe(false);
  });
});

describe('totalInchesToFeetInches / formatHeightInches round-trip', () => {
  test('never fabricates a default for a null/undefined input', () => {
    expect(totalInchesToFeetInches(null)).toEqual({ feet: '', inches: '' });
    expect(totalInchesToFeetInches(undefined)).toEqual({ feet: '', inches: '' });
    expect(formatHeightInches(null)).toBeNull();
    expect(formatHeightInches(undefined)).toBeNull();
  });

  test('round-trips a real stored value back to the same feet/inches pair', () => {
    expect(totalInchesToFeetInches(70)).toEqual({ feet: '5', inches: '10' });
    expect(feetInchesToTotalInches('5', '10')).toBe(70);
  });

  test('formats a real total as a human-readable string', () => {
    expect(formatHeightInches(70)).toBe('5\'10"');
    expect(formatHeightInches(72)).toBe('6\'0"');
  });
});
