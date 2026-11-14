// Dating appearance preferences rank, never exclude (owner, 2026-11-14).
//
// Hair color, eye color and height are SOFT preferences: a profile that matches one the person chose ranks a little
// higher, one that clearly doesn't ranks a little lower, and nobody is removed for it. Missing information (the
// candidate never said) is neutral: it neither helps nor hurts. Age range, distance, gender/show-me and ethnicity stay
// hard filters where they are (services/proximity.js); this file only orders.
//
// "Modest" and "never outweighs compatibility": candidates are compared first by their compatibility BAND
// (COMPATIBILITY_BAND points wide; unknown compatibility sorts after every known band), then by appearance fit, then by
// exact compatibility, then by their incoming order (stable). So appearance can only reorder people whose compatibility
// is already close; a clearly more compatible person always stays ahead of a better appearance fit.

export const COMPATIBILITY_BAND = 10;

// One preference dimension: +1 known match, -1 known mismatch, 0 when the person set no preference or the candidate
// gave no value.
function colorFit(preferences, value) {
  if (!Array.isArray(preferences) || preferences.length === 0) return 0;
  if (value == null || value === '') return 0;
  return preferences.includes(value) ? 1 : -1;
}

function heightFit(min, max, inches) {
  if (min == null && max == null) return 0;
  if (inches == null) return 0;
  if (min != null && inches < min) return -1;
  if (max != null && inches > max) return -1;
  return 1;
}

// The viewer's appearance preferences, read from their own profile row.
export function appearancePreferencesOf(myProfile) {
  return {
    hairColors: myProfile?.dating_pref_hair_colors ?? [],
    eyeColors: myProfile?.dating_pref_eye_colors ?? [],
    minHeightInches: myProfile?.dating_pref_min_height_inches ?? null,
    maxHeightInches: myProfile?.dating_pref_max_height_inches ?? null,
  };
}

// Sum over the three dimensions: -3..+3. Reads the candidate's own self-description only.
export function appearanceFit(preferences, candidateProfile) {
  const prefs = preferences ?? {};
  return (
    colorFit(prefs.hairColors, candidateProfile?.basics?.hair_color)
    + colorFit(prefs.eyeColors, candidateProfile?.basics?.eye_color)
    + heightFit(prefs.minHeightInches, prefs.maxHeightInches, candidateProfile?.height_inches)
  );
}

function band(score) {
  return score == null ? -1 : Math.floor(score / COMPATIBILITY_BAND);
}

// Orders Dating candidates ({ profiles, compatibilityScore }) by band -> appearance fit -> exact score -> incoming
// order. Returns a new array; never drops anyone. With no appearance preference set, the result is the plain
// compatibility order (band then exact score), with ties kept in incoming order.
export function rankDatingCandidates(items, preferences) {
  return (items ?? [])
    .map((item, index) => ({ item, index, fit: appearanceFit(preferences, item?.profiles) }))
    .sort((a, b) => (
      band(b.item?.compatibilityScore) - band(a.item?.compatibilityScore)
      || b.fit - a.fit
      || (b.item?.compatibilityScore ?? -1) - (a.item?.compatibilityScore ?? -1)
      || a.index - b.index
    ))
    .map((entry) => entry.item);
}
