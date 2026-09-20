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
  test('nothing navigates to a retired Gatherings attending/hosting tab', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
    const bad = walk(path.join(__dirname, '..')).filter((f) => /navigate\('Gatherings',\s*\{[^}]*initialTab:\s*'(attending|hosting)'/.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  test('Gatherings is browse-only: no attending collection', () => {
    const g = read('GatheringsScreen.js');
    expect(g).not.toMatch(/tab === 'attending'/);
    expect(g).not.toMatch(/setTab\(/);
    expect(g).not.toMatch(/getMyAttendingGatherings|getFellowAttendees|sendNoticeTo/);
  });
  test('attending actions moved off the retired tab are still reachable', () => {
    expect(read('GatheringHubScreen.js')).toMatch(/sendNoticeTo/);
    expect(read('GatheringDetailScreen.js')).toMatch(/<GatheringFeedbackPrompt/);
    expect(read('PlansScreen.js')).toMatch(/getMyAttendingGatherings/);
  });
  test('the Hub meet list (and its notice button) excludes people I blocked', () => {
    const h = read('GatheringHubScreen.js');
    expect(h).toMatch(/getMyBlockedUsers/);
    expect(h).toMatch(/!blockedIds\.has\(a\.user_id\)/);
  });
});
