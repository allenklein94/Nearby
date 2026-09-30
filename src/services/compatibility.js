import { translate } from '../i18n/translate';
import { basicsLabel } from '../i18n/basicsVocab';
import { categoryName } from '../i18n/categoryNames';
import { BASICS_FIELDS } from '../constants/basicsFields';

export function calculateCompatibility(myProfile, theirProfile) {
  const report = generateCompatibilityReport(myProfile, theirProfile);
  return report.score;
}

// Friend Discovery parity (CLAUDE.md, item 2): the friend-side equivalent
// of a "match %" -- get_friend_discovery_candidates() already returns three
// real counts (shared interests/communities/mutual friends) but never blends
// them into one score. Interests weighted highest since they're the
// strongest voluntary signal; each count is capped before weighting so one
// outlier (e.g. 20 mutual friends) can't single-handedly saturate the score.
export function calculateFriendCompatibility({ shared_interest_count = 0, shared_community_count = 0, mutual_friend_count = 0 } = {}) {
  const interestScore = Math.min(shared_interest_count, 5) / 5;
  const communityScore = Math.min(shared_community_count, 3) / 3;
  const mutualScore = Math.min(mutual_friend_count, 5) / 5;
  const score = interestScore * 0.5 + communityScore * 0.25 + mutualScore * 0.25;
  return Math.round(score * 100);
}

// Taxonomy audit, 2026-08-24/25 (see CLAUDE.md): basics.relationship_goals
// used to be a real, separately-answered field here, labeled "Looking
// For" -- the identical label relationship_intention's own Discovery
// filter already uses, asking the same question twice in two unrelated
// vocabularies. relationship_goals is now removed from BASICS_FIELDS
// entirely (basicsFields.js), so this narrative is the one place that
// still needs a "what are you both looking for" comparison -- it's
// derived from the real relationship_intention array instead, merged
// into a local copy of each side's basics purely for this comparison
// (never written back into the real basics jsonb). A profile's own
// relationship_intention is a multi-select array; comparing two arrays
// for "matching" only makes sense as set equality, so both sides are
// sorted and joined into one comparable string.
function withRelationshipIntention(basics, profile) {
  const intention = Array.isArray(profile?.relationship_intention) ? profile.relationship_intention : [];
  if (intention.length === 0) return basics;
  return { ...basics, relationship_intention: [...intention].sort().join(',') };
}

export function generateCompatibilityReport(myProfile, theirProfile) {
  const myInterests = myProfile?.interests ?? [];
  const theirInterests = theirProfile?.interests ?? [];
  const myBasics = withRelationshipIntention(myProfile?.basics ?? {}, myProfile);
  const theirBasics = withRelationshipIntention(theirProfile?.basics ?? {}, theirProfile);

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
  relationship_intention: 'Relationship goals', family_plans: 'Family plans', financial_priority: 'Financial priorities',
  relocation_openness: 'Openness to relocating', communication_style: 'Communication style', love_style: 'Love language',
  independence_preference: 'Independence needs', social_energy: 'Social energy', weekend_style: 'Weekend style',
  workout: 'Fitness habits', drinking: 'Drinking', smoking: 'Smoking', cannabis: 'Cannabis use',
  morning_person: 'Morning routine', cooking_habits: 'Weeknight dinner habits', family_closeness: 'Family closeness',
  relationship_type: 'Relationship type',
};

function labelFor(key) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ');
}

const BIG_TOPIC_KEYS = ['relationship_intention', 'family_plans', 'financial_priority', 'relocation_openness', 'relationship_type'];
const COMMUNICATION_TOPIC_KEYS = ['communication_style', 'love_style', 'independence_preference', 'social_energy'];

// `language` is optional: without it (or with 'en') the English output is unchanged; any other language names topics,
// interests and the shared-interest lines in that language (display only; the report itself is untouched).
export function generateCompatibilityCompass(report, language) {
  if (!report) return { north: [], east: [], south: [], west: [] };
  if (language && language !== 'en') return localizedCompass(report, language);

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

function localizedTopic(key, language) {
  if (FIELD_LABELS[key]) return translate(language, `ui.compatibility.topic.${key}`);
  const field = BASICS_FIELDS.find((f) => f.key === key);
  return field ? basicsLabel(field, language) : key.replace(/_/g, ' ');
}

function localizedCompass(report, language) {
  const two = (list) => translate(language, 'ui.homeParts.list.and', { rest: list[0], last: list[1] });
  const pair = (list) => (list.length > 1 ? two(list) : list[0]);
  const interests = report.sharedInterests.map((i) => categoryName(i, language));
  const north = [
    ...report.matchingFields.map((f) => localizedTopic(f.key, language)),
    ...(interests.length > 0 ? [translate(language, 'ui.compatibility.sharedInterestIn', { list: pair(interests.slice(0, 2)) })] : []),
    ...(report.sharedArtists?.length > 0 ? [translate(language, 'ui.compatibility.bothLike', { list: pair(report.sharedArtists.slice(0, 2)) })] : []),
  ];
  const east = [...interests, ...(report.sharedArtists ?? [])];
  const south = report.differingFields.filter((f) => BIG_TOPIC_KEYS.includes(f.key)).map((f) => localizedTopic(f.key, language));
  const west = report.differingFields
    .filter((f) => COMMUNICATION_TOPIC_KEYS.includes(f.key) || !BIG_TOPIC_KEYS.includes(f.key))
    .map((f) => localizedTopic(f.key, language));
  return { north, east, south, west };
}

// "Compatibility Debugger" — turns vague "are we compatible?" into
// specific, named friction points worth an actual conversation,
// grouped the way the person would actually think about them.
const FRICTION_CATEGORIES = [
  { key: 'communication', label: 'Communication expectations', keys: ['communication_style'] },
  { key: 'independence', label: 'Independence & space', keys: ['independence_preference', 'social_energy'] },
  { key: 'money', label: 'Money & financial priorities', keys: ['financial_priority'] },
  { key: 'romance', label: 'Definitions of romance', keys: ['love_style'] },
  { key: 'family', label: 'Family & long-term plans', keys: ['family_plans', 'family_closeness', 'relationship_intention'] },
  { key: 'lifestyle', label: 'Lifestyle & daily rhythm', keys: ['weekend_style', 'morning_person', 'cooking_habits', 'workout'] },
  { key: 'location', label: 'Location & relocation', keys: ['relocation_openness'] },
];

export function generateFrictionPoints(report, language) {
  if (!report) return { points: [], uncategorized: [] };

  const diffKeys = new Set(report.differingFields.map((f) => f.key));

  const points = FRICTION_CATEGORIES
    .map((category) => {
      const matchedKeys = category.keys.filter((k) => diffKeys.has(k));
      if (matchedKeys.length === 0) return null;
      const details = matchedKeys.map((k) => report.differingFields.find((f) => f.key === k));
      const label = language && language !== 'en' ? translate(language, `ui.compatibility.friction.${category.key}`) : category.label;
      return { label, details };
    })
    .filter(Boolean);

  const categorizedKeys = new Set(FRICTION_CATEGORIES.flatMap((c) => c.keys));
  const uncategorized = report.differingFields.filter((f) => !categorizedKeys.has(f.key));

  return { points, uncategorized };
}