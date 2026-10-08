// Item 39 (owner, 2026-10-08): states, not folders. One gathering, one relation (hosting > attending > requested /
// waitlisted > interested > none) x one time (upcoming / past); surfaces filter by them, never a screen per state.
const fs = require('fs');
const path = require('path');
const { gatheringViewerState, GATHERING_RELATION_RANK } = require('./objectState');
const { gatheringLifecycleState, canDo, LIFECYCLE } = require('./objectLifecycle');
const { mergePlanRows, PLAN_STATUS_RELATION } = require('./planRows');

const NOW = new Date(2026, 9, 8, 12);
const FUTURE = new Date(2026, 9, 9, 19).toISOString();
const PAST = new Date(2026, 9, 7, 19).toISOString();

test('one relation per viewer: the strongest wins, Interested only when nothing stronger holds', () => {
  const rel = (o) => gatheringViewerState({ scheduled_at: FUTURE, ...o }, NOW).relation;
  expect(rel({ isHost: true, isInterested: true })).toBe('hosting');
  expect(rel({ myStatus: 'approved', isInterested: true })).toBe('attending');
  expect(rel({ myStatus: 'pending', isInterested: true })).toBe('requested');
  expect(rel({ isInterested: true })).toBe('interested');
  expect(rel({})).toBe('none');
  expect(Object.entries(GATHERING_RELATION_RANK).sort((a, b) => b[1] - a[1]).map(([k]) => k)[0]).toBe('hosting');
});

test('every relation x time has a lifecycle row; Interested keeps Join and can take the mark off', () => {
  for (const relation of Object.keys(GATHERING_RELATION_RANK)) {
    for (const time of ['upcoming', 'past']) expect(LIFECYCLE.gathering[`${time}_${relation}`]).toBeDefined();
  }
  const st = gatheringLifecycleState({ scheduled_at: FUTURE, isInterested: true }, NOW);
  expect(st).toBe('upcoming_interested');
  expect(['join', 'interested'].every((a) => canDo('gathering', st, a))).toBe(true);
  expect(gatheringLifecycleState({ scheduled_at: PAST, isInterested: true }, NOW)).toBe('past_interested');
});

test('Plans ranks rows by the same canonical relation, not a private table', () => {
  for (const r of Object.values(PLAN_STATUS_RELATION)) expect(GATHERING_RELATION_RANK[r]).toBeDefined();
  const g = { id: 'g1' };
  expect(mergePlanRows([{ gathering: g, status: 'maybe' }, { gathering: g, status: 'going' }])[0].status).toBe('going');
  expect(mergePlanRows([{ gathering: g, status: 'going' }, { gathering: g, status: 'hosting' }])[0].status).toBe('hosting');
  expect(fs.readFileSync(path.join(__dirname, 'planRows.js'), 'utf8')).not.toMatch(/ROLE_RANK\s*=/);
});

test('no screen per state: no Interested / Attending / Hosting / Past screen or route', () => {
  const { SCREEN_REGISTRY } = require('../constants/screenRegistry');
  const bad = /^(Interested|Attending|Hosting|Past|MyHosting|MyAttending)/;
  expect(Object.keys(SCREEN_REGISTRY).filter((k) => bad.test(k))).toEqual([]);
  expect(fs.readdirSync(path.join(__dirname, '../screens')).filter((f) => bad.test(f))).toEqual([]);
});

test('GatheringDetail renders its badge and actions from the one relation', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/GatheringDetailScreen.js'), 'utf8');
  expect(src).toMatch(/isInterested: gathering\.myInterested === true/);
  expect(src).toMatch(/relationBadgeStatus\(viewer\)/);
  expect(src).toMatch(/gatheringLifecycleState\(viewerInput\)/);
});
