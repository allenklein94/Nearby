// Owner item 35: "How was it?" feedback ranks both ways. Explicit feedback > guessing.
import { feedbackFor, feedbackPoints, experienceFeedbackFromRow, applyExperienceFeedback, FEEDBACK_POINTS, EMPTY_EXPERIENCE_FEEDBACK, LOVED_REASONS } from './experienceFeedback';
import { EXPLICIT_POINTS, BEHAVIOR_MAX_POINTS } from '../constants/blendedRanking';
import { applyLearnedAffinity, comparePersonalTieBreak } from './learnedAffinity';
import { selectHomeAttention } from './homeAttention';
import { reasonTier, SIGNAL_TIERS, TYPED_ASK_SIGNAL_TIER } from '../constants/signalPriority';
import { SIGNAL_CODES } from './typedAskAudit';

const fb = (row) => experienceFeedbackFromRow(row);

describe('feedbackFor (the one reader)', () => {
  it('no feedback, or nothing about this item = no change', () => {
    expect(feedbackFor({ hostId: 'h', category: 'Coffee' }, null).direction).toBe(0);
    expect(feedbackFor({ hostId: 'h', category: 'Coffee' }, EMPTY_EXPERIENCE_FEEDBACK).direction).toBe(0);
    expect(feedbackFor({ hostId: 'h', category: 'Coffee' }, fb({ loved_categories: ['Tea'] })).direction).toBe(0);
    expect(experienceFeedbackFromRow(null).lovedKinds.size).toBe(0);
  });

  it('loved lifts with its reason; Not for me lowers with none', () => {
    expect(feedbackFor({ category: 'Coffee' }, fb({ loved_categories: ['Coffee'] }))).toMatchObject({ direction: 1, scope: 'kind', reason: 'You loved this kind of experience last time' });
    expect(feedbackFor({ hostId: 'h' }, fb({ loved_host_ids: ['h'] }))).toMatchObject({ direction: 1, scope: 'host', reason: 'You loved a gathering with this host before' });
    expect(feedbackFor({ partnerId: 'p' }, fb({ loved_partner_ids: ['p'] }))).toMatchObject({ direction: 1, scope: 'business', reason: 'You loved this business last time' });
    for (const row of [{ not_for_me_categories: ['Coffee'] }, { not_for_me_host_ids: ['h'] }, { not_for_me_partner_ids: ['p'] }]) {
      expect(feedbackFor({ hostId: 'h', partnerId: 'p', category: 'Coffee' }, fb(row))).toMatchObject({ direction: -1, reason: null });
    }
  });

  it('most specific wins: host > business > kind, one decision, never stacked', () => {
    const f = fb({ loved_host_ids: ['h'], not_for_me_partner_ids: ['p'], not_for_me_categories: ['Coffee'] });
    expect(feedbackFor({ hostId: 'h', partnerId: 'p', category: 'Coffee' }, f)).toMatchObject({ direction: 1, scope: 'host', dropsLearned: true });
    expect(feedbackFor({ partnerId: 'p', category: 'Coffee' }, fb({ not_for_me_partner_ids: ['p'], loved_categories: ['Coffee'] }))).toMatchObject({ direction: -1, scope: 'business' });
    expect(feedbackPoints({ hostId: 'h', category: 'Coffee' }, fb({ loved_host_ids: ['h'], loved_categories: ['Coffee'] }))).toBe(FEEDBACK_POINTS);
  });

  it('weighs as much as a declared interest, so it always beats a learned guess', () => {
    expect(FEEDBACK_POINTS).toBe(EXPLICIT_POINTS);
    expect(FEEDBACK_POINTS).toBeGreaterThan(BEHAVIOR_MAX_POINTS);
  });

  it('the loved reasons are personal (interest tier), stronger than distance or popularity', () => {
    for (const r of LOVED_REASONS) expect(reasonTier(r)).toBe(SIGNAL_TIERS.interest);
  });
});

