// Screen-reduction audit B1 (owner, 2026-10-08): a gathering is ONE object with ONE detail screen. The separate Gathering
// Hub is folded into GatheringDetail as the attending section; joining changes the viewer's state and the actions shown
// there, it never moves them to a second destination. Driven partly through React Navigation's real Stack router.
const fs = require('fs');
const path = require('path');
const { StackRouter, StackActions, CommonActions } = require('@react-navigation/routers');

jest.mock('../services/supabase', () => ({ supabase: {} }));

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}
const DETAIL = read('screens/GatheringDetailScreen.js');
const SECTION = read('components/GatheringAttendingSection.js');

describe('nothing can reopen the Gathering Hub', () => {
  test('the screen file and its route are gone', () => {
    expect(fs.existsSync(path.join(SRC, 'screens/GatheringHubScreen.js'))).toBe(false);
    expect(read('navigation/RootNavigator.js')).not.toMatch(/name="GatheringHub"|GatheringHubScreen/);
    expect(read('navigation/BusinessWebNavigator.js')).not.toMatch(/GatheringHub/);
  });
  test('no navigate / push / replace / push destination / return trail names it', () => {
    const offenders = walk(SRC).filter((f) => /['"]GatheringHub['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
    const { RULE14_DECISIONS, SCREEN_REGISTRY } = require('../constants/screenRegistry');
    expect(RULE14_DECISIONS.folded.GatheringHub).toMatch(/GatheringDetail/);
    expect(SCREEN_REGISTRY.GatheringHub).toBeUndefined();
  });
});

describe('joining changes state on the same screen', () => {
  const join = DETAIL.slice(DETAIL.indexOf('async function handleConfirmIntent'), DETAIL.indexOf('async function handleConfirmIntent') + 2500);
  test('a join never navigates away; an auto-approved join marks justJoined and reloads in place', () => {
    // from the join itself to its end (the Paywall alert before it is the plan-limit check, not the join)
    const body = join.slice(join.indexOf('setJoining(true);'), join.indexOf('setJoining(false);\n  }') + 20);
    expect(body).not.toMatch(/navigation\.(replace|navigate|push)\(/);
    expect(body).toMatch(/if \(result\.status === 'approved'\) \{[\s\S]*setJustJoined\(true\);[\s\S]*\} else \{[\s\S]*ImpactFeedbackStyle\.Medium/);
    expect(body).toMatch(/await load\(\);/);
  });
  test('Detail renders the attending section with the join flag and its own reload', () => {
    expect(DETAIL).toMatch(/<GatheringAttendingSection\s+gathering=\{gathering\}\s+gatheringId=\{gatheringId\}\s+navigation=\{navigation\}\s+justJoined=\{justJoined\}\s+onChanged=\{load\}/);
  });
  test('Back after joining returns where the person came from (no replace of the gathering)', () => {
    const ROUTES = ['MainTabs', 'GatheringDetail', 'GatheringChat'];
    const router = StackRouter({});
    const opts = { routeNames: ROUTES, routeParamList: {}, routeGetIdList: {} };
    let s = router.getInitialState(opts);
    s = router.getStateForAction(s, StackActions.push('GatheringDetail', { gatheringId: 'g1' }), opts);
    // joining dispatches nothing: the stack is unchanged, the gathering is still on top
    expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'GatheringDetail']);
    // a day-of action (Say hi / an ice breaker) opens the chat on top; Back returns to the gathering, then to where they were
    s = router.getStateForAction(s, CommonActions.navigate('GatheringChat', { gatheringId: 'g1' }), opts);
    expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'GatheringDetail', 'GatheringChat']);
    s = router.getStateForAction(s, CommonActions.goBack(), opts);
    expect(s.routes.map((r) => r.name)).toEqual(['MainTabs', 'GatheringDetail']);
    s = router.getStateForAction(s, CommonActions.goBack(), opts);
    expect(s.routes.map((r) => r.name)).toEqual(['MainTabs']);
  });
});

