// social_comfort_level (onboarding + Edit Profile) vs a gathering's group_size_feel (1-5 "Intimate" <-> "Big group"): one honest
// range mapping shared by every consumer (Home recommendations, Discover). 'open' and a gathering with no group_size_feel never
// earn or lose anything. Ranking only: a preference never hides a gathering.
export const COMFORT_LEVEL_RANGES = {
  one_on_one: [1, 2],
  small_groups: [2, 3],
  large_gatherings: [4, 5],
};

// Display + storage order. 'open' ("I'm open to anything") is exclusive: choosing it clears the others, choosing another clears it.
export const COMFORT_LEVELS = ['one_on_one', 'small_groups', 'large_gatherings', 'open'];
const SPECIFIC = COMFORT_LEVELS.filter((v) => v !== 'open');

// Owner, 2026-11-22: several choices are allowed. They are stored in the SAME text column, comma-joined in COMFORT_LEVELS
// order ("one_on_one,small_groups"), so no migration is needed. Builds <= 87 read a single value; a joined value is
// unknown to them and earns no bonus there (neutral, never wrong). A single value written by an older build reads back as-is.
export function parseComfortLevels(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  const picked = new Set(raw.map((v) => String(v).trim()).filter(Boolean));
  if (picked.has('open')) return ['open'];
  return SPECIFIC.filter((v) => picked.has(v));
}

export function serializeComfortLevels(levels) {
  const list = parseComfortLevels(levels);
  return list.length ? list.join(',') : null;
}

export function toggleComfortLevel(levels, value) {
  const current = parseComfortLevels(levels);
  if (!COMFORT_LEVELS.includes(value)) return current;
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (value === 'open') return ['open'];
  return parseComfortLevels([...current.filter((v) => v !== 'open'), value]);
}

// True when the gathering's feel sits inside ANY chosen range. One bonus at most, however many choices match.
export function comfortFits(groupSizeFeel, socialComfortLevel) {
  if (groupSizeFeel === null || groupSizeFeel === undefined) return false;
  return parseComfortLevels(socialComfortLevel).some((level) => {
    const range = COMFORT_LEVEL_RANGES[level];
    return !!range && groupSizeFeel >= range[0] && groupSizeFeel <= range[1];
  });
}
