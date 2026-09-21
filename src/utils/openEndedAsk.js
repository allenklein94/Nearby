// Open-ended asks (owner request, 2026-09-21): "I want something fun tonight with two friends" names no category, so the
// resolver used to rank ALL nearby inventory -- a car wash or a dentist could sit beside a concert. This is the deterministic
// (rule-based, never AI) step that recognises such an ask and says which category GROUPS it can reasonably mean. The resolver then
// (a) drops results whose own category belongs to a non-social group and (b) gives a small lift to the ones that fit. Only
// candidates with a KNOWN category are ever dropped; uncategorized ones are kept, and a real category in the ask turns all of this off.
import { CATEGORY_GROUPS, groupForTag } from '../constants/gatheringCategories';
import { detectIntentRoute, ROUTE_SURFACES } from '../constants/intentRoutes';

// Groups that describe supply or services rather than something to go and do. Never part of a "something fun" ask.
const SUPPLY_GROUPS = ['home_local_services', 'auto_transportation', 'business_networking', 'health_personal_care', 'stay_getaway', 'pets', 'education_classes'];
const FAMILY_GROUP = 'family_kids';

// Phrases that mean "I have no specific activity yet": something fun / to do / interesting, bored, hang out, go out, what should we do.
const OPEN_ENDED = /\b(something|anything|stuff|things?)\b[^.?!]{0,30}\b(fun|to do|interesting|cool|good|different|nice)\b|\bfun\b|\bbored\b|\bwhat (should|can|could|do) (we|i)\b|\bhang ?out\b|\bgo out\b|\bout tonight\b|\bnothing to do\b/i;

export const OPEN_ENDED_GROUP_BONUS = 1; // below every real category/interest match (SCORE_INTEREST_MATCH is 5)

// Group keys the ask can mean, or null when this is not an open-ended ask (a real category, an occasion, or no open phrase).
export function openEndedAskGroups({ category = null, rawText = '', occasion = null, attributes = [] } = {}) {
  if (category || occasion) return null;
  // A recognised intent (constants/intentRoutes.js) that names category groups limits the ask to exactly those groups.
  const routed = detectIntentRoute(rawText);
  // (A tagged intent like coffee or live music leaves the choice of category to the extractor, so it never limits groups here.)
  if (routed?.route.surface === ROUTE_SURFACES.CATEGORY_GROUPS && !routed.route.category) return [...routed.route.groups];
  if (typeof rawText !== 'string' || !OPEN_ENDED.test(rawText)) return null;
  const kidFriendly = Array.isArray(attributes) && attributes.includes('kid_friendly');
  return CATEGORY_GROUPS
    .map((g) => g.key)
    .filter((k) => !SUPPLY_GROUPS.includes(k) && (k !== FAMILY_GROUP || kidFriendly));
}

function groupKeyOf(candidate) {
  const c = candidate?.category;
  if (!c) return null;
  if (CATEGORY_GROUPS.some((g) => g.key === c)) return c; // a business known only by its major
  // business-only tags (Dental...) live beside a group's tags, not in them, and must resolve to their group too
  return (groupForTag(c) ?? CATEGORY_GROUPS.find((g) => (g.businessOnlyTags ?? []).includes(c)))?.key ?? null;
}

// A second, small nudge from the ask's own time window (never a clock the person did not give): an evening ask (tonight, or
// today once it is 5 PM or later) leans to nightlife and food, a daytime ask (today earlier, tomorrow, the weekend) leans to things
// to go and do, and a date leans a little to dating & social. Stacks with the base lift but stays far below a real match (5).
export const TIME_TILT_POINTS = 1;
const EVENING_GROUPS = ['entertainment_nightlife', 'food_drink'];
const DAYTIME_GROUPS = ['activities_recreation', 'outdoors_nature', 'attractions_things_to_see', 'arts_culture_learning'];

export function timeTiltGroups({ dateWindow = null, partyType = null, hour = null } = {}) {
  const evening = dateWindow === 'tonight' || (dateWindow === 'today' && Number.isFinite(hour) && hour >= 17);
  const daytime = !evening && ['today', 'tomorrow', 'weekend'].includes(dateWindow);
  const tilt = [...(evening ? EVENING_GROUPS : []), ...(daytime ? DAYTIME_GROUPS : [])];
  if (partyType === 'date') tilt.push('dating_social');
  return tilt;
}

// Filters and lifts a scored candidate list for an open-ended ask. `groups` from openEndedAskGroups (null = untouched);
// `ctx` = { dateWindow, partyType, hour } for the time tilt.
export function applyOpenEndedAsk(candidates, groups, ctx = {}) {
  if (!Array.isArray(groups)) return candidates;
  const eligible = new Set(groups);
  const tilt = new Set(timeTiltGroups(ctx));
  return candidates
    .filter((c) => {
      const k = groupKeyOf(c);
      return k == null || eligible.has(k); // unknown category is kept, never dropped
    })
    .map((c) => {
      const k = groupKeyOf(c);
      if (!k) return c;
      return { ...c, score: (c.score ?? 0) + OPEN_ENDED_GROUP_BONUS + (tilt.has(k) ? TIME_TILT_POINTS : 0) };
    });
}

// "Activities, Entertainment and Food & Drink" -- the groups that actually contributed results, for an honest one-line caption.
export function openEndedCaption(candidates, groups, limit = 3) {
  if (!Array.isArray(groups)) return null;
  const counts = new Map();
  for (const c of candidates) {
    const k = groupKeyOf(c);
    if (k && groups.includes(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const labels = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([k]) => CATEGORY_GROUPS.find((g) => g.key === k)?.label).filter(Boolean);
  if (labels.length === 0) return null;
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `Looking across ${list}`;
}
