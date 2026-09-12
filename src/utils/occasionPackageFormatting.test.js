import { formatAvailableDaysLabel, formatIncludedItemsLabel, formatOccasionPackageDetail } from './occasionPackageFormatting';

describe('formatAvailableDaysLabel', () => {
  test('null/empty means every day -- honestly renders nothing, not "closed"', () => {
    expect(formatAvailableDaysLabel(null)).toBeNull();
    expect(formatAvailableDaysLabel([])).toBeNull();
  });

  test('renders selected days in Sunday-through-Saturday order regardless of input order', () => {
    expect(formatAvailableDaysLabel([6, 5])).toBe('Fr/Sa');
    expect(formatAvailableDaysLabel([5, 6])).toBe('Fr/Sa');
  });

  test('renders a single day', () => {
    expect(formatAvailableDaysLabel([0])).toBe('Su');
  });
});

describe('formatIncludedItemsLabel', () => {
  test('null/empty renders nothing', () => {
    expect(formatIncludedItemsLabel(null)).toBeNull();
    expect(formatIncludedItemsLabel([])).toBeNull();
  });

  test('joins real included items', () => {
    expect(formatIncludedItemsLabel(['Birthday dessert', 'Group table'])).toBe('Birthday dessert, Group table');
  });
});

describe('formatOccasionPackageDetail', () => {
  test('omits whatever the business genuinely did not set, never fabricates a placeholder', () => {
    expect(formatOccasionPackageDetail({ pricePerPerson: null, minGuests: null, availableDays: null })).toBeNull();
  });

  test('combines every real field that is set', () => {
    expect(formatOccasionPackageDetail({ pricePerPerson: 45, minGuests: 6, availableDays: [5, 6] })).toBe('$45/person · min 6 guests · Fr/Sa');
  });

  test('renders partial data honestly', () => {
    expect(formatOccasionPackageDetail({ pricePerPerson: 30, minGuests: null, availableDays: null })).toBe('$30/person');
  });
});