describe('typed asks (applyExperienceFeedback)', () => {
  const pool = () => [{ id: 'a', category: 'Coffee', partnerId: 'p1', score: 10 }, { id: 'b', category: 'Coffee', partnerId: 'p2', score: 10 }];

  it('Not for me lowers, loved lifts, both counted as history; nothing added or removed', () => {
    const out = applyExperienceFeedback(pool(), fb({ not_for_me_partner_ids: ['p1'], loved_partner_ids: ['p2'] }));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ score: 10 - FEEDBACK_POINTS, historyScore: -FEEDBACK_POINTS });
    expect(out[1]).toMatchObject({ score: 10 + FEEDBACK_POINTS, historyScore: FEEDBACK_POINTS });
    expect(out[1].reasons).toContain('You loved this business last time');
    expect(out[0].reasons ?? []).toEqual([]);
  });

  it('a gathering is matched by its host, and by its hosting business', () => {
    const [g1, g2] = applyExperienceFeedback(
      [{ category: 'Hiking', host_id: 'h', score: 0 }, { category: 'Hiking', host_id: 'x', hostingPartnerId: 'p', score: 0 }],
      fb({ not_for_me_host_ids: ['h'], loved_partner_ids: ['p'] }),
    );
    expect(g1.score).toBe(-FEEDBACK_POINTS);
    expect(g2.score).toBe(FEEDBACK_POINTS);
  });

  it('under a stated constraint it is only a literal tie-breaker (score untouched)', () => {
    const [a, b] = applyExperienceFeedback(pool(), fb({ not_for_me_partner_ids: ['p1'] }), { constrained: true });
    expect(a.score).toBe(10);
    expect(a.learnedTieBreak).toBe(-FEEDBACK_POINTS);
    expect(comparePersonalTieBreak(a, b)).toBeGreaterThan(0); // b ahead
  });

  it('a kind called Not for me cancels the learned-activity lift for it (explicit > guessing)', () => {
    const learned = { behavior: { Coffee: 12 }, maturity: 1 };
    const [lifted] = applyLearnedAffinity([{ category: 'Coffee', score: 0 }], learned);
    expect(lifted.score).toBeGreaterThan(0);
    const [kept] = applyLearnedAffinity([{ category: 'Coffee', score: 0 }], learned, { notForMeKinds: new Set(['Coffee']) });
    expect(kept.score).toBe(0);
    expect(kept.reasons ?? []).toEqual([]);
  });

  it('is a registered, recorded typed-ask pass in the personal-interest tier', () => {
    expect(TYPED_ASK_SIGNAL_TIER.experience_feedback).toBe(SIGNAL_TIERS.interest);
    expect(SIGNAL_CODES.experience_feedback).toBe('personal_interest');
  });
});

describe('Home Picked For You (selectHomeAttention)', () => {
  const now = new Date(2026, 8, 20, 15, 0);
  const at = (mins) => new Date(now.getTime() + mins * 60000).toISOString();
  const card = (id, extra = {}) => ({
    gathering: { id, title: id, scheduled_at: at(900), interest_tag: 'Coffee', ...extra },
    signals: [{ kind: 'interest', text: 'Because you like Coffee' }], reasons: ['Because you like Coffee'], hasFriend: false, trendingOnly: false,
  });

  it('Not for me ranks a card below an equal one; loved ranks it above', () => {
    const cards = [card('a', { host_id: 'h1' }), card('b', { host_id: 'h2' }), card('c', { host_id: 'h3' })];
    const ids = selectHomeAttention({ cards, now, feedback: fb({ not_for_me_host_ids: ['h1'], loved_host_ids: ['h3'] }) }).items.map((i) => i.gathering.id);
    expect(ids).toEqual(['c', 'b', 'a']);
  });

  it('without feedback the order is unchanged', () => {
    const cards = [card('a', { host_id: 'h1' }), card('b', { host_id: 'h2' })];
    expect(selectHomeAttention({ cards, now }).items.map((i) => i.gathering.id)).toEqual(['a', 'b']);
  });

  it('the loved reason line is not counted twice on top of the feedback', () => {
    const loved = { type: 'gathering', id: 'r', title: 'r', reasons: ['You loved a gathering with this host before'], data: { id: 'r', host_id: 'h', scheduled_at: at(900) } };
    const interest = card('i');
    const ids = selectHomeAttention({ cards: [interest], recommended: [loved], now, feedback: fb({ loved_host_ids: ['h'] }) }).items.map((i) => i.gathering.id);
    expect(ids).toEqual(['i', 'r']); // one interest point each; tie keeps the engines' order
  });

  it('a Best Pick the person called Not for me loses the lead and competes like any card', () => {
    const hero = { id: 'h', title: 'h', scheduled_at: at(900), interest_tag: 'Coffee', reasons: ['Because you like Coffee'] };
    const out = selectHomeAttention({ hero, cards: [card('x', { interest_tag: 'Tea' })], now, feedback: fb({ not_for_me_categories: ['Coffee'] }) });
    expect(out.hero).toBeNull();
    expect(out.items.map((i) => i.gathering.id)).toEqual(['x', 'h']);
    const kept = selectHomeAttention({ hero, cards: [], now, feedback: fb({ loved_categories: ['Coffee'] }) });
    expect(kept.hero?.id).toBe('h');
  });

  it('a perk from a business the person called Not for me ranks below another perk', () => {
    const perk = (id, partner) => ({ type: 'perk', id, title: id, reasons: ['At X'], data: { id, partner_id: partner } });
    const out = selectHomeAttention({ recommended: [perk('p1', 'bad'), perk('p2', 'ok')], now, feedback: fb({ not_for_me_partner_ids: ['bad'] }) });
    expect(out.items.map((i) => i.item.id)).toEqual(['p2', 'p1']);
  });
});
