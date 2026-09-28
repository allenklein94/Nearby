// Age range (owner item 50): a DESCRIPTIVE "suited ages" range a business or a gathering's host declares. It never restricts who may
// join or buy, and it is never inferred. NULL bound = open ("Ages 5+", "Up to age 12"); both null = not said = nothing shown.
// Options stop at 17 on purpose (item 87 lock, migration 20270229): 18+ / 21+ are business house rules only, never a descriptive
// label, and a gathering age limit stays parked. Every declared range therefore includes someone under 18.
import { appendReason } from '../constants/recommendationReasonVocabulary';
export const AGE_MIN_OPTIONS = [0, 1, 2, 3, 5, 8, 13];
export const AGE_MAX_OPTIONS = [2, 5, 12, 17];

// Returns { min, max } with both null when the pair is unusable (out of 0..17, min above max).
export function cleanAgeRange(min, max) {
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 17;
  const a = ok(min) ? min : null;
  const b = ok(max) ? max : null;
  if (a != null && b != null && a > b) return { min: null, max: null };
  return { min: a, max: b };
}

// Quick bands (owner decision 2026-09-26): convenience presets over the SAME range, never a second field or taxonomy.
// All ages = from 0 with no upper end, an explicit declaration that is distinct from unset (both null = not said).
// It describes suitability only; it never promises the business admits everyone (its own rules still apply).
export const AGE_BANDS = [
  { key: 'all_ages', label: 'All ages', min: 0, max: null, reason: 'Suited to all ages' },
  { key: 'kids', label: 'Kids (up to 12)', min: 0, max: 12, reason: 'Suited to kids up to 12' },
  { key: 'teens', label: 'Teens (13–17)', min: 13, max: 17, reason: 'Suited to teens 13–17' },
];

// The band a stored range is exactly equal to, else null (an exact range such as 3–8, or nothing declared).
export function ageBandOf(min, max) {
  const { min: a, max: b } = cleanAgeRange(min, max);
  if (a == null && b == null) return null;
  return AGE_BANDS.find((band) => band.min === a && band.max === b) ?? null;
}

export function ageRangeLabel(min, max) {
  const { min: a, max: b } = cleanAgeRange(min, max);
  if (a == null && b == null) return null;
  const band = ageBandOf(a, b);
  if (band) return band.label;
  if (a != null && b != null) return a === b ? `Age ${a}` : `Ages ${a}–${b}`;
  return a != null ? `Ages ${a}+` : `Up to age ${b}`;
}

// null when nothing is declared (unknown), else whether `age` sits inside the declared range.
export function ageFits(min, max, age) {
  const { min: a, max: b } = cleanAgeRange(min, max);
  if ((a == null && b == null) || !Number.isFinite(age)) return null;
  return (a == null || age >= a) && (b == null || age <= b);
}

// Ages the person's own words give: "my 5 year old", "3 and 6 year olds", "kids aged 4", "my 7-year-old". Max 4, all 0..17.
export function askedChildAges(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = [];
  const push = (n) => { const v = Number(n); if (Number.isInteger(v) && v >= 0 && v <= 17 && !found.includes(v)) found.push(v); };
  for (const m of text.matchAll(/\b(\d{1,2})(?:\s*(?:and|&|,)\s*(\d{1,2}))?[- ]?(?:years?|yrs?)[- ]?olds?\b/gi)) { push(m[1]); if (m[2]) push(m[2]); }
  for (const m of text.matchAll(/\b(?:aged?|ages)\s+(\d{1,2})(?:\s*(?:and|&|,)\s*(\d{1,2}))?\b/gi)) { push(m[1]); if (m[2]) push(m[2]); }
  return found.slice(0, 4);
}

export const AGE_FIT_POINTS = 2;
export const AGE_MISMATCH_POINTS = -2;

// Ranking only, never a filter. A candidate carries { ageMin, ageMax }; unknown (nothing declared) is untouched. It fits when it
// suits EVERY asked age (a family of a 3 and a 9 needs a range covering both); a declared range missing any of them sinks a little.
export function applySuitedAgesToCandidates(candidates, ages) {
  if (!Array.isArray(ages) || ages.length === 0) return candidates;
  return candidates.map((c) => {
    const fits = ages.map((a) => ageFits(c?.ageMin, c?.ageMax, a));
    if (fits.every((f) => f === null)) return c;
    const delta = fits.every((f) => f === true) ? AGE_FIT_POINTS : AGE_MISMATCH_POINTS;
    const band = ageBandOf(c.ageMin, c.ageMax);
    const reason = delta > 0 ? (band ? band.reason : `Suited to ${ageRangeLabel(c.ageMin, c.ageMax).replace(/^Age /, 'age ').replace(/^Ages /, 'ages ')}`) : null;
    return { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle, reasons: appendReason(c.reasons, reason) };
  });
}
