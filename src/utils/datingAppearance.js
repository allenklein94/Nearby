// Dating appearance preferences rank, never exclude (owner, 2026-11-14).
//
// Hair color, eye color and height are SOFT preferences in Dating Browse: a profile that matches one the person chose
// ranks a little higher, one that clearly doesn't ranks a little lower, and nobody is removed for it. Missing
// information (the candidate never said, or the person set no preference) is 0: it neither helps nor hurts. Age range,
// distance, gender/show-me and ethnicity stay hard filters where they are (services/proximity.js); Crossed Paths keeps
// its chronological order and Friends is untouched. This file only orders Browse.
//
// Ranking score = compatibility score + APPEARANCE_POINTS per dimension (+ for a match, - for a mismatch, 0 unknown),
// so at most +/- 3 * APPEARANCE_POINTS. No bands: the same small adjustment applies everywhere, so there are no ranking
// jumps at arbitrary boundaries. The adjustment is used only for ORDER; the compatibility percentage shown is unchanged.
// Ties: exact compatibility, then incoming order. Unknown compatibility counts as 0, as Browse always sorted it.

export const APPEARANCE_POINTS = 2;

// One preference dimension: +1 known match, -1 known mismatch, 0 when no preference is set or the candidate gave no value.
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

// Net matches over the three dimensions: -3..+3. Reads the candidate's own self-description only.
export function appearanceFit(preferences, candidateProfile) {
  const prefs = preferences ?? {};
  return (
    colorFit(prefs.hairColors, candidateProfile?.basics?.hair_color)
    + colorFit(prefs.eyeColors, candidateProfile?.basics?.eye_color)
    + heightFit(prefs.minHeightInches, prefs.maxHeightInches, candidateProfile?.height_inches)
  );
}

// The ordering score for one candidate. Never shown.
export function browseRankScore(preferences, item) {
  return (item?.compatibilityScore ?? 0) + APPEARANCE_POINTS * appearanceFit(preferences, item?.profiles);
}

// Orders Dating Browse candidates ({ profiles, compatibilityScore }). Returns a new array; never drops anyone. With no
// appearance preference set, the result is exactly the previous compatibility order (descending, ties in incoming order).
export function rankDatingCandidates(items, preferences) {
  return (items ?? [])
    .map((item, index) => ({ item, index, rank: browseRankScore(preferences, item) }))
    .sort((a, b) => (
      b.rank - a.rank
      || (b.item?.compatibilityScore ?? 0) - (a.item?.compatibilityScore ?? 0)
      || a.index - b.index
    ))
    .map((entry) => entry.item);
}
