// Notification settings UX (owner, 2026-10-02): the same switches (17: Messages and Video calls split out of Dating), drawn in a few plain sections. Display only: the
// storage, the type table and the one sender (_send_push) are unchanged. These tests check that the screen reflects the
// central mapping and that one switch changes only its own notification types.
const fs = require('fs');
const path = require('path');
import {
  SETTINGS_SECTIONS, visibleSettingsSections, typesForGroup, NOTIFICATION_GROUPS, NOTIFICATION_GROUP_BY_TYPE,
  ACCOUNT_NOTICE_TYPES, OWNER_GROUPS, groupTextKeys, toggleGroup, isMuted, NOTIFICATION_AREAS, mutesFromOnboardingChoices,
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
    expect(typesForGroup('messages')).toEqual(['message']);
    expect(typesForGroup('video_calls')).toEqual(['video_call']);
    expect(typesForGroup('dating')).toEqual(expect.arrayContaining(['new_match', 'wave']));
    expect(typesForGroup('dating')).not.toContain('message');
    expect(typesForGroup('dating')).not.toContain('video_call');
    expect(typesForGroup('discover_nearby_people')).toEqual(['crossed_paths_sighting']);
    expect(where('friends_occasions')).toBe('people');
    expect(where('dating')).toBe('people');
    expect(where('messages')).toBe('people');
    expect(where('video_calls')).toBe('people');
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
  test('chat messages and dating are independent switches (friends\' chats no longer follow Dating)', () => {
    expect(isMuted('message', toggleGroup([], 'dating', false))).toBe(false);
    expect(isMuted('new_match', toggleGroup([], 'messages', false))).toBe(false);
    expect(isMuted('message', toggleGroup([], 'messages', false))).toBe(true);
  });
  test('earlier Dating opt-outs keep chat messages off (onboarding answer, older column key)', () => {
    expect(mutesFromOnboardingChoices({ dating: false })).toEqual(['dating', 'messages', 'video_calls']);
    expect(mutesFromOnboardingChoices({ notify_dating: false })).toEqual(['dating', 'messages', 'video_calls']);
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
    expect(en('dating')).toBe('Dating matches');
    expect(en('messages')).toBe('Messages');
    expect(en('video_calls')).toBe('Video calls');
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

describe('the Messages split migration', () => {
  const mig = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270260_messages_notification_group.sql'), 'utf8');
  test('people who had Dating off keep chat messages off', () => {
    expect(mig).toMatch(/notification_mutes \|\| array\['messages'\]\)\s+where 'dating' = any \(notification_mutes\)/);
  });
  test('notify_dating is off only when both Dating and Messages are off, so the message sender\'s older check never blocks a chat left on', () => {
    expect(mig).toMatch(/new\.notify_dating := not \(m @> array\['dating', 'messages'\]\)/);
  });
  test('no sender is changed: the migration defines only the store helpers', () => {
    const fns = [...mig.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort();
    expect(fns).toEqual(['_canonical_notification_mutes', '_derive_legacy_notify_columns', 'set_my_notification_group']);
  });
});

describe('Video calls split from Dating (owner, 20270261)', () => {
  const mig = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270261_video_calls_notification_group.sql'), 'utf8');
  const allowed = (mutes, type) => !isMuted(type, mutes);
  test('1. Dating off, Messages on, Video calls on: messages and calls allowed', () => {
    expect(allowed(['dating'], 'message')).toBe(true);
    expect(allowed(['dating'], 'video_call')).toBe(true);
    expect(allowed(['dating'], 'new_match')).toBe(false);
  });
  test('2. Dating on, Messages off, Video calls on: calls allowed, messages suppressed', () => {
    expect(allowed(['messages'], 'video_call')).toBe(true);
    expect(allowed(['messages'], 'message')).toBe(false);
  });
  test('3. Dating on, Messages on, Video calls off: messages allowed, calls suppressed', () => {
    expect(allowed(['video_calls'], 'message')).toBe(true);
    expect(allowed(['video_calls'], 'video_call')).toBe(false);
    expect(allowed(['video_calls'], 'new_match')).toBe(true);
  });
  test('4/5. one call type for friend and dating matches: the switch is decided by type, never by the kind of match', () => {
    expect(Object.keys(NOTIFICATION_GROUP_BY_TYPE).filter((t) => /(^|_)call(_|$)/.test(t))).toEqual(['video_call']);
    // (the live script checks a friend-match call and a dating-match call through the real sender)
  });
  test('6. opt-out migration state: Dating off gains Video calls off; nothing removed, Messages untouched', () => {
    expect(mig).toMatch(/notification_mutes \|\| array\['video_calls'\]\)\s+where 'dating' = any \(notification_mutes\)/);
    const updates = [...mig.matchAll(/update public\.profiles set notification_mutes = ([^\n]*)/g)].map((m) => m[1]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toMatch(/array_remove/);
    expect(updates[0]).not.toMatch(/messages/);
  });
  test('7. onboarding and Settings write the same groups through the one mapping', () => {
    expect(toggleGroup([], 'video_calls', false)).toEqual(['video_calls']);
    expect(toggleGroup(['dating', 'messages'], 'video_calls', false)).toEqual(['dating', 'messages', 'video_calls']);
    expect(mutesFromOnboardingChoices({ dating: false })).toEqual(['dating', 'messages', 'video_calls']);
    expect(mutesFromOnboardingChoices({ dating: true })).toEqual([]);
  });
  test('9. the older Dating flag cannot override an enabled Video calls switch (derivation needs all three off)', () => {
    expect(mig).toMatch(/new\.notify_dating := not \(m @> array\['dating', 'messages', 'video_calls'\]\)/);
  });
  test('no sender, call function or permission is changed', () => {
    const fns = [...mig.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort();
    expect(fns).toEqual(['_canonical_notification_mutes', '_derive_legacy_notify_columns', 'set_my_notification_group']);
    expect(mig).not.toMatch(/notify_video_call_started\s*\(/);
  });
});
