import fs from 'fs';
import { homeQuickStatRows } from './homeQuiet';

describe('Home may say nothing (item 79)', () => {
  it('an empty or unknown dashboard yields no rows, never zeros', () => {
    for (const d of [null, {}, { meetPeopleCount: 0, gatheringsTodayCount: 0, unreadCount: 0, friendsCount: 0 }, { meetPeopleCount: null }]) {
      expect(homeQuickStatRows(d)).toEqual([]);
    }
  });
  it('only real, non-zero signals become rows', () => {
    const rows = homeQuickStatRows({ meetPeopleCount: 3, gatheringsTodayCount: 1, unreadCount: 2, friendsCount: 0,
      mostRecentSighting: { otherUserId: 'u', profiles: { display_name: 'Sam' } } });
    expect(rows.map((r) => r.key)).toEqual(['people', 'today', 'crossed', 'unread']);
    expect(rows[0].cta).toBe('Meet People');
    expect(rows[1].text).toBe('1 gathering today');
  });
  it('Home no longer carries filler statements or always-on stat rows', () => {
    const src = fs.readFileSync(`${__dirname}/../screens/HomeScreen.js`, 'utf8');
    expect(src).not.toContain('Quiet night nearby');
    expect(src).not.toMatch(/unread message\{dashboard/);
    expect(src).toContain('homeQuickStatRows(dashboard).length > 0');
  });
});
