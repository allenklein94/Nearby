// Item 141: notification priority (high / medium / low). Every push type is classified once, the server delivers from an
// identical copy, and the owner's examples hold.
const fs = require('fs');
const path = require('path');
const {
  NOTIFICATION_PRIORITIES, NOTIFICATION_PRIORITY_BY_TYPE, notificationPriority, PRIORITY_DELIVERY, ANDROID_NOTIFICATION_CHANNELS,
} = require('./notificationTier');

const destSrc = fs.readFileSync(path.join(__dirname, '..', 'navigation', 'notificationDestinations.js'), 'utf8');
const TYPES = [...destSrc.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
const pushSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'send-push', 'index.ts'), 'utf8');
const block = (name) => pushSrc.slice(pushSrc.indexOf(`const ${name} = {`), pushSrc.indexOf('};', pushSrc.indexOf(`const ${name} = {`)) + 2);

describe('every push type has exactly one priority', () => {
  test('the table covers every type the app handles, and nothing else', () => {
    expect(TYPES).toHaveLength(88);
    expect(Object.keys(NOTIFICATION_PRIORITY_BY_TYPE).sort()).toEqual([...TYPES].sort());
    for (const p of Object.values(NOTIFICATION_PRIORITY_BY_TYPE)) expect(NOTIFICATION_PRIORITIES).toContain(p);
  });
  test('a future, unclassified type is delivered and visible but never interrupts', () => {
    expect(notificationPriority('some_brand_new_push_type')).toBe('medium');
  });
});

describe("the owner's examples", () => {
  test('high: a business responded, it starts soon, a deadline is close', () => {
    expect(notificationPriority('business_offer_received')).toBe('high'); // Business responded
    expect(notificationPriority('social_offer_received')).toBe('high');
    expect(notificationPriority('gathering_reminder')).toBe('high'); // Gathering starts soon
    expect(notificationPriority('business_request_expiring')).toBe('high'); // the only expiring-deadline push that exists
  });
  test('medium: a friend\'s activity (a friend JOINING; "interested" is private and never pushed)', () => {
    expect(notificationPriority('friend_joined_gathering')).toBe('medium');
    expect(TYPES.some((t) => /interested/.test(t))).toBe(false);
  });
  test('low: trending / recommended nearby', () => {
    expect(notificationPriority('recommended_gathering')).toBe('low');
    expect(notificationPriority('recurring_gathering')).toBe('low');
    expect(notificationPriority('recommended_business_availability')).toBe('low');
    expect(notificationPriority('group_intent_signal')).toBe('low');
  });
  test('discovery never interrupts; nothing about another person is ever low enough to vanish into a digest', () => {
    for (const t of ['aggregated_demand_growing', 'occasion_demand_growing', 'community_area_demand_growing', 'momentum_streak_nudge']) {
      expect(notificationPriority(t)).toBe('low');
    }
    for (const t of ['friend_request', 'gathering_invite', 'group_plan_invite', 'date_proposal']) expect(notificationPriority(t)).toBe('medium');
  });
});

describe('delivery', () => {
  test('high interrupts, medium is silent but visible, low is silent and passive', () => {
    expect(PRIORITY_DELIVERY.high).toEqual({ sound: 'default', priority: 'high', channelId: 'important-alerts', interruptionLevel: 'active' });
    expect(PRIORITY_DELIVERY.medium).toEqual({ sound: null, priority: 'default', channelId: 'updates', interruptionLevel: 'active' });
    expect(PRIORITY_DELIVERY.low).toEqual({ sound: null, priority: 'normal', channelId: 'recommendations', interruptionLevel: 'passive' });
    for (const p of NOTIFICATION_PRIORITIES) expect(PRIORITY_DELIVERY[p].channelId).toBe(ANDROID_NOTIFICATION_CHANNELS[p]);
  });
  test('send-push carries identical copies and delivers from them', () => {
    const map = Object.fromEntries([...block('NOTIFICATION_PRIORITY_BY_TYPE').matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
    expect(map).toEqual({ ...NOTIFICATION_PRIORITY_BY_TYPE });
    // eslint-disable-next-line no-new-func
    const delivery = new Function(`${block('PRIORITY_DELIVERY')}; return PRIORITY_DELIVERY;`)();
    expect(delivery).toEqual(PRIORITY_DELIVERY);
    expect(pushSrc).toMatch(/return NOTIFICATION_PRIORITY_BY_TYPE\[type\] \?\? 'medium';/);
    expect(pushSrc).toMatch(/const delivery = PRIORITY_DELIVERY\[notifPriority\];/);
    expect(pushSrc).toMatch(/\.\.\.delivery,/);
    expect(pushSrc).not.toMatch(/RECOMMENDATION_TYPES|isImportant/);
    // the web-only business owner's email fallback skips only low priority (plus the digest, which it always needs)
    expect(pushSrc).toMatch(/if \(notifPriority !== 'low' \|\| EMAIL_EXTRA_TYPES\.has\(data\?\.type\)\)/);
  });
  test('the app creates one Android channel per priority, with matching importance', () => {
    const n = fs.readFileSync(path.join(__dirname, '..', 'services', 'notifications.js'), 'utf8');
    expect(n).toMatch(/ANDROID_NOTIFICATION_CHANNELS\.high, \{\s*name: 'Time-sensitive',\s*importance: Notifications\.AndroidImportance\.HIGH/);
    expect(n).toMatch(/ANDROID_NOTIFICATION_CHANNELS\.medium, \{\s*name: 'Updates',\s*importance: Notifications\.AndroidImportance\.DEFAULT,\s*sound: null,\s*enableVibrate: false/);
    expect(n).toMatch(/ANDROID_NOTIFICATION_CHANNELS\.low, \{\s*name: 'Recommendations',\s*importance: Notifications\.AndroidImportance\.LOW/);
  });
});
