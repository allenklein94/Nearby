// Localization pass 5, Activity: the helper lines the screen shows are localized, and English stays word for word.
import { setCurrentLanguage } from './translate';
import { businessReplyTitle, businessReplyStatus, acceptedReplyTitle, offerRevealHeader } from '../utils/offerCopy';
import { expiredInviteLabel, expiredDateLabel } from '../utils/inviteExpiry';
import { formatOfferSummary } from '../services/businessFulfillment';
import { UI_NAMESPACES, UI_LANGUAGES } from './ui';

jest.mock('../services/supabase', () => ({ supabase: {}, functionUrl: () => '' }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-location', () => ({}));
jest.mock('../services/userLocation', () => ({ requireUserLocation: jest.fn(), getUserLocation: jest.fn() }));

const offer = { status: 'offered', offer_type: 'discount', offer_price: 12, price_is_per_person: true };

afterEach(() => setCurrentLanguage('en'));

describe('English is unchanged', () => {
  test('reply titles, status, accepted, reveal', () => {
    expect(businessReplyTitle('Coastal Coffee', offer)).toBe('Coastal Coffee made you an offer');
    expect(businessReplyTitle('Coastal Coffee', { status: 'offered', offer_type: 'alt_time' })).toBe('Coastal Coffee suggested another time');
    expect(businessReplyTitle(null, { status: 'offered', offer_type: 'standard' })).toBe('A local business can take you');
    expect(businessReplyStatus({ offer_type: 'standard' })).toBe('Can take you');
    expect(acceptedReplyTitle('Coastal Coffee', { offer_type: 'standard' })).toBe('You chose Coastal Coffee');
    expect(offerRevealHeader(null)).toBe('A business made you an offer');
  });
  test('expired labels and offer summary', () => {
    const d = new Date(2026, 7, 30, 19);
    expect(expiredInviteLabel({ scheduledAt: d.toISOString() })).toEqual({ title: 'Invitation expired', detail: 'August 30 • Past' });
    expect(expiredDateLabel('2026-08-30')).toBe('August 30 • Past');
    expect(formatOfferSummary(offer)).toBe('Discount · $12.00/person');
  });
});

describe('another language reads its own words', () => {
  test('offer copy follows the current language', () => {
    setCurrentLanguage('es');
    expect(businessReplyTitle('Coastal Coffee', offer)).toBe('Coastal Coffee te hizo una oferta');
    expect(acceptedReplyTitle('Coastal Coffee', { offer_type: 'alt_time' })).toBe('Aceptaste el horario que sugirió Coastal Coffee');
  });
  test('expired label and summary take the language', () => {
    const label = expiredInviteLabel({ scheduledAt: new Date(2026, 7, 30, 19).toISOString() }, 'de');
    expect(label.title).toBe('Einladung abgelaufen');
    expect(label.detail).toMatch(/30.*Vorbei$/);
    expect(formatOfferSummary(offer, 'es')).toMatch(/^Descuento · .*12.*\/persona$/);
  });
  test('the Activity and offer-copy namespaces exist in every language with the same keys', () => {
    for (const ns of ['activity', 'offerCopy']) {
      const keys = (o) => Object.keys(o).sort();
      for (const lang of UI_LANGUAGES) expect(keys(UI_NAMESPACES[ns][lang])).toEqual(keys(UI_NAMESPACES[ns].en));
    }
  });
});
