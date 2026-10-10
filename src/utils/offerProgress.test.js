import fs from 'fs';
import path from 'path';
import { offerProgress, offersToAnimate, progressKey, rememberShown, PROGRESS_STEPS } from './offerProgress';
import { SEQUENCES, settleMs, MOTION_BUDGET } from '../motion/motionBudget';
import { notificationDestination } from '../navigation/notificationDestinations';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const offer = (id, status, request_id = `r-${id}`) => ({ id, status, request_id });

describe('owner item 13: Offer sent -> Accepted -> Redeemed from the stored status only', () => {
  it('maps the three path statuses and nothing else', () => {
    expect(PROGRESS_STEPS).toEqual(['sent', 'accepted', 'redeemed']);
    expect(offerProgress(offer('a', 'offered'))).toEqual({ current: 0 });
    expect(offerProgress(offer('a', 'accepted'))).toEqual({ current: 1 });
    // acceptance is not redemption: only `completed` (business-confirmed) lights Redeemed
    expect(offerProgress(offer('a', 'completed'))).toEqual({ current: 2 });
    for (const s of ['pending', 'declined', 'expired', 'cancelled', 'withdrawn', 'not_chosen', undefined]) {
      expect(offerProgress(offer('a', s))).toBeNull();
    }
    expect(offerProgress(null)).toBeNull();
  });
});

describe('when a step plays its one-time animation', () => {
  it('a plain load (first read or reopen) plays nothing', () => {
    expect(offersToAnimate([offer('a', 'accepted'), offer('b', 'completed')])).toEqual([]);
    const previous = new Map([['a', 'offered']]);
    expect(offersToAnimate([offer('a', 'accepted')], { previous, live: false })).toEqual([]);
  });

  it('live: plays only a forward move seen while open', () => {
    const previous = new Map([['a', 'offered'], ['b', 'accepted'], ['c', 'accepted']]);
    const got = offersToAnimate([offer('a', 'accepted'), offer('b', 'completed'), offer('c', 'accepted'), offer('d', 'accepted')], { previous, live: true });
    expect(got.map((o) => o.id)).toEqual(['a', 'b']); // c unchanged, d never seen before = baseline
  });

  it('live: a move off the path or backwards never plays', () => {
    const previous = new Map([['a', 'offered'], ['b', 'accepted']]);
    expect(offersToAnimate([offer('a', 'withdrawn'), offer('b', 'cancelled')], { previous, live: true })).toEqual([]);
    expect(offersToAnimate([offer('a', 'offered')], { previous: new Map([['a', 'pending']]), live: true })).toEqual([]);
  });

  it('push tap: the named request plays its current Accepted/Redeemed state once', () => {
    const offers = [offer('a', 'accepted', 'R1'), offer('b', 'accepted', 'R2'), offer('c', 'offered', 'R3')];
    expect(offersToAnimate(offers, { focusRequestId: 'R1' }).map((o) => o.id)).toEqual(['a']);
    expect(offersToAnimate(offers, { focusRequestId: 'R3' })).toEqual([]);
  });

  it('never replays what was already shown', () => {
    const o = offer('a', 'accepted', 'R1');
    const shown = new Set([progressKey(o)]);
    expect(offersToAnimate([o], { focusRequestId: 'R1', shown })).toEqual([]);
    expect(offersToAnimate([o], { previous: new Map([['a', 'offered']]), live: true, shown })).toEqual([]);
    // Redeemed is a new transition, so it can still play
    expect(offersToAnimate([offer('a', 'completed', 'R1')], { focusRequestId: 'R1', shown })).toHaveLength(1);
  });

  it('the remembered list stays bounded and deduped', () => {
    expect(rememberShown(['x', 'y'], ['y', 'z'])).toEqual(['x', 'y', 'z']);
    expect(rememberShown(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd']);
  });
});

describe('motion', () => {
  it('fits the small tier', () => {
    expect(SEQUENCES.offerProgress.tier).toBe('small');
    const ms = settleMs('offerProgress');
    expect(ms).toBeGreaterThanOrEqual(MOTION_BUDGET.small.min);
    expect(ms).toBeLessThanOrEqual(MOTION_BUDGET.small.max);
  });
  it('is arrival-driven: no haptic, Reduce Motion respected', () => {
    const src = read('motion/OfferProgressSteps.js');
    expect(src).not.toMatch(/playHaptic|expo-haptics/);
    expect(src).toMatch(/useReduceMotion/);
  });
});

describe('push + live wiring', () => {
  it('the accepted push opens the dashboard on that card', async () => {
    const d = await notificationDestination({ type: 'business_offer_accepted', request_id: 'R1', offer_id: 'O1' });
    expect(d.name).toBe('BusinessDashboard');
    expect(d.params).toMatchObject({ initialSection: 'requests', focusRequestId: 'R1' });
  });

  it('push wording: "A customer accepted your offer", body = the business-safe summary', () => {
    const sql = read('../supabase/migrations/20270291_offer_accepted_push_wording.sql');
    expect(sql).toMatch(/'A customer accepted your offer',\s*\n\s*coalesce\(public\.business_safe_request_summary\(r\.id\)/);
    expect(sql).not.toMatch(/New customer/);
  });

  it('realtime is scoped to the business, only triggers a re-read, and is removed on blur', () => {
    const src = read('screens/BusinessDashboardScreen.js');
    expect(src).toMatch(/filter: `partner_id=eq\.\$\{partnerId\}`/);
    expect(src).toMatch(/loadOpportunities\(partnerId, \{ live: true \}\)/);
    expect(src).toMatch(/supabase\.removeChannel\(channel\)/);
    expect(src).not.toMatch(/biz_offer_progress[\s\S]{0,400}payload\.new/);
  });

  it('the pipeline tile keeps its locked "Completed" wording (item 147)', () => {
    const strings = JSON.parse(read('../scripts/i18n/strings/bizDash2.json'));
    expect(strings.en['pipeline.completed']).toBe('Completed');
    expect(strings.en['progress.redeemed']).toBe('Redeemed');
  });
});
