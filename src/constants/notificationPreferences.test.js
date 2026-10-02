// Item 142: one central store and one check for a person's notification choices.
const fs = require('fs');
const path = require('path');
const {
  NOTIFICATION_AREAS, NOTIFICATION_GROUPS, NOTIFICATION_GROUP_BY_TYPE, NOT_PERSON_MUTABLE_TYPES, LEGACY_COLUMN_GROUPS,
  isMuted, mutesFromOnboardingChoices, toggleGroup, notificationGroupOf,
} = require('./notificationPreferences');
const { NOTIFICATION_PRIORITY_BY_TYPE } = require('./notificationTier');

const root = path.join(__dirname, '..', '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20270258_notification_preferences_central.sql'), 'utf8');

describe('every push type is placed exactly once', () => {
  test('person-mutable groups + business/account types = every push type', () => {
    const placed = [...Object.keys(NOTIFICATION_GROUP_BY_TYPE), ...NOT_PERSON_MUTABLE_TYPES];
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
    const ins = sql.slice(sql.indexOf('insert into public.notification_type_groups'), sql.indexOf('-- Keep what people already chose.'));
    const seed = Object.fromEntries([...ins.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]));
    expect(seed).toEqual(NOTIFICATION_GROUP_BY_TYPE);
  });
  test('the CHECK and the setter accept exactly the groups', () => {
    const check = sql.match(/notification_mutes <@ array\[([\s\S]*?)\]/)[1];
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...NOTIFICATION_GROUPS].sort());
    const setter = sql.match(/group_param not in \(([\s\S]*?)\)/)[1];
    expect([...setter.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...NOTIFICATION_GROUPS].sort());
  });
  test('each older column is derived from exactly its area groups', () => {
    for (const [col, groups] of Object.entries(LEGACY_COLUMN_GROUPS)) {
      const m = sql.match(new RegExp(`new\\.${col} := not \\(m @> array\\[([^\\]]*)\\]`));
      expect(m).not.toBeNull();
      expect([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual(groups);
    }
    expect(Object.values(LEGACY_COLUMN_GROUPS).flat().sort()).toEqual([...NOTIFICATION_GROUPS].sort());
  });
  test('the one sender applies the choice before queueing', () => {
    const send = sql.slice(sql.indexOf('FUNCTION public._send_push'));
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
