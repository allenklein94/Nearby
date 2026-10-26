// Owner idea "376" (2026-10-23): no orphan CTAs. A gathering card's join action (Join / Request to Join / Join Waitlist /
// the same words when Interested) opens Gathering Detail with its existing join step ready, the same on Home and Discover; a tap on the card body
// opens the gathering plainly; nothing is ever submitted just because the page opened.
import fs from 'fs';
import path from 'path';
import { gatheringActionOpenParams, gatheringJoinAction, primaryActionFor } from './primaryAction';

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const NOW = new Date('2026-09-26T12:00:00Z').getTime(); // same fixture as stateDrivenCta.test.js
const g = (over = {}) => ({ id: 'g1', host_id: 'host', scheduled_at: '2026-09-27T19:00:00Z', is_public: true, requires_approval: false, capacity: null, attendees: [], ...over });

describe('gatheringActionOpenParams', () => {
  test('every join wording opens the join step', () => {
    for (const opts of [{}, { isFull: true }]) {
      expect(gatheringActionOpenParams(gatheringJoinAction(g(), opts))).toEqual({ openJoin: true });
    }
    expect(gatheringActionOpenParams(gatheringJoinAction(g({ requires_approval: true })))).toEqual({ openJoin: true });
  });

  test('a shared primaryActionFor join opens the join step', () => {
    const action = primaryActionFor('gathering', g(), { myUserId: 'me', now: NOW });
    expect(action.kind).toBe('join');
    expect(gatheringActionOpenParams(action)).toEqual({ openJoin: true });
  });

  test('non-join actions and states open the gathering plainly', () => {
    for (const action of [null, undefined, { kind: 'view' }, { kind: 'view_plan' }, { kind: 'requested' }, { kind: 'interested', on: false }]) {
      expect(gatheringActionOpenParams(action)).toBeNull();
    }
  });
});

describe('Home and Discover behave the same', () => {
  const home = src('screens/HomeScreen.js');
  const discover = src('screens/DiscoverHubScreen.js');

  test('Home: the join button reads the shared rule', () => {
    expect(home).toMatch(/action\.kind === 'join' \? \([\s\S]{0,200}onPress=\{\(\) => openDetail\(gatheringActionOpenParams\(action\) \?\? \{\}\)\}/);
    expect(home).not.toMatch(/openDetail\(\{ openJoin: true \}\)/);
  });

  test('Discover: every gathering action button opens through the shared rule', () => {
    expect(discover).toMatch(/if \(a\.kind === 'join'\) return \{ kind: 'cta', label: a\.label, openParams: gatheringActionOpenParams\(a\) \}/);
    expect(discover).toMatch(/function openGatheringAction\(card, action\) \{\s*openDestination\(navigation, card\.destination, action\.openParams \?\? null\);/);
    // context row, compact row, hero and standard tile: four action targets, none opening the destination directly
    expect((discover.match(/openGatheringAction\(card, action\)/g) ?? []).length).toBe(5); // 4 call sites + the definition
  });

  test('Discover: the card body still opens the gathering plainly, never the join step', () => {
    // Every tile-body press opens the destination with no extra params (or the in-place context), so only the action starts a join.
    expect(discover).not.toMatch(/openDestination\(navigation, card\.destination, \{ openJoin/);
    expect(discover).toMatch(/style=\{\[styles\.card, isSource && styles\.cardSourceHighlight\]\}\s*onPress=\{\(\) => openDestination\(navigation, card\.destination\)\}/);
  });

  test('Gathering Detail never submits on open: openJoin only shows the confirm step, and only when joining is allowed', () => {
    const detail = src('screens/GatheringDetailScreen.js');
    expect(detail).toMatch(/const blocked = !can\('join'\) \|\| gathering\.myStatus\s*\|\| \(gathering\.visibility === 'invite_only' && !gathering\.hasInviteOnlyAccess\);\s*if \(!blocked\) setIntentModalVisible\(true\);/);
    // the confirm button's words come from the current state (full -> waitlist, approval -> request)
    expect(detail).toMatch(/confirmLabel=\{gatheringJoinAction\(gathering, \{ isFull: gathering\.isFull \}\)\.label\}/);
  });
});
