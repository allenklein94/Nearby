// Owner idea "207" (2026-10-18, option a): one meaningful animation per Home visit.
const fs = require('fs');
const path = require('path');
import { createHomeMomentBudget, HOME_MOMENT_ORDER } from './homeMomentBudget';
import { hasNewHappening, takeNewHappening } from './happeningSeen';
import { collisionWouldPlay, takeCollisionPlay, collisionPlayKey } from './friendCollision';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const playing = (out) => Object.keys(out).filter((m) => out[m]);
const ALL = { friendCollision: 'f:g', planCompleted: 'g1', friendsPlanning: 'a|b', happeningRipple: 'x|y', plansThisMonth: 'k1' };

describe('the rule', () => {
  it('order is Home\'s top-to-bottom order', () => {
    expect(HOME_MOMENT_ORDER).toEqual(['friendCollision', 'planCompleted', 'friendsPlanning', 'happeningRipple', 'plansThisMonth']);
  });

  it('several ready together: only the highest plays, the rest settle', () => {
    const decide = createHomeMomentBudget();
    expect(playing(decide({ focused: true, candidates: ALL }))).toEqual(['friendCollision']);
    const lower = createHomeMomentBudget();
    expect(playing(lower({ focused: true, candidates: { happeningRipple: 'x', plansThisMonth: 'k', planCompleted: 'g' } }))).toEqual(['planCompleted']);
  });

  it('one per visit: a moment that becomes ready after another played settles, even if it is higher (no queue)', () => {
    const decide = createHomeMomentBudget();
    expect(playing(decide({ focused: true, candidates: { plansThisMonth: 'k' } }))).toEqual(['plansThisMonth']);
    const later = decide({ focused: true, candidates: { plansThisMonth: 'k', friendCollision: 'f:g' } });
    expect(later).toMatchObject({ plansThisMonth: true, friendCollision: false });
  });

  it('decisions are stable across re-renders (the winner keeps playing, nothing flips mid-moment)', () => {
    const decide = createHomeMomentBudget();
    const first = decide({ focused: true, candidates: ALL });
    for (let i = 0; i < 3; i += 1) expect(decide({ focused: true, candidates: ALL })).toEqual(first);
  });

  it('a settled moment counts as seen: never plays on a later visit and never takes that visit\'s slot', () => {
    const decide = createHomeMomentBudget();
    decide({ focused: true, candidates: { planCompleted: 'g1', happeningRipple: 'x' } }); // planCompleted plays, ripple settles
    decide({ focused: false, candidates: {} });
    const next = decide({ focused: true, candidates: { planCompleted: 'g1', happeningRipple: 'x', plansThisMonth: 'k2' } });
    expect(next).toMatchObject({ planCompleted: true, happeningRipple: false, plansThisMonth: true });
    // planCompleted's true is the old decision (its component decided at mount and does not replay); the new visit's
    // one slot went to the only NEW moment.
  });

  it('a new visit gets its own one moment', () => {
    const decide = createHomeMomentBudget();
    expect(playing(decide({ focused: true, candidates: { plansThisMonth: 'k1' } }))).toEqual(['plansThisMonth']);
    decide({ focused: false });
    expect(decide({ focused: true, candidates: { plansThisMonth: 'k1', happeningRipple: 'new' } })).toMatchObject({ happeningRipple: true });
  });

  it('while Home is not in front nothing is decided, so a moment keeps its chance for when the person arrives', () => {
    const decide = createHomeMomentBudget();
    expect(playing(decide({ focused: false, candidates: ALL }))).toEqual([]);
    expect(playing(decide({ focused: true, candidates: ALL }))).toEqual(['friendCollision']);
  });

  it('while Home is loading nothing is decided: the first frame after the spinner ranks everything that has landed', () => {
    // Home passes focused: homeFocused && !loading. Behind the spinner the load's results arrive one by one; the bottom
    // moment landing first must not take the slot from a higher one that lands a moment later.
    const decide = createHomeMomentBudget();
    const loading = true;
    expect(playing(decide({ focused: true && !loading, candidates: { plansThisMonth: 'k' } }))).toEqual([]);
    expect(playing(decide({ focused: true && !loading, candidates: { plansThisMonth: 'k', happeningRipple: 'x' } }))).toEqual([]);
    const done = decide({ focused: true, candidates: { plansThisMonth: 'k', happeningRipple: 'x', planCompleted: 'g' } });
    expect(playing(done)).toEqual(['planCompleted']);
    expect(done).toMatchObject({ happeningRipple: false, plansThisMonth: false });
  });

  it('nothing ready = nothing plays; empty keys are not candidates', () => {
    const decide = createHomeMomentBudget();
    expect(playing(decide({ focused: true, candidates: {} }))).toEqual([]);
    expect(playing(decide({ focused: true, candidates: { friendsPlanning: '', planCompleted: null } }))).toEqual([]);
    expect(playing(decide({ focused: true, candidates: { planCompleted: 'g' } }))).toEqual(['planCompleted']);
  });
});

