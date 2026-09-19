// social_comfort_level (onboarding) vs a gathering's group_size_feel (1-5 "Intimate" <-> "Big group"): one honest range mapping shared by
// every consumer (Home recommendations, the Gatherings feed). 'open' and a gathering with no group_size_feel never earn or lose anything.
export const COMFORT_LEVEL_RANGES = {
  one_on_one: [1, 2],
  small_groups: [2, 3],
  large_gatherings: [4, 5],
};

export function comfortFits(groupSizeFeel, socialComfortLevel) {
  if (!socialComfortLevel || socialComfortLevel === 'open') return false;
  if (groupSizeFeel === null || groupSizeFeel === undefined) return false;
  const range = COMFORT_LEVEL_RANGES[socialComfortLevel];
  return !!range && groupSizeFeel >= range[0] && groupSizeFeel <= range[1];
}
