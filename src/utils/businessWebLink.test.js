// Website-only business owners (owner, 2026-11-14): profile on the website, alert emails that open the exact request.
import fs from 'fs';
import path from 'path';
import {
  BUSINESS_WEB_ROUTES, businessWebDestination, businessWebLinkUrl, captureBusinessWebLink, parseBusinessWebLink,
  takeBusinessWebLink,
} from './businessWebLink';

jest.mock('../services/supabase', () => ({ supabase: {}, functionUrl: (n) => n }));
jest.mock('../services/celebrateSomething', () => ({ extractNameFromBirthdayTitle: () => null }));

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const RID = '3f1c2b9a-1d2e-4f5a-8b9c-0d1e2f3a4b5c';
const BID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

function fakeWindow(search) {
  const store = new Map();
  const win = {
    location: { search, pathname: '/Nearby/business/', hash: '' },
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    history: { replaceState: jest.fn((_s, _t, url) => { win.location.search = url.includes('?') ? url.slice(url.indexOf('?')) : ''; }) },
  };
  return win;
}

describe('parse', () => {
  test('a well-formed link', () => {
    expect(parseBusinessWebLink(`?n=business_opportunity_received&r=${RID}`)).toEqual({ type: 'business_opportunity_received', requestId: RID, businessId: null });
    expect(parseBusinessWebLink(`?n=business_request_expiring&r=${RID.toUpperCase()}`)).toEqual({ type: 'business_request_expiring', requestId: RID, businessId: null });
  });
  test('a link naming its location (20270424), with or without a request', () => {
    expect(parseBusinessWebLink(`?n=business_offer_accepted&r=${RID}&b=${BID.toUpperCase()}`)).toEqual({ type: 'business_offer_accepted', requestId: RID, businessId: BID });
    expect(parseBusinessWebLink(`?n=business_offer_review_result&b=${BID}`)).toEqual({ type: 'business_offer_review_result', requestId: null, businessId: BID });
    expect(parseBusinessWebLink(`?n=business_offer_accepted&r=${RID}&b=nope`)).toBeNull();
  });
  test.each(['', '?n=x', `?r=${RID}`, '?n=Bad-Type&r=' + RID, '?n=business_offer_accepted&r=not-a-uuid', `?b=${BID}`, `?n=${'a'.repeat(65)}&r=${RID}`, null])(
    'malformed %p = null (plain dashboard)', (search) => expect(parseBusinessWebLink(search)).toBeNull(),
  );
});

describe('the email link', () => {
  test('one request = a link to it; anything else = the plain dashboard address', () => {
    const base = 'https://example.org/Nearby/business/';
    expect(businessWebLinkUrl(base, 'business_opportunity_received', RID)).toBe(`${base}?n=business_opportunity_received&r=${RID}`);
    expect(businessWebLinkUrl(`${base}?x=1`, 'business_opportunity_received', RID)).toBe(`${base}?x=1&n=business_opportunity_received&r=${RID}`);
    expect(businessWebLinkUrl(base, 'business_opportunities_digest', undefined)).toBe(base);
    expect(businessWebLinkUrl(base, 'business_opportunity_received', 'nope')).toBe(base);
    expect(businessWebLinkUrl(undefined, 'business_opportunity_received', RID)).toBeNull();
  });
  test('the location the alert is about rides along (20270424); a location alone still links', () => {
    const base = 'https://example.org/Nearby/business/';
    expect(businessWebLinkUrl(base, 'business_offer_accepted', RID, BID)).toBe(`${base}?n=business_offer_accepted&r=${RID}&b=${BID}`);
    expect(businessWebLinkUrl(base, 'business_offer_review_result', undefined, BID)).toBe(`${base}?n=business_offer_review_result&b=${BID}`);
    expect(businessWebLinkUrl(base, 'business_offer_accepted', RID, 'nope')).toBe(`${base}?n=business_offer_accepted&r=${RID}`);
    expect(parseBusinessWebLink(new URL(businessWebLinkUrl(base, 'business_offer_accepted', RID, BID)).search)).toEqual({ type: 'business_offer_accepted', requestId: RID, businessId: BID });
  });

  test('send-push builds exactly the same link and puts it in the email', () => {
    const src = read('supabase/functions/send-push/index.ts');
    const block = src.slice(src.indexOf('const LINK_UUID'), src.indexOf('function notificationPriority'));
    // eslint-disable-next-line no-new-func
    const denoBuilder = new Function(`${block}; return businessWebLinkUrl;`)();
    const base = 'https://example.org/Nearby/business/';
    for (const [type, id, b] of [['business_opportunity_received', RID], ['business_request_expiring', RID, BID], ['business_opportunities_digest', undefined], ['business_opportunities_digest', undefined, BID], ['x', 'bad', 'bad'], [undefined, RID, BID]]) {
      expect(denoBuilder(base, type, id, b)).toBe(businessWebLinkUrl(base, type, id, b));
    }
    expect(src).toMatch(/businessWebLinkUrl\(webUrl, data\?\.type, isMessage \? data\?\.message_id : data\?\.request_id, data\?\.partner_id\)/);
    expect(src).toMatch(/Open this request: \$\{linked\}/);
  });

  test('the link carries no personal data: only the type, the request id and the business id', () => {
    const url = new URL(businessWebLinkUrl('https://example.org/b/', 'business_opportunity_received', RID, BID));
    expect([...url.searchParams.keys()].sort()).toEqual(['b', 'n', 'r']);
  });
});

