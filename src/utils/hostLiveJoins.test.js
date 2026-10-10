import fs from 'fs';
import path from 'path';
import { approvedIds, newJoinsToAnimate } from './hostLiveJoins';
import { SEQUENCES, settleMs, MOTION_BUDGET } from '../motion/motionBudget';

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const row = (user_id, status = 'approved') => ({ user_id, status });

describe('item 15: someone joined the host\'s gathering while it was open', () => {
  const previousIds = new Set(['a']);

  it('plays for a genuine new join seen live', () => {
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds, previousGoing: 2, going: 3, live: true })).toEqual(['b']);
  });
  it('first read, focus reload and reopen are the baseline', () => {
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds: null, previousGoing: null, going: 3, live: true })).toEqual([]);
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds, previousGoing: 2, going: 3, live: false })).toEqual([]);
  });
  it('a duplicate realtime event never replays it', () => {
    const shown = new Set(['b']);
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds, previousGoing: 2, going: 3, live: true, shown })).toEqual([]);
    // the re-read after the first glow has b in its baseline and an unchanged count
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds: new Set(['a', 'b']), previousGoing: 3, going: 3, live: true })).toEqual([]);
  });
  it('only approved joins count: a pending request, a waitlist entry or a leave plays nothing', () => {
    expect(newJoinsToAnimate([row('a'), row('b', 'pending')], { previousIds, previousGoing: 2, going: 2, live: true })).toEqual([]);
    expect(newJoinsToAnimate([row('a'), row('b', 'waitlisted')], { previousIds, previousGoing: 2, going: 2, live: true })).toEqual([]);
    expect(newJoinsToAnimate([], { previousIds, previousGoing: 2, going: 1, live: true })).toEqual([]);
  });
  it('a failed rows lookup (empty) followed by a good read never looks like N new joins: the server count must rise', () => {
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds: new Set(), previousGoing: 3, going: 3, live: true })).toEqual([]);
    expect(newJoinsToAnimate([row('a'), row('b')], { previousIds, previousGoing: null, going: 3, live: true })).toEqual([]);
  });
  it('approvedIds keeps only approved rows with a person', () => {
    expect([...approvedIds([row('a'), row('b', 'pending'), { status: 'approved' }])]).toEqual(['a']);
  });

  it('one small-tier glow, success colour, Reduce Motion via the shared glow, no haptic', () => {
    expect(SEQUENCES.hostJoin.tier).toBe('small');
    const ms = settleMs('hostJoin');
    expect(ms).toBeGreaterThanOrEqual(MOTION_BUDGET.small.min);
    expect(ms).toBeLessThanOrEqual(MOTION_BUDGET.small.max);
    const center = src('components/HostCommandCenter.js');
    expect(center).toMatch(/<OfferProgressGlow key=\{joinGlowKey\} play color=\{colors\.success\}[^>]*SEQUENCES\.hostJoin/);
    expect(center).not.toMatch(/playHaptic|expo-haptics/);
    expect(src('motion/OfferProgressSteps.js')).toMatch(/useReduceMotion/);
  });

  it('host only, realtime re-reads stored state (event never read), removed on blur', () => {
    const screen = src('screens/GatheringDetailScreen.js');
    expect(screen).toMatch(/useFocusEffect\(useCallback\(\(\) => \{\n    if \(!isHostViewer \|\| !gatheringId\) return undefined;[\s\S]{0,200}subscribeToGatheringJoinChanges\(gatheringId, \(\) => \{/);
    expect(screen).toMatch(/liveJoinReloadRef\.current = true; load\(\);/);
    expect(screen).toMatch(/unsubscribe\(\);/);
    const svc = src('services/gatherings.js');
    expect(svc).toMatch(/table: 'gathering_interest', filter: `gathering_id=eq\.\$\{gatheringId\}` \}, \(\) => onChange\(\)\)/);
  });
});

describe('item 15: routine interaction does not animate', () => {
  const gone = ['motion/TapActiveChip.js', 'motion/useTapActivate.js', 'motion/FilterTransition.js', 'components/StaggeredReveal.js', 'components/AnimatedListItem.js'];
  it('the decorative tap pop, filter dip and list cascades are gone and stay gone', () => {
    for (const f of gone) expect(fs.existsSync(path.join(__dirname, '..', f))).toBe(false);
    expect(SEQUENCES.cascade).toBeUndefined();
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(path.join(__dirname, '..')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      expect([f, /<(TapActiveChip|FilterTransition|StaggeredReveal|AnimatedListItem)\b/.test(s)]).toEqual([f, false]);
      // ModeTransition is kept only for an offer card's own real status change, never a tab or mode switch
      if (/<ModeTransition\b/.test(s)) expect([f, /<ModeTransition activeKey=\{o\.status\}>/.test(s)]).toEqual([f, true]);
    }
  });
});
