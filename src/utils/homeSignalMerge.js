// One object, multiple signals (owner rule, 2026-09-20): the same gathering can qualify for Home through several
// signals at once -- it matches what you like, it is trending nearby, a friend is hosting it. It must render ONCE with
// every real reason attached, never once per signal. Pure function over the lists the dashboard already returns; it
// invents no signal (each reason comes from a list the gathering is really in).
//
// Placement: Best Pick keeps the hero slot and absorbs the other reasons; every other gathering becomes one card in a
// single list, ordered by how many reasons it has (then by first appearance: interest, trending, friend).
import { friendGoingReason } from './recommendationFacts';
import { interestMatch } from './interestMatch';
import { friendsInterestReason } from './friendInterests';
import { attendeeTotal } from './gatheringFullness';
import { TRENDING_ATTENDANCE_MIN } from '../constants/trending';

export const SIGNAL_TEXT = {
  // The reason is decided by interestMatch (item 60): a tag the person declared reads "Because you like X"; one that is
  // only from their activity says so; no real match = no reason (null, the signal is dropped). `declared` null = unknown
  // (older callers), treated as declared so existing behavior is unchanged.
  interest: (g, _isPast, ctx) => interestMatch(g?.interest_tag, ctx?.declared == null ? { declared: [g?.interest_tag] } : ctx).match_reason,
  // Popular, not personal: says how many are really going (approved attendees; Interested is private and never counted).
  trending: (g) => {
    const n = attendeeTotal(g);
    return n >= TRENDING_ATTENDANCE_MIN ? `Trending nearby · ${n} going` : 'Trending nearby';
  },
  soon: () => 'Starting soon',
  friend: (g, isPast) => {
    const name = g?.profiles?.display_name;
    return `${name || 'A friend'} ${isPast ? 'hosted' : 'is hosting'} this`;
  },
};

export function mergeHomeGatheringSignals({ bestPick = null, becauseYouLike = [], trending = [], friends = [], soon = [], friendIds = null, isPast = () => false, declaredInterests = null, activityCategories = [], friendInterests = null } = {}) {
  const byId = new Map();
  const order = [];
  function add(g, kind) {
    if (!g?.id) return;
    let entry = byId.get(g.id);
    if (!entry) {
      entry = { gathering: g, signals: [] };
      byId.set(g.id, entry);
      order.push(g.id);
    } else {
      entry.gathering = { ...entry.gathering, ...g };
    }
    if (!entry.signals.some((s) => s.kind === kind)) {
      const text = SIGNAL_TEXT[kind](g, kind === 'friend' ? isPast(g) : false, { declared: declaredInterests, activity: activityCategories });
      if (text) entry.signals.push({ kind, text });
    }
  }
  for (const g of becauseYouLike ?? []) add(g, 'interest');
  for (const g of trending ?? []) add(g, 'trending');
  for (const g of friends ?? []) add(g, 'friend');
  // "Starting soon" only ever adds a reason to a gathering that is already being shown; it never creates a card.
  for (const g of soon ?? []) if (byId.has(g?.id) || g?.id === bestPick?.id) add(g, 'soon');

  // "Sam is going": a connected friend among the approved attendees (accepted friends only, from the attendee rows the
  // gathering already carries). The host is left out -- "Sam is hosting this" already says it.
  const goingText = (g) => friendGoingReason(
    { approvedAttendees: (g?.approvedAttendees ?? []).filter((a) => a.user_id !== g?.host_id) },
    friendIds,
  );
  for (const entry of byId.values()) {
    const text = goingText(entry.gathering);
    if (text) entry.signals.push({ kind: 'going', text });
    // A friend's declared interest in this gathering's tag: a reason for a card already shown, never a card of its own.
    const fi = friendsInterestReason(entry.gathering?.interest_tag, friendInterests?.[entry.gathering?.interest_tag]);
    if (fi) entry.signals.push({ kind: 'friendInterest', text: fi });
  }

  let hero = null;
  if (bestPick?.id) {
    const extra = byId.get(bestPick.id);
    const reasons = [...(bestPick.reasons ?? [])];
    for (const s of extra?.signals ?? []) if (!reasons.includes(s.text)) reasons.push(s.text);
    if (!extra && (soon ?? []).some((g) => g?.id === bestPick.id)) reasons.push(SIGNAL_TEXT.soon());
    hero = { ...(extra?.gathering ?? {}), ...bestPick, reasons };
    const going = goingText(hero);
    if (going && !reasons.includes(going)) reasons.push(going);
    const heroFi = friendsInterestReason(hero.interest_tag, friendInterests?.[hero.interest_tag]);
    if (heroFi && !reasons.includes(heroFi)) reasons.push(heroFi);
  }

  const cards = order
    .filter((id) => id !== hero?.id && byId.get(id).signals.length > 0)
    .map((id, index) => ({ ...byId.get(id), index }))
    .sort((a, b) => b.signals.length - a.signals.length || a.index - b.index)
    .map(({ gathering, signals }) => ({
      gathering,
      signals,
      reasons: signals.map((s) => s.text),
      hasFriend: signals.some((s) => s.kind === 'friend'),
      trendingOnly: signals.length === 1 && signals[0].kind === 'trending',
    }));

  return { hero, cards };
}
