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
});
