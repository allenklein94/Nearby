// Notification settings UX (owner, 2026-10-02): the same 15 switches, drawn in a few plain sections. Display only: the
// storage, the type table and the one sender (_send_push) are unchanged. These tests check that the screen reflects the
// central mapping and that one switch changes only its own notification types.
const fs = require('fs');
const path = require('path');
import {
  SETTINGS_SECTIONS, visibleSettingsSections, typesForGroup, NOTIFICATION_GROUPS, NOTIFICATION_GROUP_BY_TYPE,
  ACCOUNT_NOTICE_TYPES, OWNER_GROUPS, groupTextKeys, toggleGroup, isMuted, NOTIFICATION_AREAS,
} from './notificationPreferences';
import { translate, hasOwnTranslation } from '../i18n/translate';

const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko'];
const settings = fs.readFileSync(path.join(__dirname, '..', 'screens', 'SettingsScreen.js'), 'utf8');

describe('sections reflect the central mapping', () => {
  test('a few sections, every switch in exactly one', () => {
    expect(SETTINGS_SECTIONS.length).toBeLessThanOrEqual(5);
    const drawn = SETTINGS_SECTIONS.flatMap((s) => s.groups);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect([...drawn].sort()).toEqual([...NOTIFICATION_GROUPS].sort());
  });
  test('no section and no switch is empty', () => {
    for (const s of SETTINGS_SECTIONS) expect(s.groups.length).toBeGreaterThan(0);
    for (const g of NOTIFICATION_GROUPS) expect(typesForGroup(g).length).toBeGreaterThan(0);
  });
  test('every notification type is behind exactly one switch, except the three mandatory account notices', () => {
    const behindSwitch = NOTIFICATION_GROUPS.flatMap(typesForGroup);
    expect(new Set(behindSwitch).size).toBe(behindSwitch.length);
    expect(behindSwitch.sort()).toEqual(Object.keys(NOTIFICATION_GROUP_BY_TYPE).sort());
    for (const t of ACCOUNT_NOTICE_TYPES) expect(behindSwitch).not.toContain(t);
    expect(ACCOUNT_NOTICE_TYPES).toHaveLength(3);
  });
  test('the separate switches the owner asked to keep are still their own switches', () => {
    const where = (g) => SETTINGS_SECTIONS.find((s) => s.groups.includes(g)).key;
    expect(typesForGroup('friends_occasions')).toEqual(expect.arrayContaining(['birthday', 'birthday_upcoming']));
    expect(typesForGroup('dating')).toEqual(expect.arrayContaining(['message', 'new_match']));
    expect(typesForGroup('discover_nearby_people')).toEqual(['crossed_paths_sighting']);
    expect(where('friends_occasions')).toBe('people');
    expect(where('dating')).toBe('people');
    expect(where('discover_nearby_people')).toBe('people');
  });
  test('business-owner alerts stay separate from customer business alerts', () => {
    const owner = SETTINGS_SECTIONS.find((s) => s.key === 'business_owner');
    expect(owner.ownerOnly).toBe(true);
    expect([...owner.groups].sort()).toEqual([...OWNER_GROUPS].sort());
    for (const s of SETTINGS_SECTIONS.filter((x) => x !== owner)) {
      for (const g of s.groups) expect(OWNER_GROUPS).not.toContain(g);
    }
    expect(SETTINGS_SECTIONS.find((s) => s.key === 'businesses').groups).toEqual(['business_offers', 'business_responses']);
  });
  test('only a business owner sees the owner section', () => {
    expect(visibleSettingsSections({ isBusinessOwner: false }).map((s) => s.key)).toEqual(['plans', 'people', 'nearby', 'businesses']);
    expect(visibleSettingsSections({ isBusinessOwner: true }).map((s) => s.key)).toContain('business_owner');
    expect(visibleSettingsSections().some((s) => s.ownerOnly)).toBe(false);
  });
  test('storage areas (older columns, onboarding) are untouched by the regrouping', () => {
    expect(NOTIFICATION_AREAS.map((a) => a.key)).toEqual(['plans', 'friends', 'dating', 'businesses', 'discover', 'communities', 'business_owner']);
  });
});

