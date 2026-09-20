const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

// Plans is preview -> collection -> object detail. Host management lives on
// GatheringDetail; no collection may link to another collection of the same rows.
describe('host controls live on GatheringDetail', () => {
  const detail = read('GatheringDetailScreen.js');
  test('Plans has no bridge to the Gatherings hosting tab', () => {
    expect(read('PlansScreen.js')).not.toMatch(/initialTab: 'hosting'/);
  });
  test('Detail no longer sends the host to the Gatherings hosting tab', () => {
    expect(detail).not.toMatch(/initialTab: 'hosting'/);
  });
  test('every host action is reachable from Detail', () => {
    expect(detail).toMatch(/<HostAttendeeManager/);
    for (const s of ["'EditGathering'", 'confirmCancelGatheringInDetail', 'setInviteModalVisible(true)', "'GatheringChat'", "'GatheringHub'"]) {
      expect(detail).toContain(s);
    }
    const mgr = read('../components/HostAttendeeManager.js');
    for (const s of ['approveInterest', 'hostRemoveAttendee', 'Decline', 'Remove']) expect(mgr).toContain(s);
  });
  test('the Gatherings screen has no hosting tab / hosted-gatherings collection', () => {
    const g = read('GatheringsScreen.js');
    expect(g).not.toMatch(/tab === 'hosting'/);
    expect(g).not.toMatch(/setTab\('hosting'\)/);
    expect(g).not.toMatch(/getMyGatherings/);
  });
  test('nothing navigates to a Gatherings hosting tab', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
    const bad = walk(path.join(__dirname, '..')).filter((f) => /navigate\('Gatherings',\s*\{\s*initialTab:\s*'hosting'/.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
