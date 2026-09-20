// Home is not a feed of feeds (owner item 50). Every recommendation engine (Best Pick, Because You Like, Trending,
// Friends' Activity, Starting Soon, the ranked Recommended list, perks) FEEDS this one selector, and the UI shows only
// what deserves attention right now: at most MAX_HOME_ATTENTION things in total (the Best Pick lead counts as one).
// The selector invents nothing: each candidate keeps only the reasons it really earned, one object appears once
// (rule 3), and anything that does not make the cut simply is not on Home (it lives on Discover / Gatherings).
//
// Ranking of the non-lead candidates, all from real fields:
//   +3 starts inside the Right Now window (time-sensitive beats evergreen)
//   +2 a friend is hosting or going
//   +1 per additional real reason (signals)
//   ties: the order the engines already ranked them (merged cards, then the ranked list, then starting-soon)
// Not covered here on purpose: Your Plans, invites, Quick Picks and Start Something are the person's OWN things and
// actions, not recommendations, so they are not competing for these slots.
import { isWithinRightNowWindow } from './rightNowWindow';
import { recommendationRow } from './recommendationFacts';

export const MAX_HOME_ATTENTION = 5;

function urgency(g, now) {
  return g?.scheduled_at && isWithinRightNowWindow(g.scheduled_at, now) ? 3 : 0;
}

// hero/cards come from mergeHomeGatheringSignals; recommended = buildHomeRecommendations rows ({type,id,title,reasons,data});
// soon = gatherings starting soon that the merge did not already show.
export function selectHomeAttention({ hero = null, cards = [], recommended = [], soon = [], now = new Date(), max = MAX_HOME_ATTENTION } = {}) {
  const seen = new Set([hero?.id, ...cards.map((c) => c.gathering?.id)].filter(Boolean));
  const candidates = cards.map((c, i) => ({ kind: 'gathering', ...c, order: i }));
  let order = cards.length;
  for (const item of recommended ?? []) {
    if (!item?.id) continue;
    if (item.type === 'perk') {
      candidates.push({ kind: 'perk', item, signals: [], order: order++ });
      continue;
    }
    if (seen.has(item.id)) continue; // already shown, with its own reasons
    seen.add(item.id);
    const why = recommendationRow(item).why;
    const signals = why ? [{ kind: 'recommended', text: why }] : [];
    candidates.push({ kind: 'gathering', gathering: item.data ?? { id: item.id, title: item.title }, signals, reasons: signals.map((s) => s.text), hasFriend: false, trendingOnly: false, order: order++ });
  }
  for (const g of soon ?? []) {
    if (!g?.id || seen.has(g.id)) continue;
    seen.add(g.id);
    const signals = [{ kind: 'soon', text: 'Starting soon' }];
    candidates.push({ kind: 'gathering', gathering: g, signals, reasons: ['Starting soon'], hasFriend: false, trendingOnly: false, order: order++ });
  }
  const score = (c) => {
    if (c.kind === 'perk') return 0;
    const extra = Math.max(0, (c.signals?.length ?? 0) - 1);
    const friend = c.hasFriend || c.signals?.some((s) => s.kind === 'going') ? 2 : 0;
    return urgency(c.gathering, now) + friend + extra;
  };
  const room = Math.max(0, max - (hero ? 1 : 0));
  const ranked = candidates
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.c.order - b.c.order)
    .map(({ c }) => c);
  const items = ranked.slice(0, room);
  return { hero, items, total: (hero ? 1 : 0) + candidates.length, shown: (hero ? 1 : 0) + items.length };
}
