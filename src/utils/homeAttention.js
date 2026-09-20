// Home is not a feed of feeds (owner item 50). Every recommendation engine (Best Pick, Because You Like, Trending,
// Friends' Activity, Starting Soon, the ranked Recommended list, perks) FEEDS this one selector, and the UI shows only
// what deserves attention right now: at most MAX_HOME_ATTENTION things in total (the Best Pick lead counts as one).
// The selector invents nothing: each candidate keeps only the reasons it really earned, one object appears once
// (rule 3), and anything that does not make the cut simply is not on Home (it lives on Discover / Gatherings).
//
// Ranking of the non-lead candidates follows the signal priority (constants/signalPriority.js): each candidate is placed
// by its STRONGEST real signal -- explicit current intent, then plan/friend activity, time relevance, personal interest,
// business offer, local popularity, weather, general discovery -- so a trending event cannot outrank something the person
// asked for. Ties: more real reasons, then the order the engines already ranked them.
// Not covered here on purpose: Your Plans, invites, Quick Picks and Start Something are the person's OWN things and
// actions, not recommendations, so they are not competing for these slots.
import { isWithinRightNowWindow } from './rightNowWindow';
import { recommendationRow } from './recommendationFacts';
import { bestTier } from '../constants/signalPriority';

export const MAX_HOME_ATTENTION = 5;

function isUrgent(g, now) {
  return !!g?.scheduled_at && isWithinRightNowWindow(g.scheduled_at, now);
}

// hero/cards come from mergeHomeGatheringSignals; recommended = buildHomeRecommendations rows ({type,id,title,reasons,data});
// soon = gatherings starting soon that the merge did not already show.
//
// Global dedupe (items 51 + 52, LOCKED): a gathering appears only ONCE anywhere on Home. `exclude` = ids of objects
// already rendered in a HIGHER-priority placement (see HOME_SECTION_PRIORITY). An excluded object is not rendered again;
// its real reasons come back in `absorbed` (id -> [reason text]) so an earlier surface that has room can show them. The
// Best Pick lead is NOT exempt: if its gathering is already above, the lead is dropped (hero = null) and the freed slot
// is refilled by the next eligible candidate like any other.
export function selectHomeAttention({ hero = null, cards = [], recommended = [], soon = [], exclude = null, intentTags = null, now = new Date(), max = MAX_HOME_ATTENTION } = {}) {
  const absorbed = new Map();
  const isAbove = (id) => !!exclude && exclude.has(id);
  const absorb = (id, texts) => {
    const list = absorbed.get(id) ?? [];
    for (const t of texts) if (t && !list.includes(t)) list.push(t);
    absorbed.set(id, list);
  };
  if (hero && isAbove(hero.id)) {
    absorb(hero.id, hero.reasons ?? []);
    hero = null;
  }
  const visibleCards = [];
  for (const c of cards) {
    if (isAbove(c.gathering?.id)) absorb(c.gathering.id, c.reasons ?? []);
    else visibleCards.push(c);
  }
  cards = visibleCards;
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
    if (isAbove(item.id)) { absorb(item.id, why ? [why] : []); continue; }
    const signals = why ? [{ kind: 'recommended', text: why }] : [];
    candidates.push({ kind: 'gathering', gathering: item.data ?? { id: item.id, title: item.title }, signals, reasons: signals.map((s) => s.text), hasFriend: false, trendingOnly: false, order: order++ });
  }
  for (const g of soon ?? []) {
    if (!g?.id || seen.has(g.id)) continue;
    seen.add(g.id);
    if (isAbove(g.id)) { absorb(g.id, ['Starting soon']); continue; }
    const signals = [{ kind: 'soon', text: 'Starting soon' }];
    candidates.push({ kind: 'gathering', gathering: g, signals, reasons: ['Starting soon'], hasFriend: false, trendingOnly: false, order: order++ });
  }
  // `intentTags`: the interest categories of the active Ask-Nearby search (lower-cased), or null when none is active.
  const matchesIntent = (g) => !!intentTags && intentTags.size > 0 && typeof g?.interest_tag === 'string' && intentTags.has(g.interest_tag.toLowerCase());
  const tierOf = (c) => (c.kind === 'perk'
    ? bestTier([], { business: true })
    : bestTier(c.signals ?? [], { intent: matchesIntent(c.gathering), urgent: isUrgent(c.gathering, now) }));
  const strength = (c) => (c.signals?.length ?? 0);
  const room = Math.max(0, max - (hero ? 1 : 0));
  const ranked = candidates
    .map((c) => ({ c, tier: tierOf(c) }))
    .sort((a, b) => a.tier - b.tier || strength(b.c) - strength(a.c) || a.c.order - b.c.order)
    .map(({ c }) => c);
  const items = ranked.slice(0, room);
  return { hero, items, absorbed, total: (hero ? 1 : 0) + candidates.length, shown: (hero ? 1 : 0) + items.length };
}

// Rows of a card (the weather card) minus objects already rendered in a higher placement; a card left with no rows does
// not render (it has nothing to point at).
export function cardWithoutIds(card, ids) {
  if (!card) return null;
  const gatherings = (card.gatherings ?? []).filter((g) => !ids?.has(g.id));
  return gatherings.length > 0 ? { ...card, gatherings } : null;
}

// Home placements, highest priority first. A gathering is rendered in the FIRST section (top of this list) that would
// surface it; every later section suppresses it and refills. Sections that list gatherings are all covered here.
// Deliberately outside the rule (not "a listing of a gathering"): intent-search results (the person's own query),
// action nudges about a plan they already own (venue needed, RSVPs outstanding, poll), group plans (different object),
// and the non-gathering sections (invites, occasions, communities, Quick Picks, goal shortcuts, Quick Stats).
export const HOME_SECTION_PRIORITY = ['firstRun', 'yourPlans', 'weather', 'bestPick', 'pickedForYou'];
