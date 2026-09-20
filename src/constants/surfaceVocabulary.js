// What each place-and-time label MEANS (owner item 49). A label is a promise about the data behind it (global rule 7), so
// each name is reserved for exactly one meaning and a surface may use it only when its data really is that. If a list is
// something else, it gets a different name. The meaning strings are the source of truth; `surfaceVocabulary.test.js`
// guards the screens against drifting back.
export const SURFACES = {
  nearby: {
    label: 'Nearby',
    means: 'Real things (gatherings) ordered by how close they are to you, on any date. Not time-sensitive, not personalized beyond a light interest ranking.',
    where: 'Gatherings feed ("Nearby Gatherings").',
  },
  nearbyRightNow: {
    label: 'Right Now',
    means: 'Things that are geographically close AND inside the canonical Right Now window (started up to 30 min ago, or starts within 2 h; utils/rightNowWindow.js).',
    where: 'Gatherings "Right Now" filter, Discover "Happening Now" bucket.',
  },
  happeningNearby: {
    label: 'Happening Nearby',
    means: 'Time-sensitive local activity that expires: live 24-hour moments from gatherings and local businesses near you.',
    where: 'Discover (All view).',
  },
  startingSoon: {
    label: 'Starting Soon Near You',
    means: 'Nearby gatherings that start within the next 30 minutes (not yet started; a started gathering is not joinable).',
    where: 'Home.',
  },
  trendingNearYou: {
    label: 'Trending',
    means: 'Things gaining real engagement locally: gatherings with at least TRENDING_ATTENDANCE_MIN (5) approved attendees. No attendance, no "trending".',
    where: 'Gatherings "Trending" chip, Discover trending, Home as a reason on a card.',
  },
  thingsToDo: {
    label: 'Things to Do',
    means: 'Available activities you can search or browse by what you are looking for and what you like.',
    where: 'Discover "Things to Do" tab.',
  },
  bestPick: {
    label: 'Best Pick',
    means: 'One personalized recommendation chosen for you (interest, timing, weather, friends). "Tonight" is added only when it starts tonight.',
    where: 'Home hero.',
  },
  pickedForYou: {
    label: 'Picked For You',
    means: 'Personalized gatherings, each shown once with every real reason it qualified (interest, trending, friend hosting or going, starting soon).',
    where: 'Home.',
  },
  recommendedNearby: {
    label: 'Recommended Nearby',
    means: 'A ranked mix of nearby gatherings and perks scored on interest, distance, timing, weather and your network. It is a recommendation, not a claim that everything is happening right now.',
    where: 'Home.',
  },
};

// Labels that are reserved: using one as a heading requires the data described above.
export const RESERVED_LABELS = ['Right Now', 'Happening Nearby', 'Trending', 'Best Pick'];