describe('one switch changes only its own types', () => {
  test.each(NOTIFICATION_GROUPS)('turning off %s mutes exactly its types, and turning it back on restores them', (g) => {
    const off = toggleGroup([], g, false);
    expect(off).toEqual([g]);
    for (const [type, group] of Object.entries(NOTIFICATION_GROUP_BY_TYPE)) expect(isMuted(type, off)).toBe(group === g);
    for (const t of ACCOUNT_NOTICE_TYPES) expect(isMuted(t, off)).toBe(false);
    expect(toggleGroup(off, g, true)).toEqual([]);
  });
  test('toggling one switch never changes another switch', () => {
    const everyOtherOff = NOTIFICATION_GROUPS.filter((x) => x !== 'dating');
    expect(toggleGroup(everyOtherOff, 'dating', false).sort()).toEqual([...NOTIFICATION_GROUPS].sort());
    expect(toggleGroup(NOTIFICATION_GROUPS, 'dating', true).sort()).toEqual(everyOtherOff.sort());
  });
  test('even with every switch off, the account notices still arrive', () => {
    for (const t of ACCOUNT_NOTICE_TYPES) expect(isMuted(t, NOTIFICATION_GROUPS)).toBe(false);
  });
});

describe('plain labels in every language', () => {
  test('each section and switch has its own label and hint in all 11 languages', () => {
    for (const lang of LANGS) {
      for (const s of SETTINGS_SECTIONS) {
        expect(hasOwnTranslation(lang, `ui.notificationPrefs.section.${s.key}.label`)).toBe(true);
        expect(hasOwnTranslation(lang, `ui.notificationPrefs.section.${s.key}.hint`)).toBe(true);
      }
      for (const g of NOTIFICATION_GROUPS) {
        const k = groupTextKeys(g);
        expect(hasOwnTranslation(lang, k.label)).toBe(true);
        expect(hasOwnTranslation(lang, k.hint)).toBe(true);
      }
    }
  });
  test('no two switches share a label (in any language)', () => {
    for (const lang of LANGS) {
      const labels = NOTIFICATION_GROUPS.map((g) => translate(lang, groupTextKeys(g).label));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
  test('English labels say what they control', () => {
    const en = (g) => translate('en', groupTextKeys(g).label);
    expect(en('plans_changes')).toBe('Changes to your plans');
    expect(en('friends_activity')).toBe('Friend requests and activity');
    expect(en('dating')).toBe('Dating matches and messages');
    expect(en('communities')).toBe('Communities you lead');
    expect(en('business_responses')).toBe('Replies to your requests');
    expect(en('discover_nearby_people')).toBe('People you cross paths with');
    expect(en('friends_occasions')).toBe('Birthdays and occasions');
  });
});

describe('the Settings screen draws the sections and enforces nothing itself', () => {
  test('it renders from visibleSettingsSections with section wording', () => {
    expect(settings).toMatch(/visibleSettingsSections\(\{ isBusinessOwner \}\)/);
    expect(settings).toMatch(/ui\.notificationPrefs\.section\.\$\{area\.key\}\.label/);
    expect(settings).not.toMatch(/visibleNotificationAreas/);
    expect(settings).not.toMatch(/ui\.notificationPrefs\.area\./);
  });
  test('a switch only writes its group through the one setter; no per-type check in the screen', () => {
    expect(settings).toMatch(/onValueChange=\{\(v\) => toggleNotificationGroup\(g, v\)\}/);
    expect(settings).toMatch(/setMyNotificationGroup\(group, enabled\)/);
    expect(settings).not.toMatch(/\bisMuted\(/);
    expect(settings).not.toMatch(/NOTIFICATION_GROUP_BY_TYPE/);
    expect(settings).not.toMatch(/notification_mutes['"]?\s*[:,]\s*\[/); // never writes the store directly
  });
});
