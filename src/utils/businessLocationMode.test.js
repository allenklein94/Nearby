import fs from 'fs';
import path from 'path';
import {
  LOCATION_MODES, SERVICE_AREA_SOURCE, isServiceArea, locationModeOf, roundServiceAreaPoint, hasPublicPlace, hasMapPin,
  signupLocationProblem, signupLocationFields, businessLocationWrite,
} from './businessLocationMode';
import { businessPrimaryAction } from './primaryAction';
import { businessLocationNotice, businessLocationBanner } from './businessLocationNotice';
import { translate } from '../i18n/translate';

const S = LOCATION_MODES.storefront;
const A = LOCATION_MODES.serviceArea;
const DOOR = { latitude: 26.591234, longitude: -80.043219 };

describe('business location at sign-up (owner, 2026-11-15)', () => {
  test('storefront: address AND its own pin are required before the application can be sent', () => {
    expect(signupLocationProblem({ mode: S, address: '', ...DOOR })).toBe('address_required');
    expect(signupLocationProblem({ mode: S, address: '   ', ...DOOR })).toBe('address_required');
    expect(signupLocationProblem({ mode: S, address: '12 Ocean Ave', latitude: null, longitude: null })).toBe('pin_required');
    expect(signupLocationProblem({ mode: S, address: '12 Ocean Ave', ...DOOR })).toBeNull();
  });

  test('service area: only the rough area is required, never an address', () => {
    expect(signupLocationProblem({ mode: A, address: '', latitude: null, longitude: null })).toBe('area_required');
    expect(signupLocationProblem({ mode: A, address: '', ...DOOR })).toBeNull();
  });

  test('missing choice: the owner must say which kind of business it is', () => {
    expect(signupLocationProblem({ mode: null, address: '12 Ocean Ave', ...DOOR })).toBe('choose_mode');
  });

  test('storefront insert keeps the address, exact pin and provenance', () => {
    expect(signupLocationFields({ mode: S, address: ' 12 Ocean Ave ', ...DOOR, locationSource: 'host_pin', googlePlaceId: 'g1' }))
      .toEqual({ address: '12 Ocean Ave', ...DOOR, location_source: 'host_pin', google_place_id: 'g1' });
    expect(signupLocationFields({ mode: S, address: '12 Ocean Ave', ...DOOR, locationSource: 'device', googlePlaceId: 'g1' }))
      .toEqual({ address: '12 Ocean Ave', ...DOOR, location_source: 'device', google_place_id: null });
  });

  test('service-area insert never sends an address or place ID, and its point is rounded (~1 km)', () => {
    const f = signupLocationFields({ mode: A, address: '7 Home St', ...DOOR, locationSource: 'host_pin', googlePlaceId: 'g1' });
    expect(f).toEqual({ address: null, latitude: 26.59, longitude: -80.04, location_source: SERVICE_AREA_SOURCE, google_place_id: null });
    expect(roundServiceAreaPoint({ latitude: 26.595, longitude: -80.045 })).toEqual({ latitude: 26.6, longitude: -80.04 });
  });

  test('editing afterwards: a pin is written in the mode the owner chose', () => {
    expect(businessLocationWrite(A, { ...DOOR, locationSource: 'host_pin', googlePlaceId: 'g1' }))
      .toEqual({ latitude: 26.59, longitude: -80.04, locationSource: SERVICE_AREA_SOURCE, googlePlaceId: null });
    expect(businessLocationWrite(S, { ...DOOR, locationSource: 'host_pin', googlePlaceId: 'g1' }))
      .toEqual({ ...DOOR, locationSource: 'host_pin', googlePlaceId: 'g1' });
    expect(businessLocationWrite(S, { ...DOOR, locationSource: 'device', googlePlaceId: 'g1' }).googlePlaceId).toBeNull();
  });

  test('the saved mode is read back for the edit sheet', () => {
    expect(locationModeOf({ location_source: SERVICE_AREA_SOURCE, latitude: 26.59, longitude: -80.04 })).toBe(A);
    expect(locationModeOf({ location_source: 'host_pin', address: '12 Ocean Ave', ...DOOR })).toBe(S);
    expect(locationModeOf({ address: null, latitude: null, longitude: null })).toBeNull();
  });

  test('a service-area business has no public place: no map pin, no directions, no "Go now"', () => {
    const sa = { location_source: SERVICE_AREA_SOURCE, latitude: 26.59, longitude: -80.04, address: null };
    const shop = { location_source: 'host_pin', ...DOOR, address: '12 Ocean Ave' };
    expect(isServiceArea(sa)).toBe(true);
    expect(hasPublicPlace(sa)).toBe(false);
    expect(hasMapPin(sa)).toBe(false);
    expect(hasPublicPlace(shop)).toBe(true);
    expect(hasMapPin(shop)).toBe(true);
    expect(businessPrimaryAction({ ...sa, booking_mode: 'walk_in' })).toBeNull();
    expect(businessPrimaryAction({ ...shop, booking_mode: 'walk_in' })?.kind).toBe('directions');
    expect(businessPrimaryAction({ ...sa, booking_mode: 'reservation_recommended' })).toMatchObject({ kind: 'reserve', secondary: null });
    expect(businessPrimaryAction({ ...sa, booking_mode: 'request_required' })?.kind).toBe('request'); // still reachable by request
  });

  test('incomplete location is never silent: no point = the "add your address / place your pin" notice', () => {
    expect(businessLocationNotice({ address: null, latitude: null, longitude: null })?.needsAction).toBe(true);
    expect(businessLocationNotice({ address: '12 Ocean Ave', latitude: null, longitude: null })?.needsAction).toBe(true);
    expect(businessLocationNotice({ location_source: SERVICE_AREA_SOURCE, latitude: 26.59, longitude: -80.04 })).toBeNull();
  });

  test('the dashboard line says what is saved, never "📍 null"', () => {
    expect(businessLocationBanner({ location_source: SERVICE_AREA_SOURCE, latitude: 26.59, longitude: -80.04 }).text).toBe(translate('en', 'ui.bizHelp.location.serviceAreaBanner'));
    expect(businessLocationBanner({ location_source: 'host_pin', ...DOOR, address: null }).text).toBe(translate('en', 'ui.bizHelp.location.pinnedNoAddress'));
    expect(businessLocationBanner({ location_source: 'host_pin', ...DOOR, address: '12 Ocean Ave' }).text).toBe('📍 12 Ocean Ave');
  });

  test('strings exist in all 11 languages', () => {
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      for (const k of ['serviceAreaBanner', 'pinnedNoAddress', 'modeStorefront', 'modeServiceArea', 'serviceAreaHint', 'markArea']) {
        expect(translate(lang, `ui.bizHelp.location.${k}`)).not.toBe(`ui.bizHelp.location.${k}`);
      }
    }
  });

  test('sign-up, dashboard and Discover map read this one rule', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const apply = read('screens/BusinessPartnerApplyScreen.js');
    expect(apply).toMatch(/signupLocationProblem\(\{ mode: locationMode/);
    expect(apply).toMatch(/\.\.\.signupLocationFields\(/);
    expect(apply).not.toMatch(/address: address\.trim\(\) \|\| null,\s*latitude,/);
    const dash = read('screens/BusinessDashboardScreen.js');
    expect(dash).toMatch(/businessLocationWrite\(pending\.mode/);
    expect(dash).toMatch(/businessLocationBanner\(selectedPartner\)/);
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/shownBusinesses\.filter\(hasMapPin\)/);
    expect(read('services/brandOffers.js')).toMatch(/latitude, longitude, location_source, attributes/);
    const mig = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/migrations/20270419_business_service_area.sql'), 'utf8');
    expect(mig).toMatch(/round\(new\.latitude::numeric, 2\)/);
    expect(mig).toMatch(/new\.address := null/);
  });
});
