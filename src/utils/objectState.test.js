import {
  isGatheringPast, isGatheringUpcoming, gatheringTimeState, isSocialInviteExpired, isGatheringRequestExpired,
  isOccasionInviteExpired, isOfferExpired, gatheringViewerState,
} from './objectState';

const NOW = new Date(2026, 8, 20, 12, 0, 0);
const hour = 3600e3;
const at = (dMs) => new Date(NOW.getTime() + dMs).toISOString();

describe('gathering past / upcoming (boundary: start < now is past)', () => {
  test('future, past, and exactly-now', () => {
    expect(isGatheringUpcoming({ scheduled_at: at(hour) }, NOW)).toBe(true);
    expect(isGatheringPast({ scheduled_at: at(hour) }, NOW)).toBe(false);
    expect(isGatheringPast({ scheduled_at: at(-hour) }, NOW)).toBe(true);
    expect(isGatheringUpcoming({ scheduled_at: at(0) }, NOW)).toBe(true);
    expect(isGatheringPast({ scheduled_at: at(0) }, NOW)).toBe(false);
  });
  test('accepts a bare ISO string, a Date, and a numeric now', () => {
    expect(isGatheringPast(at(-hour), NOW.getTime())).toBe(true);
    expect(isGatheringPast(new Date(NOW.getTime() - hour), NOW)).toBe(true);
  });
  test('unknown or garbage dates are neither past nor upcoming (never a wrong action)', () => {
    for (const v of [null, undefined, {}, { scheduled_at: null }, { scheduled_at: 'nope' }]) {
      expect(isGatheringPast(v, NOW)).toBe(false);
      expect(isGatheringUpcoming(v, NOW)).toBe(false);
      expect(gatheringTimeState(v, NOW)).toBeNull();
    }
    expect(gatheringTimeState({ scheduled_at: at(hour) }, NOW)).toBe('upcoming');
    expect(gatheringTimeState({ scheduled_at: at(-hour) }, NOW)).toBe('past');
  });
});

describe('expired states', () => {
  test('social invite: only a past GATHERING invite expires', () => {
    expect(isSocialInviteExpired({ inviteType: 'gathering', scheduledAt: at(-hour) }, NOW)).toBe(true);
    expect(isSocialInviteExpired({ inviteType: 'gathering', scheduledAt: at(hour) }, NOW)).toBe(false);
    expect(isSocialInviteExpired({ inviteType: 'community', scheduledAt: at(-hour) }, NOW)).toBe(false);
    expect(isSocialInviteExpired({ inviteType: 'gathering' }, NOW)).toBe(false);
  });
  test('join request expires with its gathering', () => {
    expect(isGatheringRequestExpired({ scheduled_at: at(-hour) }, NOW)).toBe(true);
    expect(isGatheringRequestExpired({ scheduled_at: at(hour) }, NOW)).toBe(false);
  });
  test('occasion invite: local day; the event day itself is still open; no date = never', () => {
    expect(isOccasionInviteExpired('2026-09-19', NOW)).toBe(true);
    expect(isOccasionInviteExpired('2026-09-20', NOW)).toBe(false);
    expect(isOccasionInviteExpired('2026-09-21', NOW)).toBe(false);
    expect(isOccasionInviteExpired(null, NOW)).toBe(false);
    expect(isOccasionInviteExpired('garbage', NOW)).toBe(false);
  });
  test('offer expires AT valid_until (<= now); none = never', () => {
    expect(isOfferExpired({ valid_until: at(-1000) }, NOW)).toBe(true);
    expect(isOfferExpired({ valid_until: at(0) }, NOW)).toBe(true);
    expect(isOfferExpired({ valid_until: at(1000) }, NOW)).toBe(false);
    expect(isOfferExpired({}, NOW)).toBe(false);
    expect(isOfferExpired({ valid_until: 'x' }, NOW)).toBe(false);
  });
});

describe('gatheringViewerState (one explicit state)', () => {
  const up = at(hour);
  const past = at(-hour);
  test('relations', () => {
    expect(gatheringViewerState({ isHost: true, scheduled_at: up }, NOW)).toEqual({ relation: 'hosting', time: 'upcoming', expired: false, actionable: true });
    expect(gatheringViewerState({ myStatus: 'approved', scheduled_at: up }, NOW).relation).toBe('attending');
    expect(gatheringViewerState({ myStatus: 'pending', scheduled_at: up }, NOW).relation).toBe('requested');
    expect(gatheringViewerState({ myStatus: 'waitlisted', scheduled_at: up }, NOW).relation).toBe('waitlisted');
    expect(gatheringViewerState({ scheduled_at: up }, NOW).relation).toBe('none');
  });
  test('a pending or waitlisted spot in a past gathering is expired and not actionable', () => {
    expect(gatheringViewerState({ myStatus: 'pending', scheduled_at: past }, NOW)).toEqual({ relation: 'requested', time: 'past', expired: true, actionable: false });
    expect(gatheringViewerState({ myStatus: 'waitlisted', scheduled_at: past }, NOW).expired).toBe(true);
    expect(gatheringViewerState({ myStatus: 'approved', scheduled_at: past }, NOW).expired).toBe(false);
  });
  test('unknown date: not actionable, not expired', () => {
    expect(gatheringViewerState({ myStatus: 'pending' }, NOW)).toEqual({ relation: 'requested', time: null, expired: false, actionable: false });
  });
});

describe('no screen re-derives Past/Upcoming inline any more', () => {
  const fs = require('fs');
  const path = require('path');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(path.join(__dirname, '..')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.endsWith('objectState.js'));
  test('no `new Date(x.scheduled_at) </>= now` comparisons outside objectState.js', () => {
    const offenders = files.filter((f) => /new Date\([\w.]+\.scheduled_at\)(\.getTime\(\))? *(>=|<) *(new Date\(\)|Date\.now\(\)|now\b)/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(path.join(__dirname, '..'), f))).toEqual([]);
  });
  test('inviteExpiry and offerMedia delegate to objectState', () => {
    expect(fs.readFileSync(path.join(__dirname, 'inviteExpiry.js'), 'utf8')).toMatch(/from '\.\/objectState'/);
    expect(fs.readFileSync(path.join(__dirname, 'offerMedia.js'), 'utf8')).toMatch(/from '\.\/objectState'/);
  });
});
