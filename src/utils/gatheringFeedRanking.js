// Unified ranking, surface 3 of 5: the Gatherings feed (constants/signalPriority.js is the one framework). The feed keeps its
// job, a personal ordering of the nearby list after the person's own filters (chips, search, For You); only the ORDER comes from
// the ladder: friends going 3 > room to join 4 > today 5 > declared interest + own activity 6 > broad group / related hobby 7 >
// weather 8 > the incoming (nearest-first) order. A stronger tier always beats any amount of a weaker one; nothing is hidden.
import { canonicalizeInterests } from '../constants/interestGraph';
import { EXPLICIT_POINTS, behaviorNudge, broadGroupNudge, relatedHobbyNudge, COMFORT_POINTS } from '../constants/blendedRanking';
import { comfortFits } from '../constants/socialComfort';
import { SIGNAL_TIERS, tierVector, compareTierVectors } from '../constants/signalPriority';
import { attendeeTotal, isGatheringFull } from './gatheringFullness';
import { learnedProximityFor } from './learnedProximity';

export const FEED_SIGNAL_TIER = {
  friends_going: SIGNAL_TIERS.planFriend,
  has_room: SIGNAL_TIERS.availability,
  today: SIGNAL_TIERS.time,
  declared_interest: SIGNAL_TIERS.interest,
  own_activity: SIGNAL_TIERS.interest,
  comfort: SIGNAL_TIERS.interest,
  broad_or_related: SIGNAL_TIERS.business,
  weather: SIGNAL_TIERS.weather,
  // item 137: within / well beyond this person's usual trip for the gathering's category (weakest tier, never filters)
  learned_proximity: SIGNAL_TIERS.discovery,
};
const FRIENDS_POINTS = 4;
const ROOM_POINTS = 4;
const TODAY_POINTS = 2;
const WEATHER_POINTS = 1;

function isSameDay(iso, now) {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// The named parts one gathering earns in the feed.
export function feedRankParts(g, { personalization = {}, friendIds = null, myUserId = null, weatherFits = null, now = new Date() } = {}) {
  const parts = [];
  const add = (code, delta) => { if (delta) parts.push({ code, tier: FEED_SIGNAL_TIER[code], delta }); };
  const friends = friendIds instanceof Set ? friendIds : new Set(friendIds ?? []);
  if ((g?.approvedAttendees ?? []).some((a) => a?.user_id && a.user_id !== myUserId && friends.has(a.user_id))) add('friends_going', FRIENDS_POINTS);
  if (!isGatheringFull(g, attendeeTotal(g))) add('has_room', ROOM_POINTS);
  if (g?.scheduled_at && isSameDay(g.scheduled_at, now)) add('today', TODAY_POINTS);
  const tag = g?.interest_tag ?? null;
  const ctx = { declared: personalization.declared ?? [], declaredGroups: personalization.declaredGroups ?? [], behavior: personalization.behavior ?? {}, maturity: personalization.maturity ?? null };
  if (tag && canonicalizeInterests(ctx.declared).includes(tag)) add('declared_interest', EXPLICIT_POINTS);
  add('own_activity', behaviorNudge(tag, ctx));
  if (comfortFits(g?.group_size_feel, personalization.socialComfort)) add('comfort', COMFORT_POINTS);
  // broad group and related hobby never stack (the larger applies), exactly as blendedCategoryScore
  add('broad_or_related', broadGroupNudge(tag, ctx) + relatedHobbyNudge(tag, ctx));
  if (typeof weatherFits === 'function' && weatherFits(g)) add('weather', WEATHER_POINTS);
  add('learned_proximity', learnedProximityFor(personalization.learnedProximity, tag, g?.distanceMiles));
  return parts;
}

// Stable: equal vectors keep their incoming order (nearest first).
export function rankGatheringFeed(items, ctx = {}) {
  return (items ?? [])
    .map((g, i) => ({ g, i, v: tierVector(feedRankParts(g, ctx)) }))
    .sort((a, b) => compareTierVectors(a.v, b.v) || a.i - b.i)
    .map((x) => x.g);
}
