// Item 143: the dashboard's owner groups are a VIEW of the one store and the one type table, never a second mapping.
import fs from 'fs';
import path from 'path';
import { BUSINESS_NOTIFICATION_GROUP_BY_TYPE, BUSINESS_NOTIFICATION_GROUPS } from './businessNotificationGroups';
import { NOTIFICATION_GROUP_BY_TYPE, OWNER_GROUPS } from './notificationPreferences';

describe('business-owner notification groups', () => {
  it('each dashboard group is exactly one owner group of the one store', () => {
    expect(BUSINESS_NOTIFICATION_GROUPS.map((g) => g.group)).toEqual(OWNER_GROUPS);
    for (const g of BUSINESS_NOTIFICATION_GROUPS) expect(g.group).toBe(`owner_${g.key}`);
  });
  it('the short-key map is derived from the central table', () => {
    for (const [type, k] of Object.entries(BUSINESS_NOTIFICATION_GROUP_BY_TYPE)) expect(NOTIFICATION_GROUP_BY_TYPE[type]).toBe(`owner_${k}`);
  });
  it('customer-recipient types are never owner types (the old map listed four of them)', () => {
    for (const t of ['business_offer_declined', 'business_offer_withdrawn', 'business_reservation_confirmed',
      'business_reservation_cancelled', 'business_offer_received', 'business_update', 'business_partnership_response']) {
      expect(BUSINESS_NOTIFICATION_GROUP_BY_TYPE[t]).toBeUndefined();
    }
  });
  it('keeps account notices unmutable', () => {
    for (const t of ['business_partner_approved', 'business_partner_denied', 'business_partner_needs_info']) {
      expect(NOTIFICATION_GROUP_BY_TYPE[t]).toBeUndefined();
    }
  });
  it('send-push holds no copy of any mute map', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../supabase/functions/send-push/index.ts'), 'utf8');
    expect(src).not.toMatch(/BUSINESS_NOTIFICATION_GROUP_BY_TYPE|business_notification_prefs/);
  });
});
