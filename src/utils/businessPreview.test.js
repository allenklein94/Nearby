// Owner item 17 (2026-10-04, LOCKED): the business sheet on Discover's browsing surfaces is a lightweight preview, not a screen
// and not a mini Business Profile; its action is the business's own booking-mode action, never a hardcoded "Ask for Offer".
import fs from 'fs';
import path from 'path';
import { businessPreview, businessPreviewRoute, PREVIEW_MAX_QUALITIES } from './businessPreview';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HOURS = {
  timezone: 'America/Los_Angeles',
  week: { sun: 'closed', mon: [['09:00', '21:00']], tue: [['09:00', '21:00']], wed: [['09:00', '21:00']], thu: [['09:00', '21:00']], fri: [['09:00', '21:00']], sat: 'closed' },
};
const MON_10AM = new Date('2026-09-28T17:00:00Z');
const biz = (over = {}) => ({
  id: 'b1', name: 'Coastal Coffee', latitude: 34, longitude: -118, subcategory: 'Coffee', distanceMiles: 0.8, operating_hours: HOURS, ...over,
});

describe('what the sheet shows (each line only when real)', () => {
  test('the owner example: name, distance, open status, a declared quality', () => {
    const p = businessPreview(biz({ attributes: ['outdoor_seating'] }), { at: MON_10AM });
    expect(p).toMatchObject({ id: 'b1', title: 'Coastal Coffee', distance: '0.8 mi', hours: 'Open now · until 9 PM', qualities: ['Outdoor Seating'] });
  });
  test('no measured distance, no declared hours, no qualities = those lines absent, never placeholders', () => {
    const p = businessPreview(biz({ distanceMiles: null, operating_hours: null, attributes: [] }), { at: MON_10AM });
    expect(p.distance).toBeNull();
    expect(p.hours).toBeNull();
    expect(p.qualities).toEqual([]);
  });
  test('at most two declared qualities; the legacy reservation attribute is never one', () => {
    const p = businessPreview(biz({ attributes: ['reservation_required', 'quiet', 'wifi', 'dog_friendly'] }), { at: MON_10AM });
    expect(p.qualities).toHaveLength(PREVIEW_MAX_QUALITIES);
    expect(p.qualities.join(' ')).not.toMatch(/reservation/i);
  });
  test('nothing without a business id', () => {
    expect(businessPreview(null)).toBeNull();
    expect(businessPreview({ name: 'x' })).toBeNull();
  });
});

describe('the action is the business\'s own (items 72/73), never hardcoded', () => {
  const kind = (over) => businessPreview(biz(over), { at: MON_10AM }).action.kind;
  test('per booking mode', () => {
    expect(kind({ booking_mode: 'walk_in' })).toBe('go_now');
    expect(kind({ booking_mode: 'reservation_recommended' })).toBe('reserve');
    expect(kind({ booking_mode: 'reservation_required' })).toBe('book');
    expect(kind({ booking_mode: 'request_required' })).toBe('request');
  });
  test('no mode declared = Get an offer, a request addressed to this one business', () => {
    const p = businessPreview(biz(), { at: MON_10AM });
    expect(p.action).toEqual({ kind: 'get_offer', label: 'Get an offer' });
    expect(businessPreviewRoute(biz(), p.action)).toEqual({
      kind: 'navigate', screen: 'AskBusiness',
      params: { prefillCategory: 'Coffee', targetPartner: { id: 'b1', name: 'Coastal Coffee' } },
    });
  });
  test('Book / Request use the same route the business profile uses; Go now opens directions', () => {
    const book = businessPreview(biz({ booking_mode: 'reservation_required' }), { at: MON_10AM }).action;
    expect(businessPreviewRoute(biz({ booking_mode: 'reservation_required' }), book)).toMatchObject({
      kind: 'navigate', screen: 'AskBusiness', params: { targetPartner: { id: 'b1', name: 'Coastal Coffee' }, bookingMode: 'reservation_required' },
    });
    const go = businessPreview(biz({ booking_mode: 'walk_in' }), { at: MON_10AM }).action;
    expect(businessPreviewRoute(biz({ booking_mode: 'walk_in' }), go).kind).toBe('url');
  });
  test('no "Ask for Offer" label anywhere in the sheet', () => {
    expect(read('src/components/BusinessPreviewSheet.js') + read('src/utils/businessPreview.js')).not.toMatch(/Ask for (an )?Offer/i);
  });
});

describe('where the sheet is used (business browsing on Discover only)', () => {
  const discover = read('src/screens/DiscoverHubScreen.js');
  test('Discover business rows and map pins open the sheet, not the full profile', () => {
    expect(discover).toMatch(/onSelectBusiness=\{\(b\) => setPreviewBusiness\(b\)\}/);
    expect(discover).toMatch(/key=\{`biz-\$\{b\.id\}`\}[\s\S]{0,120}onPress=\{\(\) => setPreviewBusiness\(b\)\}/);
    expect(discover).toMatch(/<BusinessPreviewSheet partner=\{previewBusiness\}/);
    expect(discover).toMatch(/useFocusEffect\(useCallback\(\(\) => \(\) => setPreviewBusiness\(null\), \[\]\)\)/); // never left over another screen
  });
  test('a business map pin opens the sheet in one tap (no label step promising a profile)', () => {
    const map = read('src/components/GatheringsMapView.js');
    const block = map.slice(map.indexOf('key={`business-${b.id}`}'), map.indexOf('pinnableStories.map'));
    expect(block).toMatch(/onPress=\{\(\) => onSelectBusiness\(b\)\}/);
    expect(block).not.toMatch(/<Callout|tapToViewProfile/);
  });
  test('Discover is the only user: Home typed-ask results, perks and gatherings keep their own patterns', () => {
    const SRC = path.join(ROOT, 'src');
    const users = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.js$/.test(f.name) && !/\.test\.js$/.test(f.name) && /BusinessPreviewSheet/.test(fs.readFileSync(full, 'utf8'))) users.push(path.relative(SRC, full));
      }
    };
    walk(SRC);
    expect(users.sort()).toEqual(['components/BusinessPreviewSheet.js', 'screens/DiscoverHubScreen.js']);
  });
  test('the sheet is a presentation, not a data source: no fetch, no service, no second business model', () => {
    const sheet = read('src/components/BusinessPreviewSheet.js') + read('src/utils/businessPreview.js');
    expect(sheet).not.toMatch(/services\/|supabase/);
  });
});
