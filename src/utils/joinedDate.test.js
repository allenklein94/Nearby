import fs from 'fs';
import path from 'path';
import { joinedNearbyDate } from './joinedDate';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('Timeline removed; "Joined Nearby on <date>" kept as one Profile line (rule 14)', () => {
  it('formats a real created_at as a full date, nothing for a missing one', () => {
    expect(joinedNearbyDate('2026-08-04T12:00:00Z', 'en')).toMatch(/August \d+, 2026/);
    expect(joinedNearbyDate(null)).toBeNull();
    expect(joinedNearbyDate('not a date')).toBeNull();
  });
  it('the Timeline screen, its route, its Profile row and its loader are gone', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'screens/TimelineScreen.js'))).toBe(false);
    const nav = read('navigation/RootNavigator.js') + read('screens/ProfileScreen.js');
    expect(nav).not.toMatch(/TimelineScreen|['"]Timeline['"]|viewYourTimeline/);
    expect(read('services/homeDashboard.js')).not.toMatch(/getMyTimeline/);
  });
  it('the Profile line is a quiet, non-interactive line, localized', () => {
    const src = read('screens/ProfileScreen.js');
    expect(src).toMatch(/joinedLabel && <Text style=\{styles\.joinedLine\}>\{t\('ui\.profile\.joinedNearbyOn', \{ date: joinedLabel \}\)\}<\/Text>/);
    expect(src).not.toMatch(/Joined Nearby/);
  });
});
