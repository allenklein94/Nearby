// Want vs Need (owner item 162, 2026-10-03, LOCKED). "I want something fun tonight" is a WANT (discovery, personalization,
// inspiration: the existing ranking, unchanged). "I need a car wash today" is a NEED: the person has a requirement to solve,
// so within the results the ask ALREADY returned, the order is strictly:
//   1 availability (the existing usable-now tiers at the requested time: available > open > unknown > closed)
//   2 proximity (measured distance, nearest first; an unknown distance after every measured one)
//   3 reliability (the "Our pick" record: an established record > no established record; no record is neutral, never a penalty
//     among records)
//   4 personalization (declared interests + learned affinity), a TIE-BREAKER ONLY
//   then the existing order.
// Lexicographic: a later key only decides when every earlier key is tied (same bucket). Nothing is removed, filtered or
// routed differently, no business eligibility changes. No new bucket, threshold or score: each key reuses an existing one.
//
// Classification is rule-based and comes ONLY from the resolved category: an ask is a need when its category belongs to a
// need group (NEED_GROUP_KEYS, item 161). The word "need" alone never makes one ("I need coffee" stays a want). Never AI.
import { CATEGORY_GROUPS, groupForTag, isNeedGroup } from '../constants/gatheringCategories';
import { usableNowTier } from './operatingStatus';
import { hasEstablishedRecord } from './reliabilityRecord';

export const NEED_CAPTION = "Showing what's available and close by";

export function askKind({ category = null } = {}) {
  if (!category) return 'want';
  const group = CATEGORY_GROUPS.some((g) => g.key === category)
    ? category
    : (groupForTag(category) ?? CATEGORY_GROUPS.find((g) => (g.businessOnlyTags ?? []).includes(category)))?.key ?? null;
  return group && isNeedGroup(group) ? 'need' : 'want';
}

// The time availability is judged at: the ask's own words. Right now, today or no time = now; any other window names no
// specific time, so availability is unknown for every result (a tie at level 1; nothing is invented).
export function needAvailabilityTime(dateWindow, now = new Date()) {
  return !dateWindow || dateWindow === 'now' || dateWindow === 'today' ? now : null;
}

const AVAILABILITY_RANK = { available: 3, open: 2, unknown: 1, closed: 0 };

export function needKeys(c, { toEntity, at, reputations }) {
  const avail = at ? (AVAILABILITY_RANK[usableNowTier(toEntity(c), at)] ?? 1) : 1;
  const d = c?.distanceMiles;
  const distance = typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : Infinity;
  const rel = c?.partnerId && hasEstablishedRecord(reputations?.get?.(c.partnerId)) ? 1 : 0;
  const personal = (Number.isFinite(c?.historyScore) ? c.historyScore : 0) + (Number.isFinite(c?.learnedTieBreak) ? c.learnedTieBreak : 0);
  return { avail, distance, rel, personal };
}

export function compareNeedKeys(a, b) {
  if (a.avail !== b.avail) return b.avail - a.avail;
  if (a.distance !== b.distance) return a.distance < b.distance ? -1 : 1;
  if (a.rel !== b.rel) return b.rel - a.rel;
  return b.personal - a.personal;
}

// Reorders only (same items, same objects); ties at every level keep the incoming (existing) order.
export function orderNeedResults(items, ctx) {
  if (!Array.isArray(items)) return items;
  return items
    .map((c, i) => ({ c, i, k: needKeys(c, ctx) }))
    .sort((x, y) => compareNeedKeys(x.k, y.k) || x.i - y.i)
    .map((x) => x.c);
}
