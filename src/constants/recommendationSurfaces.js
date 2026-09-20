// "Why am I seeing this?" is a Nearby-wide standard (global rule 2, items 33/58): every personalized surface names a REAL
// signal it was matched on. This registry is the audit: each surface, the helper that produces its reason, and whether it
// is personalized at all. recommendationSurfaces.test.js fails if a registered surface stops referencing its reason
// source, so a surface cannot silently lose its explanation. Add a new personalized surface HERE first.
//   status 'reasoned'   = shows a real reason today (marker must appear in file)
//   status 'unpersonalized' = a plain list/search the person chose; no recommendation claim is made, so none is owed
//   status 'gap'        = personalized but no reason shown yet (disclosed, not hidden)
export const RECOMMENDATION_SURFACES = [
  { surface: 'Home: Picked For You / Best Pick', file: 'screens/HomeScreen.js', marker: 'mergeHomeGatheringSignals', status: 'reasoned' },
  { surface: 'Home: first-run card', file: 'screens/HomeScreen.js', marker: 'recommendationRow', status: 'reasoned' },
  { surface: 'Home: weather card rows', file: 'screens/HomeScreen.js', marker: 'attention.absorbed', status: 'reasoned' },
  { surface: 'Home: insight lines', file: 'utils/meetTonight.js', marker: 'basis', status: 'reasoned' },
  { surface: 'Discover: gathering cards', file: 'screens/DiscoverHubScreen.js', marker: 'becauseYouLikeReason', status: 'reasoned' },
  { surface: 'Discover: friend-going', file: 'screens/DiscoverHubScreen.js', marker: 'friendGoingReason', status: 'reasoned' },
  { surface: 'Discover: communities', file: 'screens/DiscoverHubScreen.js', marker: 'communityReason', status: 'reasoned' },
  { surface: 'Discover: perks', file: 'screens/DiscoverHubScreen.js', marker: 'target_interest_tag', status: 'reasoned' },
  { surface: 'Gatherings feed badge', file: 'screens/GatheringsScreen.js', marker: 'becauseYouLike', status: 'reasoned' },
  { surface: 'Gathering detail: Why this fits you', file: 'screens/GatheringDetailScreen.js', marker: 'ReasonList', status: 'reasoned' },
  { surface: 'Friend discovery cards', file: 'components/FriendDiscoverySwipeCards.js', marker: 'ReasonList', status: 'reasoned', optional: true },
  { surface: 'Business opportunity card', file: 'utils/businessOpportunityCard.js', marker: 'buildMatchReasons', status: 'reasoned' },
  { surface: 'Activity: business response', file: 'utils/offerCopy.js', marker: 'made you an offer', status: 'reasoned' },
  { surface: 'Discover: Places list', file: 'screens/DiscoverHubScreen.js', marker: 'PlaceCard', status: 'gap', note: 'shows category/open-now/rating facts, not a personal reason' },
  { surface: 'Dating people cards', file: 'screens/DiscoveryScreen.js', marker: 'datingCardFacts', status: 'reasoned' },
  { surface: 'Search results the person typed', file: 'screens/DiscoverHubScreen.js', marker: null, status: 'unpersonalized' },
];
