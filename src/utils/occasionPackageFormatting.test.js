import { formatAvailableDaysLabel, formatIncludedItemsLabel, formatOccasionPackageDetail, findMatchingOccasionPackage } from './occasionPackageFormatting';

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

describe('findMatchingOccasionPackage', () => {
  const birthdayPkg = { id: 'p1', occasion_type: 'birthday', name: 'Birthday Package', min_guests: 6, active: true };
  const anniversaryPkg = { id: 'p2', occasion_type: 'anniversary', name: 'Anniversary Package', min_guests: null, active: true };
  const bigBirthdayPkg = { id: 'p3', occasion_type: 'birthday', name: 'Big Birthday Bash', min_guests: 12, active: true };
  const pausedPkg = { id: 'p4', occasion_type: 'birthday', name: 'Paused Package', min_guests: null, active: false };

  test('no occasion -> null, never fabricates a match', () => {
    expect(findMatchingOccasionPackage({ occasion: null, partySize: 10, packages: [birthdayPkg] })).toBeNull();
  });

  test('no package for this occasion -> null', () => {
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 10, packages: [anniversaryPkg] })).toBeNull();
  });

  test('matches the right occasion when the party size clears the minimum', () => {
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 8, packages: [birthdayPkg, anniversaryPkg] })).toBe(birthdayPkg);
  });

  test('a party size below the minimum is correctly excluded', () => {
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 4, packages: [birthdayPkg] })).toBeNull();
  });

  test('a paused (inactive) package is never matched', () => {
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 20, packages: [pausedPkg] })).toBeNull();
  });

  test('when several real packages fit, prefers the most specific (highest cleared min_guests)', () => {
    expect(findMatchingOccasionPackage({ occasion: 'birthday', partySize: 15, packages: [birthdayPkg, bigBirthdayPkg] })).toBe(bigBirthdayPkg);
  });

  test('no party size known yet still matches a package with no minimum', () => {
    expect(findMatchingOccasionPackage({ occasion: 'anniversary', partySize: null, packages: [anniversaryPkg] })).toBe(anniversaryPkg);
  });
});
