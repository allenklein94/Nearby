// Owner idea "244" (2026-10-18): the gathering chat header shows when the gathering is, under its title, from the
// shared when engine (displayGatheringWhen), and tapping it opens that gathering like the title. No line without a time.
import fs from 'fs';
import path from 'path';
import { displayGatheringWhen } from '../i18n/display';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('gathering chat header when line (idea 244)', () => {
  const screen = read('screens/GatheringChatScreen.js');
  const nav = read('navigation/RootNavigator.js');
  const header = nav.slice(nav.indexOf('name="GatheringChat"'), nav.indexOf('name="PreferencePolls"'));

  test('the screen computes the line only through displayGatheringWhen', () => {
    expect(screen).toMatch(/import \{ displayGatheringWhen \} from '\.\.\/i18n\/display'/);
    expect(screen).toMatch(/navigation\.setParams\(\{ gatheringWhen: displayGatheringWhen\(g, language\) \?\? null \}\)/);
  });

  test('re-read on focus, so a live label never goes stale across returns', () => {
    expect(screen).toMatch(/navigation\.addListener\('focus', refresh\)/);
  });

  test('the line sits inside the same touchable that opens GatheringDetail', () => {
    const touch = header.slice(header.indexOf('<TouchableOpacity'), header.indexOf('</TouchableOpacity>'));
    expect(touch).toMatch(/navigation\.navigate\('GatheringDetail', \{ gatheringId: route\.params\.gatheringId \}\)/);
    expect(touch).toMatch(/route\.params\.gatheringWhen/);
    expect(touch).toMatch(/route\.params\?\.gatheringWhen\]\.filter\(Boolean\)\.join\(', '\)/);
  });

  test('no time = no line; a time = the engine label', () => {
    expect(displayGatheringWhen(null, 'en')).toBeNull();
    expect(displayGatheringWhen({ scheduled_at: null }, 'en')).toBeNull();
    const now = new Date(2026, 9, 18, 10, 0, 0);
    const label = displayGatheringWhen({ scheduled_at: new Date(2026, 9, 24, 16, 0, 0).toISOString(), duration_minutes: null }, 'en', now);
    expect(typeof label).toBe('string');
    expect(label).toMatch(/4(:00)? PM/);
  });
});