describe('kept across sign-in, opened once', () => {
  test('captured at start, removed from the address bar, read once', () => {
    const win = fakeWindow(`?n=business_opportunity_received&r=${RID}&utm=x`);
    expect(captureBusinessWebLink(win)).toEqual({ type: 'business_opportunity_received', requestId: RID, businessId: null });
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/Nearby/business/?utm=x');
    expect(takeBusinessWebLink(win)).toEqual({ type: 'business_opportunity_received', requestId: RID, businessId: null });
    expect(takeBusinessWebLink(win)).toBeNull(); // a later visit never reopens it
  });

  test('no link = nothing stored, address untouched', () => {
    const win = fakeWindow('');
    expect(captureBusinessWebLink(win)).toBeNull();
    expect(win.history.replaceState).not.toHaveBeenCalled();
    expect(takeBusinessWebLink(win)).toBeNull();
  });

  test('a malformed or invalid link still leaves the address bar, nothing stored, other parameters kept (staging Test 6)', () => {
    for (const q of ['?n=business_message_received&r=not-a-uuid', `?n=BAD TYPE&r=${RID}`, '?n=business_message_received',
      `?r=${RID}`, '?b=zzz', `?n=business_message_received&r=${RID}&b=bad`]) {
      const win = fakeWindow(`${q}&utm=x`);
      expect(captureBusinessWebLink(win)).toBeNull();
      expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/Nearby/business/?utm=x');
      expect(takeBusinessWebLink(win)).toBeNull();
    }
    const plain = fakeWindow('?utm=x');
    expect(captureBusinessWebLink(plain)).toBeNull();
    expect(plain.history.replaceState).not.toHaveBeenCalled();
  });

  test('blocked storage never throws (the dashboard still opens)', () => {
    const win = fakeWindow(`?n=business_opportunity_received&r=${RID}`);
    win.sessionStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(() => captureBusinessWebLink(win)).not.toThrow();
    expect(takeBusinessWebLink(win)).toBeNull();
    expect(captureBusinessWebLink(null)).toBeNull();
  });

  test('a tampered stored value is ignored', () => {
    const win = fakeWindow('');
    win.sessionStorage.setItem('nearby.businessWebLink', JSON.stringify({ type: 'x', requestId: 'javascript:alert(1)' }));
    expect(takeBusinessWebLink(win)).toBeNull();
  });
});

describe('destination = the push table, limited to the website', () => {
  test('a new opportunity opens Opportunities on that request (same as the push)', async () => {
    expect(await businessWebDestination({ type: 'business_opportunity_received', requestId: RID }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests', focusRequestId: RID } });
    expect(await businessWebDestination({ type: 'business_offer_accepted', requestId: RID }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests', focusRequestId: RID } });
  });

  test('a screen the website lacks = Opportunities, never a crash', async () => {
    // business_reservation_cancelled opens BusinessRequestDetail in the app; the website has no such screen.
    expect(await businessWebDestination({ type: 'business_reservation_cancelled', requestId: RID }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests' } });
    expect(await businessWebDestination({ type: 'message', requestId: RID }))
      .toEqual({ name: 'BusinessDashboard', params: { initialSection: 'requests' } });
    expect(await businessWebDestination(null)).toEqual({ name: 'BusinessDashboard' });
  });

  test('every website route named here is really registered on the website', () => {
    const nav = read('src/navigation/BusinessWebNavigator.js');
    for (const name of BUSINESS_WEB_ROUTES) expect(nav).toMatch(new RegExp(`name="${name}"`));
  });
});

describe('profile on the website (no app install)', () => {
  const nav = read('src/navigation/BusinessWebNavigator.js');
  test('signed in without a profile = the app\'s own CompleteProfile screen, before the dashboard', () => {
    expect(nav).toMatch(/!session \? \([\s\S]*?name="Login"[\s\S]*?\) : !profileComplete \? \([\s\S]*?name="CompleteProfile" component=\{CompleteProfileScreen\}/);
    expect(nav).toMatch(/captureBusinessWebLink\(\)/);
  });

  test('the not-linked message no longer sends people to the app', () => {
    const home = read('src/screens/BusinessWebHomeScreen.js');
    expect(home).not.toMatch(/download the/i);
    expect(home).toMatch(/takeBusinessWebLink\(\)/);
    expect(home).toMatch(/businessWebDestination\(link\)/);
  });

  test('the profile-created claim is what links the business (no new path)', () => {
    const migration = read('supabase/migrations/20260829_business_web_application.sql');
    expect(migration).toMatch(/create trigger on_profile_created_claim_web_business/);
    expect(migration).toMatch(/_claim_web_business_requests\(new\.id\)/);
  });

  test('CompleteProfile uses the browser\'s date field on web, keeps the 18+ limit, native picker unchanged', () => {
    const cp = read('src/screens/CompleteProfileScreen.js');
    expect(cp).toMatch(/Platform\.OS === 'web' \? \(\s*<PlatformDateTimeInput[\s\S]*?maximumDate=\{maxSelectableDate\}/);
    expect(cp).toMatch(/<DateTimePicker\s+value=\{birthdate \|\| maxSelectableDate\}/);
    const input = read('src/components/PlatformDateTimeInput.js');
    expect(input).toMatch(/max=\{maximumDate \? toLocalInputValue\(maximumDate, mode\) : undefined\}/);
  });
});