describe('peeks never mark anything seen', () => {
  it('hasNewHappening mirrors takeNewHappening without taking', () => {
    const store = new Set();
    expect(hasNewHappening(['a'], store)).toBe(true);
    expect(store.size).toBe(0);
    takeNewHappening(['a'], store);
    expect(hasNewHappening(['a'], store)).toBe(false);
    expect(hasNewHappening(['a', 'b'], store)).toBe(true);
    expect(hasNewHappening([], store)).toBe(false);
  });

  it('collisionWouldPlay mirrors takeCollisionPlay without taking', () => {
    const store = new Set();
    const c = { gatheringId: 'g', friend: { id: 'f', name: 'Sam' } };
    expect(collisionPlayKey(c)).toBe('f:g');
    expect(collisionWouldPlay(c, store)).toBe(true);
    expect(store.size).toBe(0);
    expect(takeCollisionPlay(c, store)).toBe(true);
    expect(collisionWouldPlay(c, store)).toBe(false);
    expect(collisionWouldPlay(null, store)).toBe(false);
  });
});

describe('wiring', () => {
  const home = read('screens/HomeScreen.js');

  it('Home asks once per render, with every moment\'s own rule as its candidate', () => {
    expect(home).toMatch(/createHomeMomentBudget\(\)/);
    expect(home).toMatch(/focused: homeFocused && !loading,/); // never decided behind the loading spinner
    expect(home).toMatch(/friendCollision: collisionWouldPlay\(collision\)/);
    expect(home).toMatch(/planCompleted: homePlans\.completed && completedPlan\?\.play/);
    expect(home).toMatch(/friendsPlanningPlay === friendsPlanningKey/);
    expect(home).toMatch(/happeningRipple: rightNowIds\.length > 0 && hasNewHappening\(rightNowIds\)/);
    expect(home).toMatch(/plansThisMonth: plansMonth\?\.play && showPlansThisMonth\(plansMonth\.count\)/);
  });

  it('every Home moment is gated by the decision', () => {
    expect(home.match(/<FriendCollision [^>]*allowed=\{homeMoments\.friendCollision\}/g)).toHaveLength(2);
    expect(home).toMatch(/<PlanCompleted [^>]*play=\{homeMoments\.planCompleted\}/);
    expect(home).toMatch(/playKey=\{homeMoments\.friendsPlanning \? friendsPlanningPlay : null\}/);
    expect(home).toMatch(/<HappeningRipple ids=\{rightNowIds\} [^>]*allowed=\{homeMoments\.happeningRipple\}/);
    expect(home).toMatch(/play=\{homeMoments\.plansThisMonth\}/);
    expect(home).not.toMatch(/play=\{plansMonth\.play\}/);
  });

  it('the decision is computed above every early return (hooks order)', () => {
    expect(home.indexOf('useIsFocused()')).toBeLessThan(home.indexOf('if (loading) {'));
    expect(home.indexOf('homeMomentBudgetRef.current({')).toBeLessThan(home.indexOf('if (loading) {'));
  });

  it('a settled moment is still recorded as seen through its own store', () => {
    const collision = read('motion/FriendCollision.js');
    expect(collision).toMatch(/takeCollisionPlay\(collision\) && allowed && !reduceMotion/); // take first, then gate
    const ripple = read('motion/HappeningRipple.js');
    expect(ripple.indexOf('takeNewHappening(ids)')).toBeLessThan(ripple.indexOf('!allowed) return'));
  });

  it('exempt moments are not asked: weather fade, own-tap feedback, typed-ask results', () => {
    const budget = read('utils/homeMomentBudget.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const name of ['weather', 'WeatherShift', 'InterestedSaved', 'Toast', 'StrongMatch', 'FoundLine', 'NearbyPick', 'AskUnderstood']) {
      expect(budget).not.toMatch(new RegExp(name));
    }
    expect(home).not.toMatch(/<WeatherShift [^>]*homeMoments/);
    expect(home).not.toMatch(/<StrongMatch [^>]*homeMoments/);
  });

  it('no queue, timer or animation in the rule', () => {
    const budget = read('utils/homeMomentBudget.js');
    expect(budget).not.toMatch(/setTimeout|setInterval|Animated|requestAnimationFrame|queue\.push/);
  });
});
