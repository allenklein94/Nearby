// Dating appearance preferences rank, never exclude (owner, 2026-11-14; tattoos + piercings added the same day).
//
// Hair color, eye color, height, tattoos and piercings are SOFT preferences in Dating Browse: a profile that matches one
// the person chose ranks a little higher, one that clearly doesn't ranks a little lower, and nobody is removed for it.
// Missing information (the candidate never said, said "Prefer not to say", or the person set no preference) is 0: it
// neither helps nor hurts. Age range, distance, gender/show-me and ethnicity stay hard filters where they are
// (services/proximity.js); Crossed Paths keeps its chronological order and Friends is untouched. This file only orders
// Browse.
//
// Ranking score = compatibility score + the appearance adjustment. Each dimension the person set a preference on is
// worth APPEARANCE_POINTS (+ match, - mismatch, 0 unknown), but the whole adjustment is capped at +/- APPEARANCE_MAX
// (6): with up to 3 preferences set each is worth 2 (exactly the accepted rule), with 4 each is 1.5, with 5 each is 1.2.
// So adding traits never makes appearance outweigh compatibility more than it already could. No bands: the same small
// adjustment applies everywhere. The adjustment is used only for ORDER; the compatibility percentage shown is unchanged.
// Ties: exact compatibility, then incoming order. Unknown compatibility counts as 0, as Browse always sorted it.

export const APPEARANCE_POINTS = 2;
export const APPEARANCE_MAX = 6;

// Stored preference values for tattoos / piercings; null = no preference.
export const PRESENCE_PREFERENCES = Object.freeze(['with', 'without']);
const PRESENCE_VALUES = Object.freeze({
  tattoos: { yes: 'Has tattoos', no: 'No tattoos' },
  piercings: { yes: 'Has piercings', no: 'No piercings' },
});

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

// Tattoos / piercings: 'with' wants the trait, 'without' doesn't; only the candidate's explicit yes/no counts.
// "Prefer not to say", unanswered or anything else = 0.
function presenceFit(preference, field, value) {
  if (!PRESENCE_PREFERENCES.includes(preference)) return 0;
  const { yes, no } = PRESENCE_VALUES[field];
  if (value !== yes && value !== no) return 0;
  return (value === yes) === (preference === 'with') ? 1 : -1;
}

const presencePref = (v) => (PRESENCE_PREFERENCES.includes(v) ? v : null);

// The viewer's appearance preferences, read from their own profile row.
export function appearancePreferencesOf(myProfile) {
  return {
    hairColors: myProfile?.dating_pref_hair_colors ?? [],
    eyeColors: myProfile?.dating_pref_eye_colors ?? [],
    minHeightInches: myProfile?.dating_pref_min_height_inches ?? null,
    maxHeightInches: myProfile?.dating_pref_max_height_inches ?? null,
    tattoos: presencePref(myProfile?.dating_pref_tattoos),
    piercings: presencePref(myProfile?.dating_pref_piercings),
  };
}

// How many dimensions the person set a preference on (0..5).
export function appearancePreferenceCount(preferences) {
  const p = preferences ?? {};
  return [
    Array.isArray(p.hairColors) && p.hairColors.length > 0,
    Array.isArray(p.eyeColors) && p.eyeColors.length > 0,
    p.minHeightInches != null || p.maxHeightInches != null,
    PRESENCE_PREFERENCES.includes(p.tattoos),
    PRESENCE_PREFERENCES.includes(p.piercings),
  ].filter(Boolean).length;
}

// Points one dimension is worth: 2 each, shrunk so all set dimensions together never exceed APPEARANCE_MAX.
export function appearancePointsPerDimension(preferences) {
  const n = appearancePreferenceCount(preferences);
  return n === 0 ? 0 : Math.min(APPEARANCE_POINTS, APPEARANCE_MAX / n);
}

// Net matches over the five dimensions: -5..+5. Reads the candidate's own self-description only.
export function appearanceFit(preferences, candidateProfile) {
  const prefs = preferences ?? {};
  return (
    colorFit(prefs.hairColors, candidateProfile?.basics?.hair_color)
    + colorFit(prefs.eyeColors, candidateProfile?.basics?.eye_color)
    + heightFit(prefs.minHeightInches, prefs.maxHeightInches, candidateProfile?.height_inches)
    + presenceFit(prefs.tattoos, 'tattoos', candidateProfile?.basics?.tattoos)
    + presenceFit(prefs.piercings, 'piercings', candidateProfile?.basics?.piercings)
  );
}

// The appearance adjustment for one candidate, always within +/- APPEARANCE_MAX.
export function appearanceAdjustment(preferences, candidateProfile) {
  return appearancePointsPerDimension(preferences) * appearanceFit(preferences, candidateProfile);
}

// The ordering score for one candidate. Never shown.
export function browseRankScore(preferences, item) {
  return (item?.compatibilityScore ?? 0) + appearanceAdjustment(preferences, item?.profiles);
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
