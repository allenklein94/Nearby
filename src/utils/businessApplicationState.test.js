// One business application, one screen (screen-reduction audit 2026-10-24, owner approved item 1).
import { applicationView, showsReviewerNote, resendFormFrom, APPLICATION_STATUS_COPY } from './businessApplicationState';

describe('applicationView: the stored row decides what BusinessPartnerApply shows', () => {
  test('no application = apply', () => {
    expect(applicationView(null)).toBe('apply');
    expect(applicationView(undefined)).toBe('apply');
  });

  test('each stored status is its own view', () => {
    expect(applicationView({ status: 'pending' })).toBe('pending');
    expect(applicationView({ status: 'approved' })).toBe('approved');
    expect(applicationView({ status: 'denied' })).toBe('denied');
    expect(applicationView({ status: 'needs_info' })).toBe('needs_info');
  });

  test('a declined application offers a new one in place; nothing else can be restarted', () => {
    expect(applicationView({ status: 'denied' }, { startingNew: true })).toBe('apply');
    for (const status of ['pending', 'approved', 'needs_info']) {
      expect(applicationView({ status }, { startingNew: true })).toBe(status);
    }
  });

  test('an unknown status reads as pending, never as a blank form that would insert a second application', () => {
    expect(applicationView({ status: 'something_new' })).toBe('pending');
    expect(applicationView({})).toBe('pending');
  });

  test('every non-apply view has its status words', () => {
    for (const view of ['pending', 'approved', 'denied', 'needs_info']) {
      expect(APPLICATION_STATUS_COPY[view].title).toBeTruthy();
      expect(APPLICATION_STATUS_COPY[view].body).toBeTruthy();
    }
  });
});

describe('the reviewer note', () => {
  test('shown only where the person can act on it, and only when there is one', () => {
    expect(showsReviewerNote('denied', { admin_notes: 'Add a website' })).toBe(true);
    expect(showsReviewerNote('needs_info', { admin_notes: 'Add a website' })).toBe(true);
    expect(showsReviewerNote('pending', { admin_notes: 'x' })).toBe(false);
    expect(showsReviewerNote('approved', { admin_notes: 'x' })).toBe(false);
    expect(showsReviewerNote('denied', { admin_notes: null })).toBe(false);
  });
});

describe('resendFormFrom: the Apply form, prefilled from the stored row', () => {
  test('carries the eight fields resubmit_business_partner_request saves', () => {
    const row = {
      business_name: 'Coastal Coffee', business_description: 'Coffee by the beach', contact_info: 'hi@coastal.test',
      category: 'food_drink', website: 'https://coastal.test', phone: '555', address: '1 Ocean Blvd', requested_features: ['offers'],
      subcategory: 'Coffee', attributes: ['outdoor_seating'],
    };
    expect(resendFormFrom(row)).toEqual({
      businessName: 'Coastal Coffee', description: 'Coffee by the beach', contactInfo: 'hi@coastal.test', category: 'food_drink',
      website: 'https://coastal.test', phone: '555', address: '1 Ocean Blvd', requestedFeatures: ['offers'],
    });
  });

  test('missing values become empty fields, never "null"', () => {
    expect(resendFormFrom({ business_name: 'X' })).toEqual({
      businessName: 'X', description: '', contactInfo: '', category: null, website: '', phone: '', address: '', requestedFeatures: [],
    });
  });
});
