// Business location at sign-up, follow-through (owner, 2026-11-15): every place that turns a business's point into a place to
// go (booked-plan directions + ride, gathering prefill, the business's own web map default) skips a business that goes to its
// customers, the Profile summary says which kind it is, and the website sign-up asks the same question as the app.
import fs from 'fs';
import path from 'path';
import { buildPlanSummary } from './planAddonReadiness';
import { businessPlanPrefill } from './businessPlanPrefill';
import { profileSummaryPieces } from './profileSummary';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const future = new Date(Date.now() + 10 * 86400000);
const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const primary = { status: 'fulfilled', category: 'Coffee', date: day(future), time_window_start: '18:30:00', party_size: 2 };
const shop = { name: 'Corner Cafe', address: '12 Ocean Ave', latitude: 26.591234, longitude: -80.043219, location_source: 'host_pin' };
const mobile = { name: 'Mobile Detailing', address: null, latitude: 26.59, longitude: -80.04, location_source: 'service_area' };

describe('a booked plan never sends anyone to a service-area business', () => {
  test('storefront: directions + ride keep the exact point', () => {
    const s = buildPlanSummary({ primary, primaryOffers: [{ status: 'accepted', brand_partners: shop }] });
    expect([s.businessLatitude, s.businessLongitude, s.businessAddress]).toEqual([26.591234, -80.043219, '12 Ocean Ave']);
  });
  test('service area: no point and no address, so no Get Directions and no ride', () => {
    const s = buildPlanSummary({ primary, primaryOffers: [{ status: 'accepted', brand_partners: mobile }] });
    expect([s.businessLatitude, s.businessLongitude, s.businessAddress]).toEqual([null, null, null]);
  });
  test('the per-offer ride links read hasMapPin and every booked-offer read selects location_source', () => {
    expect(read('src/screens/BusinessRequestDetailScreen.js')).toMatch(/hasMapPin\(o\.brand_partners\)/);
    expect(read('src/components/AcceptedBusinessOfferCard.js')).toMatch(/hasMapPin\(offer\.brand_partners\)/);
    for (const f of ['src/services/brandOffers.js', 'src/services/businessFulfillment.js', 'src/services/dateProposals.js']) {
      for (const m of read(f).matchAll(/brand_partners\(([^)]*)\)/g)) {
        if (/latitude/.test(m[1])) expect(m[1]).toMatch(/location_source/);
      }
    }
    expect(read('src/services/brandOffers.js')).toMatch(/select\('id, name, latitude, longitude, location_source, address, attributes, operating_hours/);
  });
});

describe('planning a gathering at a business', () => {
  test('a storefront is offered as the place; a service-area business is not (its area is not a meeting point)', () => {
    expect(businessPlanPrefill({ partner: shop }).place).toEqual({ latitude: 26.591234, longitude: -80.043219, name: 'Corner Cafe' });
    expect(businessPlanPrefill({ partner: mobile }).place).toBeNull();
    expect(businessPlanPrefill({ offer: { title: 'Wash', brand_partners: mobile } }).place).toBeNull();
    // a perk's own point still counts (it is the perk's place, not the business's)
    expect(businessPlanPrefill({ offer: { latitude: 26.7, longitude: -80.1, brand_partners: mobile } }).place).toMatchObject({ latitude: 26.7 });
  });
  test("the business's own web map default skips a service area", () => {
    expect(read('src/screens/SelectGatheringLocationScreen.web.js')).toMatch(/location_source !== 'service_area'/);
  });
});

describe('Profile shows the saved location', () => {
  test('storefront = its address; service area = its mode, never an address', () => {
    expect(profileSummaryPieces('basics', { ...shop })).toEqual(['12 Ocean Ave']);
    expect(profileSummaryPieces('basics', { ...mobile, address: 'should never show' }, { serviceArea: 'We go to customers' })).toEqual(['We go to customers']);
    expect(profileSummaryPieces('basics', {})).toEqual([]);
  });
});

describe('website sign-up asks the same question', () => {
  const html = read('docs/business.html');
  const fn = read('supabase/functions/submit-business-application/index.ts');
  test('the form offers both modes and only a storefront must give an address', () => {
    expect(html).toMatch(/name="locationMode" value="storefront" checked/);
    expect(html).toMatch(/name="locationMode" value="service_area"/);
    expect(html).toMatch(/locationMode === 'storefront' && !address/);
    expect(html).toMatch(/locationMode: locationMode/);
  });
  test('the server stores no address for a service-area application and still requires one for a storefront', () => {
    expect(fn).toMatch(/const goesToCustomers = body\.locationMode === 'service_area';/);
    expect(fn).toMatch(/const address = goesToCustomers \? '' :/);
    expect(fn).toMatch(/if \(!goesToCustomers && \(!address \|\| address\.length > 300\)\)/);
    expect(fn).toMatch(/address: address \|\| null,/);
    // the label alone is stored, so the dashboard asks for a service area; before 20270419 is live the insert retries without it
    expect(fn).toMatch(/\.\.\.\(goesToCustomers \? \{ location_source: 'service_area' \} : \{\}\)/);
    expect(fn).toMatch(/error\?\.code === '23514' && row\.location_source/);
  });
});
