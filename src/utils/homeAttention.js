// Home is not a feed of feeds (owner item 50). Every recommendation engine (Best Pick, Because You Like, Trending,
// Friends' Activity, Starting Soon, the ranked Recommended list, perks) FEEDS this one selector, and the UI shows only
// what deserves attention right now: at most MAX_HOME_ATTENTION things in total (the Best Pick lead counts as one).
// The selector invents nothing: each candidate keeps only the reasons it really earned, one object appears once
// (rule 3), and anything that does not make the cut simply is not on Home (it lives on Discover / Gatherings).
//
// Ranking of the non-lead candidates follows the signal priority (constants/signalPriority.js): each candidate is placed
// by its STRONGEST real signal -- explicit current intent, then plan/friend activity, time relevance, personal interest,
// business offer, local popularity, weather, general discovery -- so a trending event cannot outrank something the person
// asked for. Unified ranking (step 5): each candidate's key is its TIER VECTOR (one point per real reason in that reason's
// tier, plus one per flag the selector knows: intent match, Right Now window, perk), compared tier by tier from the
// strongest; ties keep the order the engines already ranked them.
// Not covered here on purpose: Your Plans, invites, Quick Picks and Start Something are the person's OWN things and
// actions, not recommendations, so they are not competing for these slots.
import { isWithinRightNowWindow } from './rightNowWindow';
import { recommendationRow } from './recommendationFacts';
import { signalTier, tierVector, compareTierVectors, SIGNAL_TIERS } from '../constants/signalPriority';

// Item 33 (owner, 2026-10-08): Home hierarchy = intent, Picked For You (2-3), Your Plans (1-3) + See all, the social line,
// Nearby Right Now (2-3), then more. Each list is capped at 3.
export const MAX_HOME_ATTENTION = 3;
export const MAX_HOME_PLANS = 3;
export const MAX_HOME_RIGHT_NOW = 3;

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
  const vectorOf = (c) => {
    if (c.kind === 'perk') return tierVector([{ tier: SIGNAL_TIERS.business, delta: 1 }]);
    const parts = (c.signals ?? []).map((sig) => ({ tier: signalTier(sig), delta: 1 }));
    if (matchesIntent(c.gathering)) parts.push({ tier: SIGNAL_TIERS.intent, delta: 1 });
    if (isUrgent(c.gathering, now)) parts.push({ tier: SIGNAL_TIERS.time, delta: 1 });
    return tierVector(parts);
  };
  const room = Math.max(0, max - (hero ? 1 : 0));
  const ranked = candidates
    .map((c) => ({ c, v: vectorOf(c) }))
    .sort((a, b) => compareTierVectors(a.v, b.v) || a.c.order - b.c.order)
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
//
// `expandedList` (item 136 follow-up, owner 2026-10-01): a list the person OPENED by tapping a Home statement ("2 of your
// friends are making plans", "N things start soon"). What they asked to see is never trimmed: it shows every gathering
// the statement counted, and while it is open those gatherings leave the recommendation placements below it (weather
// rows, Best Pick, Picked For You), which refill as usual. Collapsing it gives them back. It does not reach above itself:
// the first-run card and the person's own plans are not recommendations and stay as they are. Discover and every other
// screen are unaffected (this is Home presentation only).
export const HOME_SECTION_PRIORITY = ['firstRun', 'yourPlans', 'expandedList', 'weather', 'bestPick', 'pickedForYou', 'rightNow'];

// Ids shown by the open expanded list, or an empty set when nothing is expanded. Dedupe is by gathering id only.
export function expandedListIds(insight, expandedKind) {
  const dest = insight?.cta?.destination;
  if (!insight || !expandedKind || insight.kind !== expandedKind || dest?.kind !== 'inline') return new Set();
  return new Set((dest.items ?? []).map((it) => it?.gathering?.id).filter(Boolean));
}

// Your Plans on Home (item 33): at most MAX_HOME_PLANS rows; the full list lives on Plans (See all). Commitments first
// (going + hosting, soonest start first), then group plans (by date), then Interested. Each role list keeps its order.
export function selectHomePlans({ plansGoing = [], plansHosting = [], plansGroup = [], plansInterested = [] } = {}, max = MAX_HOME_PLANS) {
  const t = (g) => { const ms = new Date(g?.scheduled_at).getTime(); return Number.isFinite(ms) ? ms : Infinity; };
  const committed = [...(plansGoing ?? []).map((g) => ({ k: 'going', g })), ...(plansHosting ?? []).map((g) => ({ k: 'hosting', g }))]
    .sort((a, b) => t(a.g) - t(b.g));
  const ordered = [...committed, ...(plansGroup ?? []).map((g) => ({ k: 'group', g })), ...(plansInterested ?? []).map((g) => ({ k: 'interested', g }))];
  const keep = new Set(ordered.slice(0, Math.max(0, max)).map((e) => e.g));
  const pick = (list) => (list ?? []).filter((g) => keep.has(g));
  return { going: pick(plansGoing), hosting: pick(plansHosting), group: pick(plansGroup), interested: pick(plansInterested), total: ordered.length };
}

// Nearby Right Now on Home (item 33): nearby gatherings inside the canonical Right Now window (utils/rightNowWindow.js),
// minus everything a higher placement already shows (`exclude`), soonest first, then nearest. Empty = no section.
export function selectRightNow({ gatherings = [], exclude = null, now = new Date(), max = MAX_HOME_RIGHT_NOW } = {}) {
  const seen = new Set();
  return (gatherings ?? [])
    .filter((g) => g?.id && !seen.has(g.id) && seen.add(g.id) && !(exclude && exclude.has(g.id)) && g.scheduled_at && isWithinRightNowWindow(g.scheduled_at, now))
    .sort((a, b) => (new Date(a.scheduled_at) - new Date(b.scheduled_at)) || ((a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity)))
    .slice(0, Math.max(0, max));
}
