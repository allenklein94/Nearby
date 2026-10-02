// Item 142: one central store and one check for a person's notification choices.
const fs = require('fs');
const path = require('path');
const {
  NOTIFICATION_AREAS, NOTIFICATION_GROUPS, NOTIFICATION_GROUP_BY_TYPE, ACCOUNT_NOTICE_TYPES, LEGACY_COLUMN_GROUPS, OWNER_GROUPS,
  isMuted, mutesFromOnboardingChoices, toggleGroup, notificationGroupOf, visibleNotificationAreas, groupTextKeys, ONBOARDING_AREAS,
} = require('./notificationPreferences');
const { NOTIFICATION_PRIORITY_BY_TYPE } = require('./notificationTier');

const root = path.join(__dirname, '..', '..');
const mig = (f) => fs.readFileSync(path.join(root, 'supabase', 'migrations', f), 'utf8');
const base = mig('20270258_notification_preferences_central.sql'); // derivation trigger, _send_push check
const sql = mig('20270259_business_owner_notification_preferences.sql'); // seed, owner senders (item 143)
const msg = mig('20270260_messages_notification_group.sql'); // current CHECK, setter, derivation; message -> messages

describe('every push type is placed exactly once', () => {
  test('8. person-mutable groups + account notices = every push type, exactly once', () => {
    const placed = [...Object.keys(NOTIFICATION_GROUP_BY_TYPE), ...ACCOUNT_NOTICE_TYPES];
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.sort()).toEqual(Object.keys(NOTIFICATION_PRIORITY_BY_TYPE).sort());
  });
  test('every group used is a real group, and every group has a type', () => {
    for (const g of Object.values(NOTIFICATION_GROUP_BY_TYPE)) expect(NOTIFICATION_GROUPS).toContain(g);
    for (const g of NOTIFICATION_GROUPS) expect(Object.values(NOTIFICATION_GROUP_BY_TYPE)).toContain(g);
  });
  test('an unknown type is never muted', () => {
    expect(notificationGroupOf('brand_new_type')).toBeNull();
    expect(isMuted('brand_new_type', NOTIFICATION_GROUPS)).toBe(false);
  });
});

describe('the database copy is identical', () => {
  test('notification_type_groups seed = NOTIFICATION_GROUP_BY_TYPE', () => {
    const ins = sql.slice(sql.indexOf('insert into public.notification_type_groups'), sql.indexOf('-- Keep what people already chose'));
    const seed = Object.fromEntries([...ins.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]));
    for (const m of msg.matchAll(/update public\.notification_type_groups set group_key = '([a-z_]+)' where type = '([a-z_]+)'/g)) seed[m[2]] = m[1];
    expect(seed).toEqual(NOTIFICATION_GROUP_BY_TYPE);
  });
  test('the CHECK and the setter accept exactly the groups', () => {
    const check = msg.match(/notification_mutes <@ array\[([\s\S]*?)\]/)[1];
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...NOTIFICATION_GROUPS].sort());
    const setter = msg.match(/group_param not in \(([\s\S]*?)\)/)[1];
    expect([...setter.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...NOTIFICATION_GROUPS].sort());
  });
  test('each older column is derived from exactly its area groups', () => {
    for (const [col, groups] of Object.entries(LEGACY_COLUMN_GROUPS)) {
      const m = msg.match(new RegExp(`new\\.${col} := not \\(m @> array\\[([^\\]]*)\\]`));
      expect(m).not.toBeNull();
      expect([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual(groups);
    }
    // Every customer group derives exactly one older column; owner groups derive none (owner senders read only them).
    expect(Object.values(LEGACY_COLUMN_GROUPS).flat().sort()).toEqual(NOTIFICATION_GROUPS.filter((g) => !OWNER_GROUPS.includes(g)).sort());
  });
  test('the one sender applies the choice before queueing', () => {
    const send = base.slice(base.indexOf('FUNCTION public._send_push'));
    expect(send.indexOf('_push_muted')).toBeLessThan(send.indexOf('insert into push_outbox'));
  });
});

describe('client helpers', () => {
  test('toggle keeps canonical order and never duplicates', () => {
    expect(toggleGroup([], 'dating', false)).toEqual(['dating']);
    expect(toggleGroup(['dating', 'dating'], 'dating', true)).toEqual([]);
    expect(toggleGroup(['communities'], 'plans_reminders', false)).toEqual(['plans_reminders', 'communities']);
  });
  test('onboarding area switches (new keys and older column keys) become muted groups', () => {
    expect(mutesFromOnboardingChoices({ plans: false, dating: true })).toEqual(['plans_invitations', 'plans_changes', 'plans_reminders']);
    expect(mutesFromOnboardingChoices({ notify_discovery: false, notify_proximity: false }))
      .toEqual(['discover_recommendations', 'discover_nearby_people']);
    expect(mutesFromOnboardingChoices(undefined)).toEqual([]);
  });
  test('7. onboarding never asks about or mutes a business owner\'s alerts', () => {
    expect(ONBOARDING_AREAS.some((a) => a.ownerOnly)).toBe(false);
    expect(mutesFromOnboardingChoices({ businesses: false, business_owner: false, notify_business: false }))
      .toEqual(['business_offers', 'business_responses']);
  });
  test('every area lists its groups once', () => {
    expect(NOTIFICATION_AREAS.flatMap((a) => a.groups)).toEqual(NOTIFICATION_GROUPS);
  });
});

