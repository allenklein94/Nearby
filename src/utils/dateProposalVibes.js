// Date vibes travel with the plan (owner decision 2026-09-26, follow-up to item 85). The proposer may tap what KIND of date it
// is (the same "What kind of date?" chips as AskBusiness: DATE_VIBES). They are stored on the proposal, shown to both people,
// and carried into the business request Nearby makes when the match accepts, where the business sees them as "Customer is
// looking for: Romantic · Quiet" and nothing about who the two people are.
// Only what was tapped: a date never implies Romantic, and a plan with none picked carries none (null, never a default).
import { DATE_VIBES } from '../constants/businessVibes';

const DATE_VIBE_KEYS = DATE_VIBES.map((v) => v.key);
export const MAX_DATE_VIBES = 8;

export function cleanDateVibes(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((k) => DATE_VIBE_KEYS.includes(k)))].slice(0, MAX_DATE_VIBES);
}

// The attributes for the request made on the pair's behalf: exactly the proposal's own vibes, or null.
export function requestAttributesFromProposal(proposal) {
  const vibes = cleanDateVibes(proposal?.attributes);
  return vibes.length > 0 ? vibes : null;
}

export function dateVibesLine(list) {
  const vibes = cleanDateVibes(list);
  if (vibes.length === 0) return null;
  return vibes.map((k) => DATE_VIBES.find((v) => v.key === k).label).join(' · ');
}
