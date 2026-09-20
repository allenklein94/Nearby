// One object, multiple signals (owner rule, 2026-09-20): the same gathering can qualify for Home through several
// signals at once -- it matches what you like, it is trending nearby, a friend is hosting it. It must render ONCE with
// every real reason attached, never once per signal. Pure function over the lists the dashboard already returns; it
// invents no signal (each reason comes from a list the gathering is really in).
//
// Placement: Best Pick keeps the hero slot and absorbs the other reasons; every other gathering becomes one card in a
// single list, ordered by how many reasons it has (then by first appearance: interest, trending, friend).
import { friendGoingReason } from './recommendationFacts';

export const SIGNAL_TEXT = {
  interest: (g) => (g?.interest_tag ? `Because you like ${g.interest_tag}` : 'Because of your interests'),
  trending: () => 'Trending nearby',
  friend: (g, isPast) => {
    const name = g?.profiles?.display_name;
    return `${name || 'A friend'} ${isPast ? 'hosted' : 'is hosting'} this`;
  },
};

export function mergeHomeGatheringSignals({ bestPick = null, becauseYouLike = [], trending = [], friends = [], friendIds = null, isPast = () => false } = {}) {
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
      entry.signals.push({ kind, text: SIGNAL_TEXT[kind](g, kind === 'friend' ? isPast(g) : false) });
    }
  }
  for (const g of becauseYouLike ?? []) add(g, 'interest');
  for (const g of trending ?? []) add(g, 'trending');
  for (const g of friends ?? []) add(g, 'friend');

  // "Sam is going": a connected friend among the approved attendees (accepted friends only, from the attendee rows the
  // gathering already carries). The host is left out -- "Sam is hosting this" already says it.
  const goingText = (g) => friendGoingReason(
    { approvedAttendees: (g?.approvedAttendees ?? []).filter((a) => a.user_id !== g?.host_id) },
    friendIds,
  );
  for (const entry of byId.values()) {
    const text = goingText(entry.gathering);
    if (text) entry.signals.push({ kind: 'going', text });
  }

  let hero = null;
  if (bestPick?.id) {
    const extra = byId.get(bestPick.id);
    const reasons = [...(bestPick.reasons ?? [])];
    for (const s of extra?.signals ?? []) if (!reasons.includes(s.text)) reasons.push(s.text);
    hero = { ...(extra?.gathering ?? {}), ...bestPick, reasons };
    const going = goingText(hero);
    if (going && !reasons.includes(going)) reasons.push(going);
  }

  const cards = order
    .filter((id) => id !== hero?.id)
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