describe('no screen writes the older columns any more', () => {
  test('Settings and CompleteProfile go through the store', () => {
    for (const f of ['SettingsScreen.js', 'CompleteProfileScreen.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'screens', f), 'utf8');
      expect(src).not.toMatch(/update\(\{\s*\[key\]/);
      expect(src).not.toMatch(/notificationOptOuts/);
      expect(src).not.toMatch(/notify_(planning|social|dating|business|discovery|proximity|community)\b/);
    }
  });
});

// Item 143: customer Businesses and business-owner alerts are independent, even on one account with both roles.
describe('customer Businesses vs Your business (item 143)', () => {
  const CUSTOMER = ['business_offers', 'business_responses'];
  test('1. muting customer Businesses leaves every owner alert on', () => {
    const m = CUSTOMER.reduce((acc, g) => toggleGroup(acc, g, false), []);
    for (const [type, g] of Object.entries(NOTIFICATION_GROUP_BY_TYPE)) if (OWNER_GROUPS.includes(g)) expect(isMuted(type, m)).toBe(false);
    expect(isMuted('business_request_expiring', m)).toBe(false);
    expect(isMuted('business_opportunity_received', m)).toBe(false);
  });
  test('2. muting every owner group leaves customer Businesses alerts on', () => {
    const m = OWNER_GROUPS.reduce((acc, g) => toggleGroup(acc, g, false), []);
    for (const [type, g] of Object.entries(NOTIFICATION_GROUP_BY_TYPE)) if (CUSTOMER.includes(g)) expect(isMuted(type, m)).toBe(false);
  });
  test('3/4. each switch flips only itself, in any order, for one account holding both', () => {
    let m = [];
    m = toggleGroup(m, 'owner_requests', false);
    m = toggleGroup(m, 'business_offers', false);
    expect(m).toEqual(['business_offers', 'owner_requests']);
    m = toggleGroup(m, 'business_offers', true);
    expect(m).toEqual(['owner_requests']);
    m = toggleGroup(m, 'owner_requests', true);
    m = toggleGroup(m, 'business_responses', false);
    expect(m).toEqual(['business_responses']);
  });
  test('5. the request-expiry warning follows the owner "New requests" group', () => {
    expect(notificationGroupOf('business_request_expiring')).toBe('owner_requests');
    expect(isMuted('business_request_expiring', ['owner_requests'])).toBe(true);
    expect(isMuted('business_request_expiring', ['business_offers', 'business_responses'])).toBe(false);
  });
  test('6. customer business alerts still follow the customer groups', () => {
    expect(isMuted('business_offer_received', ['business_offers'])).toBe(true);
    expect(isMuted('business_reservation_confirmed', ['business_responses'])).toBe(true);
    expect(isMuted('business_offer_received', OWNER_GROUPS)).toBe(false);
  });
  test('assigned by recipient, not by the word "business"', () => {
    for (const t of ['business_offer_declined', 'business_offer_withdrawn', 'business_reservation_confirmed', 'business_reservation_cancelled',
      'business_offer_received', 'business_update', 'business_recall_outreach', 'business_request_all_declined', 'business_partnership_response']) {
      expect(OWNER_GROUPS).not.toContain(notificationGroupOf(t));
    }
    for (const t of ['business_opportunity_received', 'business_opportunities_digest', 'business_request_cancelled', 'business_request_expiring',
      'business_offer_accepted', 'business_offer_review_result', 'reservation_cancelled_by_customer', 'aggregated_demand_growing', 'occasion_demand_growing']) {
      expect(OWNER_GROUPS).toContain(notificationGroupOf(t));
    }
  });
  test('the owner area is shown only to an owner, with the dashboard\'s own wording', () => {
    expect(visibleNotificationAreas({ isBusinessOwner: false }).some((a) => a.key === 'business_owner')).toBe(false);
    expect(visibleNotificationAreas({ isBusinessOwner: true }).map((a) => a.key)).toContain('business_owner');
    expect(groupTextKeys('owner_requests').label).toBe('ui.bizComp.notifGroup.requests.label');
    expect(groupTextKeys('dating').label).toBe('ui.notificationPrefs.group.dating.label');
  });
  test('9. owner senders no longer read the customer-derived notify_business; only customer checks keep it', () => {
    const patched = sql.slice(sql.indexOf('-- Owner and account senders'));
    const checks = [...patched.matchAll(/select notify_business from profiles where id = ([\w.\[\]]+)/g)].map((m) => m[1]);
    expect(checks.length).toBeGreaterThan(0);
    for (const who of checks) expect(['r.requester_id', 'v_requester', 'v_request.requester_id']).toContain(who);
    expect(patched).not.toMatch(/p\.notify_business/);
    expect(sql).toMatch(/not \('owner_requests' = any \(p\.notification_mutes\)\)/);
  });
  test('10. existing opt-outs are carried over (old owner store, and a fully-off customer Business switch on an owner)', () => {
    expect(sql).toMatch(/from public\.business_notification_prefs b[\s\S]*'owner_' \|\| g/);
    expect(sql).toMatch(/where managed_partner_id is not null and notification_mutes @> array\['business_offers', 'business_responses'\]/);
  });
  test('only an owner may change an owner group (server)', () => {
    expect(sql).toMatch(/group_param like 'owner\\_%' and not exists \(select 1 from profiles where id = auth\.uid\(\) and managed_partner_id is not null\)/);
  });
});
