// The localized business-profile display layer: English is byte-identical to the shared helpers (which the English-only business
// dashboard still calls directly), and every other language composes the same decisions from its own words.
import { translate } from './translate';
import {
  followerCountLine, reliabilityLine, hoursLine, weekHoursRows, bookingModeLine, priceLine, largestGroupLine, spaceLines,
  restrictionsLine, dietaryLine, dietaryNote, pulseLabel, partyTypeName, thingsToDoLabels, suitedAgesLabel,
} from './businessProfileDisplay';
import { maxGroupLine, spaceCapacityLines } from '../constants/businessCapabilities';
import { notAccommodatedLine } from '../constants/businessRestrictions';
import { dietaryOptionsLine, dietarySafetyNote } from '../constants/dietaryOptions';
import { businessPriceLine } from '../constants/businessPrice';
import { businessHoursLabel, weekHoursLines } from '../utils/operatingStatus';
import { experiencePartyTypeLabel, availabilityPulseLabel } from '../constants/businessAttributes';
import { thingsToDoHere } from '../constants/activityLayer';
import { ageRangeLabel } from '../utils/suitedAges';

jest.mock('../services/supabase', () => ({ supabase: {}, functionUrl: () => '' }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-location', () => ({}));
jest.mock('../services/userLocation', () => ({ requireUserLocation: jest.fn(), getUserLocation: jest.fn() }));
const { formatPartnerReliabilityLine } = require('../services/businessFulfillment');

const hours = { timezone: 'UTC', week: { mon: [['09:00', '17:00']], tue: 'closed', wed: 'all_day', thu: [['09:00', '12:00'], ['13:00', '17:30']], fri: [['18:00', '02:00']], sat: 'closed', sun: 'closed' } };
const partner = {
  operating_hours: hours, booking_mode: 'reservation_required', max_group_size: 40, private_room_capacity: 20, outdoor_capacity: 30,
  attributes: ['private_dining', 'outdoor_seating', 'laptop_friendly', 'date_friendly'], subcategory: 'Coffee',
  not_accommodated: ['no_children', 'no_pets'], dietary_options: ['vegan', 'gluten_free', 'halal'],
};
const monNoon = new Date(Date.UTC(2026, 9, 5, 12, 0)); // a Monday, 12:00 UTC

describe('English stays exactly what the shared helpers say', () => {
  test('every line', () => {
    expect(hoursLine(partner, 'en', monNoon)).toBe(businessHoursLabel(partner, monNoon));
    expect(weekHoursRows(hours, 'en').map(({ day, text }) => ({ day, text }))).toEqual(weekHoursLines(hours));
    expect(priceLine('$$', 25, 'en')).toBe(businessPriceLine('$$', 25));
    expect(largestGroupLine(40, 'en')).toBe(maxGroupLine(40));
    expect(spaceLines(partner, 'en')).toEqual(spaceCapacityLines(partner));
    expect(restrictionsLine(partner, 'en')).toBe(notAccommodatedLine(partner));
    expect(dietaryLine(partner, 'en')).toBe(dietaryOptionsLine(partner));
    expect(dietaryNote(partner, 'en')).toBe(dietarySafetyNote(['vegan', 'gluten_free', 'halal']));
    expect(pulseLabel('limited', 'en')).toBe(availabilityPulseLabel('limited'));
    expect(partyTypeName('friends', 'en')).toBe(experiencePartyTypeLabel('friends'));
    expect(thingsToDoLabels(partner, 'en')).toEqual(thingsToDoHere(partner));
    for (const [a, b] of [[0, null], [0, 12], [13, 17], [3, 8], [5, null], [null, 12], [4, 4], [null, null]]) expect(suitedAgesLabel(a, b, 'en')).toBe(ageRangeLabel(a, b));
    expect(bookingModeLine(partner, 'en')).toBe('📅 Reservation required');
    expect(followerCountLine(1, 'en')).toBe('1 follower');
    expect(followerCountLine(3, 'en')).toBe('3 followers');
  });
  test('the English copies of the helper words match the helpers (so no language can drift from English meaning)', () => {
    const en = (k, vars) => translate('en', `ui.businessProfile.v.${k}`, vars);
    expect(en('upToPeople', { count: 40 })).toBe(maxGroupLine(40));
    expect(en('upToPeople', { count: 1 })).toBe(maxGroupLine(1));
    expect(en('dietarySafety')).toBe(dietarySafetyNote(['gluten_free']));
    expect(en('typicalSpend', { amount: '$25' })).toBe(businessPriceLine(null, 25));
    for (const k of ['open', 'limited', 'full']) expect(en(`pulse.${k}`)).toBe(availabilityPulseLabel(k));
    for (const k of ['solo', 'friends', 'groups', 'date', 'family', 'coworkers', 'new_people']) expect(en(`partyType.${k}`)).toBe(experiencePartyTypeLabel(k));
    for (const a of thingsToDoHere({ ...partner, attributes: ['laptop_friendly', 'date_friendly', 'dog_friendly', 'group_friendly'], accommodates_party_types: ['groups'] })) expect(en(`activity.${a.key}`)).toBe(a.label);
  });
  test('reliability line, English path and the same parts in Spanish', () => {
    const rep = { total_opportunities: 8, acceptance_rate: 75, completion_rate: 90, rated_count: 4, pct_would_repeat: 88 };
    const rt = { median_response_minutes: 20, response_sample_size: 5 };
    expect(reliabilityLine(rep, rt, 'en')).toBe('⭐ usually responds in ~20 min · 75% of offers accepted · 90% completed · 88% would do this again');
    for (const [r, t] of [[rep, rt], [rep, { median_response_minutes: 150, response_sample_size: 4 }], [{ ...rep, rated_count: 1 }, null], [{ total_opportunities: 9 }, null]]) {
      expect(reliabilityLine(r, t, 'en')).toBe(formatPartnerReliabilityLine(r, t));
    }
    expect(reliabilityLine(rep, rt, 'es')).toBe('⭐ suele responder en ~20 min · 75% de ofertas aceptadas · 90% completadas · 88% lo repetiría');
    expect(reliabilityLine({ total_opportunities: 2 }, rt, 'es')).toBeNull();
  });
});

describe('other languages', () => {
  test('hours: booking-needed decision kept, clock in the language', () => {
    expect(hoursLine(partner, 'de', monNoon)).toBe('Innerhalb der heutigen Öffnungszeiten · bis 17 Uhr · Buchung nötig');
    expect(hoursLine({ operating_hours: hours }, 'es', monNoon)).toMatch(/^Abierto ahora · hasta las /);
    const rows = weekHoursRows(hours, 'fr');
    expect(rows).toHaveLength(7);
    expect(rows[1].text).toBe('Fermé');
    expect(rows[2].text).toBe('Ouvert 24 h/24');
    expect(weekHoursRows(null, 'fr')).toBeNull();
  });
  test('lines', () => {
    expect(largestGroupLine(40, 'es')).toBe('Hasta 40 personas');
    expect(largestGroupLine(null, 'es')).toBeNull();
    expect(restrictionsLine(partner, 'fr')).toBe("Pas d'enfants · Pas d'animaux");
    expect(dietaryLine(partner, 'es')).toContain(' · ');
    expect(dietaryNote({ dietary_options: ['vegan'] }, 'es')).toBeNull();
    expect(dietaryNote(partner, 'es')).toMatch(/^Declarado por el negocio/);
    expect(spaceLines(partner, 'de').map((x) => x.label)).toEqual(['Separater Raum', 'Außenbereich']);
    expect(suitedAgesLabel(0, null, 'es')).toBe('Todas las edades');
    expect(suitedAgesLabel(3, 8, 'de')).toBe('3–8 Jahre');
    expect(bookingModeLine({ booking_mode: 'walk_in' }, 'pt')).toBe('🚶 Pode chegar sem reserva');
    expect(bookingModeLine({}, 'pt')).toBeNull();
    expect(followerCountLine(2, 'ru')).toBe('2 подписчика');
  });
});