describe('who gets the attending section (the Hub\'s own rule, unchanged)', () => {
  const { showsAttendingSection, getCountdownLabel } = require('../utils/gatheringAttending');
  test('host and approved attendees only', () => {
    expect(showsAttendingSection({ isHost: true, myStatus: null })).toBe(true);
    expect(showsAttendingSection({ isHost: false, myStatus: 'approved' })).toBe(true);
    for (const myStatus of ['pending', 'waitlisted', null, undefined]) {
      expect(showsAttendingSection({ isHost: false, myStatus })).toBe(false);
    }
    expect(showsAttendingSection(null)).toBe(false);
  });
  test('the day-of countdown: upcoming, happening now (3 h), then over', () => {
    const now = Date.UTC(2026, 9, 8, 18, 0);
    expect(getCountdownLabel(new Date(now + 30 * 60000).toISOString(), now)).toMatch(/30/);
    expect(getCountdownLabel(new Date(now - 60 * 60000).toISOString(), now)).toBeTruthy();
    expect(getCountdownLabel(new Date(now - 4 * 3600000).toISOString(), now)).toBeNull();
  });
});

describe('every day-of capability survived the move', () => {
  test.each([
    ['who you\'ll meet + send notice', /t\('ui\.gatheringHub\.whoYoullMeet'\)[\s\S]*handleSendNotice\(a\.user_id\)/],
    ['blocked people left out of the meet list', /!blocked\.has\(a\.user_id\)[\s\S]*!blockedIds\.has\(a\.user_id\)/],
    ['no notice button for the host', /\{!gathering\.isHost && \(\s*sentNoticeTo/],
    ['ice breakers open the chat with the line drafted', /iceBreakersFor\(gathering\.interest_tag\)[\s\S]*draftText: starter/],
    ['before you go: forecast + prep tips', /getSocialForecast[\s\S]*prepTipsFor\(gathering\.interest_tag\)/],
    ['meet-up point + Uber', /getGatheringMeetupPoint\(gatheringId\)[\s\S]*<MeetupPointMap point=\{meetupPoint\}[\s\S]*openUberToDestination/],
    ['on my way is a toggle', /if \(iAmOnMyWay\) \{\s*await unsetGatheringOnMyWay\(gatheringId\);\s*\} else \{\s*await setGatheringOnMyWay\(gatheringId\);/],
    ['check in', /await checkInToGathering\(gatheringId\);/],
    ['on my way / check in only for attendees, only before it is over', /\{!gathering\.isHost && !isOver && \(/],
    ['checked in: who\'s here, Say hi, Photos', /iAmCheckedIn \?[\s\S]*ui\.gatheringHub\.whosHere[\s\S]*ui\.gatheringHub\.sayHi[\s\S]*ui\.gatheringHub\.photos/],
    ['after joining: You\'re in, then bring someone (invite or share link)', /\{showJoinedBanner && \([\s\S]*ui\.gatheringHub\.youreIn[\s\S]*\{showGrowthPrompt && \([\s\S]*setGrowthInviteModalVisible\(true\)[\s\S]*onPress=\{handleGrowthShareLink\}/],
    ['the share link is the plain https invite link', /async function handleGrowthShareLink[\s\S]*gatheringInviteShareUrl\(gatheringId\)/],
  ])('%s', (_label, re) => {
    expect(SECTION).toMatch(re);
  });
  test('the section never links to GatheringDetail (it is on it) and opens no new screen beyond chat and profiles', () => {
    const targets = [...SECTION.matchAll(/navigation\.navigate\('(\w+)'/g)].map((m) => m[1]);
    expect([...new Set(targets)].sort()).toEqual(['GatheringChat', 'ViewProfile']);
  });
  test('the website build (which registers GatheringDetail) never loads react-native-maps through this section', () => {
    expect(SECTION).not.toMatch(/from 'react-native-maps'/);
    expect(fs.existsSync(path.join(SRC, 'components/MeetupPointMap.web.js'))).toBe(true);
    expect(read('components/MeetupPointMap.web.js')).not.toMatch(/from 'react-native-maps'/);
  });
  test('the post-event feedback stays on the detail screen', () => {
    expect(DETAIL).toMatch(/viewer\.relation === 'attending' && viewer\.time === 'past' && \(\s*<GatheringFeedbackPrompt/);
  });
});
