// Items 32/33 (owner, 2026-10-08): Home = intent, Picked For You (max 3), Your Plans (max 3) + See all, the social line,
// Nearby Right Now (max 3), then everything else (nudges, shortcuts, Quick Picks, communities, stats, recap).
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`missing: ${needle}`);
  return i;
};

describe('Home information budget order', () => {
  it('intent -> first-run -> Picked For You -> Your Plans -> social signal -> the rest', () => {
    const order = [
      at('styles.intentSection'),
      at('seenFirstRunMoment === false &&'),
      at('(attention.shown > 0) &&'),
      at('(homePlans.total > 0) &&'),
      at("t('ui.home.seeAllPlans')"),
      at('const insight = homeInsight;'),
      at('rightNow.length > 0 &&'),
      at('diningNudge || pendingInvitesCount > 0'),
      at('goalRow.length > 0 &&'),
      at('continueCommunities.length > 0 &&'),
      at('homeQuickStatRows(dashboard).length > 0 &&'),
      at('dashboard?.weeklyRecap &&'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

const { selectHomePlans, selectRightNow, MAX_HOME_ATTENTION, MAX_HOME_PLANS, MAX_HOME_RIGHT_NOW, HOME_SECTION_PRIORITY } = require('./homeAttention');

describe('item 33 caps', () => {
  it('each Home list shows at most 3', () => {
    expect([MAX_HOME_ATTENTION, MAX_HOME_PLANS, MAX_HOME_RIGHT_NOW]).toEqual([3, 3, 3]);
    expect(HOME_SECTION_PRIORITY[HOME_SECTION_PRIORITY.length - 1]).toBe('rightNow');
  });
});

describe('selectHomePlans', () => {
  const at = (h) => new Date(2026, 9, 10, h).toISOString();
  it('commitments first by start, then group, then Interested; at most 3', () => {
    const going = [{ id: 'g9', scheduled_at: at(21) }, { id: 'g1', scheduled_at: at(10) }];
    const hosting = [{ id: 'h5', scheduled_at: at(17) }];
    const group = [{ id: 'gp' }];
    const interested = [{ id: 'i1', scheduled_at: at(8) }];
    const out = selectHomePlans({ plansGoing: going, plansHosting: hosting, plansGroup: group, plansInterested: interested });
    expect(out.going.map((g) => g.id)).toEqual(['g9', 'g1']);
    expect(out.hosting.map((g) => g.id)).toEqual(['h5']);
    expect(out.group).toEqual([]);
    expect(out.interested).toEqual([]);
    expect(out.total).toBe(5);
  });
  it('fewer than 3 = all of them; none = total 0', () => {
    expect(selectHomePlans({ plansInterested: [{ id: 'i' }] }).interested).toHaveLength(1);
    expect(selectHomePlans({}).total).toBe(0);
  });
});

describe('selectRightNow', () => {
  const now = new Date(2026, 9, 10, 18, 0);
  const inMin = (m, extra = {}) => ({ scheduled_at: new Date(now.getTime() + m * 60000).toISOString(), ...extra });
  it('only the Right Now window, soonest first, minus anything shown above, at most 3', () => {
    const gs = [
      { id: 'later', ...inMin(180) },
      { id: 'b', ...inMin(60) },
      { id: 'a', ...inMin(15) },
      { id: 'shown', ...inMin(5) },
      { id: 'c', ...inMin(90, { distanceMiles: 2 }) },
      { id: 'd', ...inMin(90, { distanceMiles: 1 }) },
    ];
    const out = selectRightNow({ gatherings: gs, exclude: new Set(['shown']), now });
    expect(out.map((g) => g.id)).toEqual(['a', 'b', 'd']);
  });
  it('nothing in the window = empty (no section)', () => {
    expect(selectRightNow({ gatherings: [{ id: 'x', ...inMin(300) }], now })).toEqual([]);
  });
});
