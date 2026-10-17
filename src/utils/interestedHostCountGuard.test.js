// Owner (2026-10-17, idea "152" follow-up, LOCKED): Interested is private; the ONE exception is an aggregate count, seen
// only by the host of that gathering, only in their own gathering's host view (GatheringDetail -> HostCommandCenter).
// Never on Home/Discover cards, public detail, other attendees or business surfaces; never a name, photo or list.
// Journey `interestedPrivacy` proves the server side per role; this guard keeps the client to one fetch and one place.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function sourceFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['journeys', 'i18n', 'node_modules'].includes(e.name)) sourceFiles(p, out);
    } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) {
      out.push(path.relative(SRC, p).split(path.sep).join('/'));
    }
  }
  return out;
}
const files = sourceFiles();
const using = (re) => files.filter((f) => re.test(read(f))).sort();

describe('the host Interested count reaches one screen, for the host only', () => {
  test('only the gatherings service calls the count RPC', () => {
    expect(using(/get_gathering_interested_count/)).toEqual(['services/gatherings.js']);
  });

  test('the service fetches it only when the viewer is the host', () => {
    const svc = read('services/gatherings.js');
    const calls = svc.split('\n').filter((l) => /getGatheringInterestedCount\(/.test(l) && !/export async function/.test(l));
    expect(calls).toEqual([expect.stringMatching(/=\s*isHost\s*\?\s*await getGatheringInterestedCount\(gatheringId\)\s*:\s*null/)]);
  });

  test('only GatheringDetail reads the count, and only into the host stats', () => {
    expect(using(/interestedCount/)).toEqual(['screens/GatheringDetailScreen.js', 'services/gatherings.js']);
    const detail = read('screens/GatheringDetailScreen.js');
    const reads = detail.split('\n').filter((l) => /g\.interestedCount/.test(l) && !/^\s*\/\//.test(l));
    expect(reads).toEqual([expect.stringMatching(/interested: g\.interestedCount \?\? null/)]);
    // that assignment sits inside the host-only branch of load()
    const at = detail.indexOf('interested: g.interestedCount');
    expect(detail.lastIndexOf('if (g.isHost) {', at)).toBeGreaterThan(-1);
  });

  test('the host stats render only in HostCommandCenter, inside the host branch of GatheringDetail', () => {
    expect(using(/<HostCommandCenter\b/)).toEqual(['screens/GatheringDetailScreen.js']);
    const detail = read('screens/GatheringDetailScreen.js');
    const at = detail.indexOf('<HostCommandCenter');
    const branch = detail.lastIndexOf('{gathering.isHost ? (', at);
    expect(branch).toBeGreaterThan(-1);
    // no other conditional branch opens between the host check and the command center
    expect(detail.slice(branch, at)).not.toMatch(/\)\s*:\s*\(/);
  });

  test('the command center gets a number, never people', () => {
    const center = read('components/HostCommandCenter.js');
    expect(center).not.toMatch(/gathering_interested|interestedUsers|interestedPeople|interestedIds/);
  });
});
