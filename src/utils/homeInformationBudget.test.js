// Item 32 (owner, 2026-10-08): Home's first viewport = intent, immediate recommendations, plans, then the social signal;
// everything else (nudges, shortcuts, Quick Picks, communities, stats, recap) comes after. Guards the render order.
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
      at('dashboard?.plansGoing?.length > 0 ||'),
      at('const insight = homeInsight;'),
      at('diningNudge || pendingInvitesCount > 0'),
      at('goalRow.length > 0 &&'),
      at('continueCommunities.length > 0 &&'),
      at('homeQuickStatRows(dashboard).length > 0 &&'),
      at('dashboard?.weeklyRecap &&'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
