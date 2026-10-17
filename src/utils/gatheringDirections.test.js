// Owner item 145 (2026-10-17, approved): "Get directions" beside "Get an Uber there" on a gathering's meet-up point, opening the
// phone's maps app at the exact point from the host/attendee-only lookup; existing wording only; no broken destination; no motion.
import fs from 'fs';
import path from 'path';
import { buildDirectionsUrl, isValidCoordinate } from './planLogisticsActions';
import requestDetail from '../i18n/ui/requestDetail';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const section = read('components/GatheringAttendingSection.js');
const service = read('services/gatherings.js');

describe('the link: exact point only, never a broken destination', () => {
  test('a real point -> Google Maps turn-by-turn directions to it (the maps app picks walking/driving)', () => {
    expect(buildDirectionsUrl({ latitude: 26.4615, longitude: -80.0728 }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=26.4615,-80.0728');
  });
  test.each([
    [{}],
    [{ latitude: null, longitude: -80 }],
    [{ latitude: 26.4, longitude: undefined }],
    [{ latitude: NaN, longitude: -80 }],
    [{ latitude: 26.4, longitude: Infinity }],
    [{ latitude: '26.4', longitude: '-80' }],
    [{ latitude: 91, longitude: -80 }],
    [{ latitude: 26.4, longitude: -181 }],
  ])('missing or invalid coordinates %j -> no link', (p) => {
    expect(buildDirectionsUrl(p)).toBeNull();
  });
  test('no argument at all -> no link (never throws)', () => {
    expect(buildDirectionsUrl()).toBeNull();
  });
  test('isValidCoordinate: finite numbers on the globe only', () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(-90, 180)).toBe(true);
    expect(isValidCoordinate(90.0001, 0)).toBe(false);
    expect(isValidCoordinate(null, null)).toBe(false);
  });
});

describe('the service: an invalid point is no point (map, Uber and directions all absent)', () => {
  test('numbers are read from the RPC row and checked before a point is returned', () => {
    const fn = service.slice(service.indexOf('export async function getGatheringMeetupPoint'), service.indexOf('export async function getGatheringMeetupPoint') + 900);
    expect(fn).toMatch(/rpc\('get_gathering_meetup_point', \{ gathering_id_param: gatheringId \}\)/);
    expect(fn).toMatch(/const latitude = Number\(point\.latitude\);\s*const longitude = Number\(point\.longitude\);\s*if \(!isValidCoordinate\(latitude, longitude\)\) return null;/);
  });
});

describe('the screen', () => {
  const block = section.slice(section.indexOf('{meetupPoint && ('), section.indexOf("t('ui.gatheringHub.getAnUberThere')}"));

  test('inside the meet-up point block, beside Get an Uber there, only when there is a link', () => {
    expect(block).toMatch(/<MeetupPointMap point=\{meetupPoint\}[^>]*\/>\s*\{directionsUrl && \(\s*<TouchableOpacity\s*style=\{styles\.uberLink\}\s*onPress=\{handleGetDirections\}/);
    expect(block).toMatch(/onPress=\{\(\) => openUberToDestination/);
  });

  test('built from the host/attendee-only lookup through the shared builder; a failed open says so', () => {
    expect(section).toMatch(/getGatheringMeetupPoint\(gatheringId\)/);
    expect(section).toMatch(/const directionsUrl = meetupPoint \? buildDirectionsUrl\(\{ latitude: meetupPoint\.latitude, longitude: meetupPoint\.longitude \}\) : null;/);
    expect(section).toMatch(/if \(!directionsUrl\) return;\s*Linking\.openURL\(directionsUrl\)\.catch\(\(\) => Alert\.alert\(t\('ui\.requestDetail\.error'\), t\('ui\.requestDetail\.couldntOpenMaps'\)\)\);/);
    // the whole block is the host's and approved attendees' only (showsAttendingSection)
    expect(section).toMatch(/if \(!showsAttendingSection\(gathering\)\) return null;/);
  });

  test('existing wording only, present in every language', () => {
    expect(block).toMatch(/accessibilityLabel=\{t\('ui\.requestDetail\.getDirectionsA11y'\)\}/);
    expect(block).toMatch(/\{t\('ui\.requestDetail\.getDirections'\)\}/);
    for (const [lang, r] of Object.entries(requestDetail)) {
      expect([lang, typeof r.getDirections, typeof r.getDirectionsA11y, typeof r.couldntOpenMaps, typeof r.error])
        .toEqual([lang, 'string', 'string', 'string', 'string']);
    }
  });

  test('no motion, no time-based reordering: the section adds no animation and no countdown-driven layout', () => {
    expect(section).not.toMatch(/Animated|useMotion|SEQUENCES|motionBudget/);
    expect(block).not.toMatch(/countdown|isOver|minutesLeft/);
  });
});
