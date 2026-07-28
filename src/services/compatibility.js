export function calculateCompatibility(myProfile, theirProfile) {
  const report = generateCompatibilityReport(myProfile, theirProfile);
  return report.score;
}

export function generateCompatibilityReport(myProfile, theirProfile) {
  const myInterests = myProfile?.interests ?? [];
  const theirInterests = theirProfile?.interests ?? [];
  const myBasics = myProfile?.basics ?? {};
  const theirBasics = theirProfile?.basics ?? {};

  const sharedInterests = myInterests.filter((i) => theirInterests.includes(i));

  const myArtists = (myProfile?.favorite_tracks ?? []).map((t) => t.artist).filter(Boolean);
  const theirArtists = (theirProfile?.favorite_tracks ?? []).map((t) => t.artist).filter(Boolean);
  const sharedArtists = [...new Set(myArtists.filter((a) => theirArtists.includes(a)))];

  let musicScore = null;
  if (myArtists.length > 0 && theirArtists.length > 0) {
    const artistUnion = new Set([...myArtists, ...theirArtists]);
    musicScore = sharedArtists.length / artistUnion.size;
  }

  let interestScore = null;
  if (myInterests.length > 0 && theirInterests.length > 0) {
    const union = new Set([...myInterests, ...theirInterests]);
    interestScore = sharedInterests.length / union.size;
  }

  const comparableKeys = Object.keys(myBasics).filter((key) => theirBasics[key] !== undefined);
  const matchingFields = [];
  const differingFields = [];

  for (const key of comparableKeys) {
    if (myBasics[key] === theirBasics[key]) {
      matchingFields.push({ key, value: myBasics[key] });
    } else {
      differingFields.push({ key, myValue: myBasics[key], theirValue: theirBasics[key] });
    }
  }

  let basicsScore = null;
  if (comparableKeys.length > 0) {
    basicsScore = matchingFields.length / comparableKeys.length;
  }

  // Music weighted lightly relative to interests/basics — two people
  // liking the same handful of artists is a nice, genuine signal,
  // but shouldn't dominate a score also built from deeper
  // compatibility factors, especially since most people won't have
  // connected Music Mode at all yet.
  const scoredParts = [
    interestScore !== null && { value: interestScore, weight: 0.5 },
    basicsScore !== null && { value: basicsScore, weight: 0.35 },
    musicScore !== null && { value: musicScore, weight: 0.15 },
  ].filter(Boolean);

  let score = null;
  if (scoredParts.length > 0) {
    const totalWeight = scoredParts.reduce((sum, p) => sum + p.weight, 0);
    const weightedSum = scoredParts.reduce((sum, p) => sum + p.value * p.weight, 0);
    score = Math.round((weightedSum / totalWeight) * 100);
  }

  return {
    score,
    sharedInterests,
    sharedArtists,
    matchingFields,
    differingFields,
  };
}

// "Compatibility Compass" — reframes the single percentage into four
// honest directions, since a single number flattens something that's
// genuinely more nuanced. Takes the already-computed report (not raw
// profiles) so it can be called from anywhere that already has one,
// including directly inside the modal that displays it.
const FIELD_LABELS = {
  relationship_goals: 'Relationship goals', family_plans: 'Family plans', financial_priority: 'Financial priorities',
  relocation_openness: 'Openness to relocating', communication_style: 'Communication style', love_style: 'Love language',
  independence_preference: 'Independence needs', social_energy: 'Social energy', weekend_style: 'Weekend style',
  workout: 'Fitness habits', drinking: 'Drinking', smoking: 'Smoking', cannabis: 'Cannabis use',
  morning_person: 'Morning routine', cooking_habits: 'Weeknight dinner habits', family_closeness: 'Family closeness',
  relationship_type: 'Relationship type',
};

function labelFor(key) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ');
}

const BIG_TOPIC_KEYS = ['relationship_goals', 'family_plans', 'financial_priority', 'relocation_openness', 'relationship_type'];
const COMMUNICATION_TOPIC_KEYS = ['communication_style', 'love_style', 'independence_preference', 'social_energy'];

export function generateCompatibilityCompass(report) {
  if (!report) return { north: [], east: [], south: [], west: [] };

  const north = [
    ...report.matchingFields.map((f) => labelFor(f.key)),
    ...(report.sharedInterests.length > 0 ? [`Shared interest in ${report.sharedInterests.slice(0, 2).join(' and ')}`] : []),
    ...(report.sharedArtists?.length > 0 ? [`Both like ${report.sharedArtists.slice(0, 2).join(' and ')}`] : []),
  ];

  const east = [...report.sharedInterests, ...(report.sharedArtists ?? [])];

  const south = report.differingFields
    .filter((f) => BIG_TOPIC_KEYS.includes(f.key))
    .map((f) => labelFor(f.key));

  const west = report.differingFields
    .filter((f) => COMMUNICATION_TOPIC_KEYS.includes(f.key) || !BIG_TOPIC_KEYS.includes(f.key))
    .map((f) => labelFor(f.key));

  return { north, east, south, west };
}

// "Compatibility Debugger" — turns vague "are we compatible?" into
// specific, named friction points worth an actual conversation,
// grouped the way the person would actually think about them.
const FRICTION_CATEGORIES = [
  { label: 'Communication expectations', keys: ['communication_style'] },
  { label: 'Independence & space', keys: ['independence_preference', 'social_energy'] },
  { label: 'Money & financial priorities', keys: ['financial_priority'] },
  { label: 'Definitions of romance', keys: ['love_style'] },
  { label: 'Family & long-term plans', keys: ['family_plans', 'family_closeness', 'relationship_goals'] },
  { label: 'Lifestyle & daily rhythm', keys: ['weekend_style', 'morning_person', 'cooking_habits', 'workout'] },
  { label: 'Location & relocation', keys: ['relocation_openness'] },
];

export function generateFrictionPoints(report) {
  if (!report) return { points: [], uncategorized: [] };

  const diffKeys = new Set(report.differingFields.map((f) => f.key));

  const points = FRICTION_CATEGORIES
    .map((category) => {
      const matchedKeys = category.keys.filter((k) => diffKeys.has(k));
      if (matchedKeys.length === 0) return null;
      const details = matchedKeys.map((k) => report.differingFields.find((f) => f.key === k));
      return { label: category.label, details };
    })
    .filter(Boolean);

  const categorizedKeys = new Set(FRICTION_CATEGORIES.flatMap((c) => c.keys));
  const uncategorized = report.differingFields.filter((f) => !categorizedKeys.has(f.key));

  return { points, uncategorized };
}