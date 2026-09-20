import { attendeeTotal, getGatheringFullness } from './gatheringFullness';
import fs from 'fs';
import path from 'path';

describe('attendeeTotal (server count beats visible rows)', () => {
  test('prefers the server count: a hidden blocked attendee still fills a spot', () => {
    const g = { capacity: 3, approvedCount: 3, approvedAttendees: [{}, {}] };
    expect(attendeeTotal(g)).toBe(3);
    expect(getGatheringFullness(g).isFull).toBe(true);
  });
  test('falls back to visible rows, then attendeeCount, then 0', () => {
    expect(attendeeTotal({ approvedAttendees: [{}, {}] })).toBe(2);
    expect(attendeeTotal({ attendeeCount: 4 })).toBe(4);
    expect(attendeeTotal({})).toBe(0);
    expect(attendeeTotal(null)).toBe(0);
  });
  test('the RPC exists as one migration and screens do not derive fullness from the visible rows', () => {
    const root = path.join(__dirname, '..', '..');
    expect(fs.readdirSync(path.join(root, 'supabase/migrations')).some((f) => f.includes('gathering_approved_counts'))).toBe(true);
    for (const f of ['screens/GatheringsScreen.js', 'screens/DiscoverHubScreen.js', 'screens/GatheringDetailScreen.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(src).not.toMatch(/approvedAttendees\?*\.length \?\? 0\) >= /);
      expect(src).not.toMatch(/capacity - gathering\.approvedAttendees/);
    }
  });
});
