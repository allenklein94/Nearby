import { categoryEnvironment } from './gatheringIndoorOutdoor';

// Outdoor / Indoor as a MATCH (2026-10-02, owner): one rule for every surface (Discover's Outdoor/Indoor narrowing, typed asks,
// Surprise Me through the resolver, Home's weather lists, perks, places, gatherings). Declared data only:
//   gathering : the host's declared outdoor seating (features) -> outdoor; else its category (categoryEnvironment: the
//               host-picked activity itself, e.g. Hiking)
//   business  : (a perk's business, a Nearby place) its OWN declarations only: weather_setting indoor -> indoor; outdoor or
//   / perk      weather dependent -> outdoor; else the outdoor_seating attribute -> outdoor; else unknown. NEVER its category,
//               type, location, a park nearby, a Google place type or anything inferred.
//   sponsored : never (a paid card never rides an organic match).
//   other     : (communities...) their own declared category.
// Unknown = null: a narrowing leaves it out, a typed ask neither lifts nor sinks it.
export const OUTDOOR_ATTRIBUTE_KEYS = ['outdoor_seating'];
const ENV_KEYS = ['outdoor', 'indoor'];

export function businessEnvironment(partner) {
  if (!partner || typeof partner !== 'object') return null;
  const setting = partner.weather_setting;
  if (setting === 'indoor') return 'indoor';
  if (setting === 'outdoor' || setting === 'weather_dependent') return 'outdoor';
  const attrs = Array.isArray(partner.attributes) ? partner.attributes : [];
  return OUTDOOR_ATTRIBUTE_KEYS.some((k) => attrs.includes(k)) ? 'outdoor' : null;
}

export function gatheringEnvironment(g) {
  if (!g) return null;
  const features = Array.isArray(g.features) ? g.features : [];
  if (OUTDOOR_ATTRIBUTE_KEYS.some((k) => features.includes(k))) return 'outdoor';
  return categoryEnvironment(g.interest_tag ?? g.category ?? null);
}

// kind: 'gathering' | 'perk' | 'business' | 'place' | 'sponsored' | other. `partner` = the business row when the item is not it.
export function environmentOfItem(kind, item, partner = null) {
  if (!item) return null;
  if (kind === 'sponsored') return null;
  if (kind === 'gathering') return gatheringEnvironment(item);
  if (kind === 'perk') return businessEnvironment(partner ?? item.brand_partners ?? null);
  if (kind === 'business' || kind === 'place') return businessEnvironment(partner ?? item);
  return categoryEnvironment(item.interest_tag ?? item.category ?? null);
}

// null environment = no narrowing (everything passes).
export function matchesEnvironment(kind, item, environment, partner = null) {
  if (!ENV_KEYS.includes(environment)) return true;
  return environmentOfItem(kind, item, partner) === environment;
}

export function filterByEnvironment(list, kind, environment, partnerOf = null) {
  if (!ENV_KEYS.includes(environment) || !Array.isArray(list)) return list;
  return list.filter((x) => matchesEnvironment(kind, x, environment, partnerOf ? partnerOf(x) : null));
}
