import { searchScope } from '../constants/categoryTree';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { CUISINE_OPTIONS } from '../constants/businessAttributes';
import { friendsInterestReason } from './friendInterests';

// One search box, every kind of result (owner item 92). Discover's typed search already returns gatherings, communities,
// perks and places; this adds the three kinds it lacked, all from data Discover already holds or one existing lookup:
//   topic      = the activity/category the words name ("coffee" -> Coffee, "italian" -> Italian restaurants), through the ONE
//                canonical resolver (categoryTree.searchScope: synonyms, groups, declared cuisines). Opens the existing
//                in-place category view. No match = no row (nothing is guessed).
//   businesses = Nearby partner businesses near you whose NAME contains the words, or that DECLARED the matching type
//                (subcategory / secondary categories; a business that declared no type serves its whole major, the same
//                rule as the server's business_served_tags) or cuisine. Never inferred from photos, reviews or copy.
//   people     = accepted friends who declared that interest (get_friends_interested_in, server-enforced; names only as the
//                server returns them). Never strangers, never matches, never ids.
// "Events" are gatherings in Nearby (their format says concert/show/...), so they arrive in the gatherings list.
export const BUSINESS_RESULT_CAP = 5;

const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

export function searchTopic(text) {
  const scope = searchScope(text);
  if (scope.level === 'group') {
    const g = CATEGORY_GROUPS.find((x) => x.key === scope.group);
    return g ? { kind: 'group', label: g.label, icon: g.icon, tags: scope.tags, group: g } : null;
  }
  if (scope.level === 'tag') {
    const tag = scope.tags[0];
    const g = CATEGORY_GROUPS.find((x) => x.key === scope.group);
    return { kind: 'tag', label: tag, icon: g?.icon ?? '✨', tags: scope.tags, groupLabel: g?.label ?? null };
  }
  if (scope.level === 'cuisine') {
    const c = CUISINE_OPTIONS.find((o) => o.key === scope.cuisine);
    return c ? { kind: 'cuisine', label: `${c.label} restaurants`, icon: '🍽️', tags: [], cuisine: scope.cuisine, groupLabel: 'Food & Drink' } : null;
  }
  return null;
}

function declaredTags(b) {
  return [b?.subcategory, ...(Array.isArray(b?.categories) ? b.categories : [])].filter(Boolean);
}

// Which of the topic's facts this business really declared; null when none.
function businessTopicMatch(b, topic) {
  if (!topic) return null;
  if (topic.kind === 'cuisine') return norm(b?.cuisine) === topic.cuisine ? topic.label.replace(/ restaurants$/, '') : null;
  const declared = declaredTags(b);
  const hit = declared.find((t) => topic.tags.includes(t));
  if (hit) return hit;
  if (topic.kind === 'group' && b?.category === topic.group.key) return topic.label;
  if (declared.length === 0 && topic.kind === 'tag') {
    const major = CATEGORY_GROUPS.find((g) => g.key === b?.category);
    if (major && topic.tags.some((t) => major.tags.includes(t))) return major.label;
  }
  return null;
}

export function matchBusinesses(businesses, text, topic = searchTopic(text)) {
  const term = norm(text);
  if (term.length < 2) return [];
  const out = [];
  for (const b of businesses ?? []) {
    if (!b?.id || !b?.name) continue;
    const byName = norm(b.name).includes(term);
    const byType = businessTopicMatch(b, topic);
    if (!byName && !byType) continue;
    out.push({ ...b, searchReason: byType ?? null, nameMatch: byName });
  }
  return out
    .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, BUSINESS_RESULT_CAP);
}

// The one friends line for the topic: the tag with the most accepted friends, worded by the shared helper.
export function friendsLineForTopic(topic, friendMap) {
  if (!topic || !friendMap) return null;
  let best = null;
  for (const tag of topic.tags ?? []) {
    const e = friendMap[tag];
    const n = Number(e?.friend_count ?? 0);
    if (n >= 1 && (!best || n > best.n)) best = { tag, n, e };
  }
  return best ? friendsInterestReason(best.tag, best.e) : null;
}
