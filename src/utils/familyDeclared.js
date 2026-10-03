// Family & Kids view: declared family suitability (owner item 177 decision 3, 2026-10-03, LOCKED).
// The Family & Kids view shows what is IN the group's categories (as before) PLUS a place or gathering whose owner/host
// EXPLICITLY declared a family quality or a suited age range, even when its categories sit in another group (a museum that
// declared Family-friendly). Declarations only: never the category alone, never the name, description, reviews, distance,
// popularity or any AI reading. Nothing is stored, no category changes, no record is duplicated, and nothing is ranked by
// it: it only decides whether an item already in view belongs in that one view.
import { FAMILY_ATTRIBUTE_KEYS } from '../constants/businessAttributes';

export const FAMILY_GROUP_KEY = 'family_kids';

const hasAge = (row) => row?.suited_age_min != null || row?.suited_age_max != null;
const anyFamilyKey = (list) => Array.isArray(list) && list.some((k) => FAMILY_ATTRIBUTE_KEYS.includes(k));

// A gathering: host-declared family features, a suited age range, or the host's plan kind "Family".
export function gatheringDeclaresFamily(g) {
  if (!g) return false;
  return anyFamilyKey(g.features) || hasAge(g) || g.party_type === 'family';
}

// A business (a perk's partner row): owner-declared family attributes, a suited age range, or Family in groups-we-take.
export function partnerDeclaresFamily(p) {
  if (!p) return false;
  return anyFamilyKey(p.attributes) || hasAge(p)
    || (Array.isArray(p.accommodates_party_types) && p.accommodates_party_types.includes('family'));
}

export const isFamilyView = (context) => context?.categoryKey === FAMILY_GROUP_KEY;
