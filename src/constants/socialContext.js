// Social context (owner decision 2026-09-26, LOCKED): ask-side ONLY, no new storage. It translates the person's own words into a
// small normalized contract and compares it against fields gatherings ALREADY store; it is never persisted and is not a second
// source of truth. Two independent signals:
//   social_context  = the social SCALE of the setting: solo | one_on_one | small_group | group | null (null = not said, never "no")
//   meet_new_people = the social PURPOSE, independent of scale: true | false | null (null = not said, never false)
// Not relationship context (friends / date / family live in party_type and never reach a business) and not party size ("party of 6"
// is a size, not a setting). Deterministic phrase rules only, never AI. `source` is internal metadata ('explicit' = the person
// named the setting itself, 'normalized' = a clear phrase translated into it), never shown or persisted.
//
// Existing gathering fields it is compared against (host-declared, unchanged):
//   party_type 'solo' -> solo; party_type 'groups' -> group; party_type 'new_people' -> meet new people
//   capacity is TOTAL people including the host (migration 20270209): capacity 1 -> solo, capacity 2 -> one_on_one, larger
//     capacities say nothing on their own. Capacity never implies meeting new people. An intimate group_size_feel (1-2) alongside
//     capacity 2 supports one-on-one instead of conflicting with it; a group feel/plan kind with capacity 1 or 2 conflicts -> unknown.
//   group_size_feel 1-2 ("Intimate") -> small_group; 4-5 ("Big group") -> group; 3 -> neither (ambiguous, not forced)
// Ranking only, typed consumer asks only: a fit lifts, a clear mismatch sinks modestly, unknown on either side is neutral, nothing
// is removed. Gathering candidates only: it never adds a result and never touches people, so "meet new people" can never become
// stranger discovery. Never in Home/Discover feeds, business requests/opportunities, notifications, badges or profiles.

export const SOCIAL_CONTEXTS = ['solo', 'one_on_one', 'small_group', 'group'];
const SCALE = ['one_on_one', 'small_group', 'group'];

const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()] ?? null);
// Headcount of other people -> scale. 1 other = one-on-one, 2-7 others (3-8 people) = small group, 8+ others (9+) = group.
const scaleForOthers = (n) => (n == null ? null : n <= 1 ? 'one_on_one' : n <= 7 ? 'small_group' : 'group');
const scaleForPeople = (n) => (n == null ? null : n <= 2 ? 'one_on_one' : n <= 8 ? 'small_group' : 'group');

// A phrase preceded closely by a negation says the opposite ("I don't want to go alone"), so it is not read.
const negated = (t, index) => /\b(?:don'?t|do\s+not|not|never|no|without|rather\s+not)\b(?:\s+\S+){0,3}\s*$/i.test(t.slice(Math.max(0, index - 40), index));
const PERSON = String.raw`(?:friend|buddy|pal|mate|coworker|co-worker|colleague|neighbou?r)`;

const SCALE_RULES = [
  // [context, source, regex]; a regex may carry a count in group 1, resolved by the rule's own fn.
  ['one_on_one', 'explicit', /\b(?:one[\s-]on[\s-]one|1[\s:-]on[\s:-]1|1:1)\b/i],
  ['one_on_one', 'normalized', /\b(?:just\s+)?the\s+two\s+of\s+us\b|\bjust\s+us\s+two\b|\b(?:just\s+)?me\s+and\s+one\s+other\s+person\b/i],
  ['one_on_one', 'normalized', new RegExp(String.raw`\bwith\s+(?:a|one|my|an\s+old)\s+${PERSON}\b(?!s)(?!\s+and\b)`, 'i')],
  ['small_group', 'explicit', /\b(?:small|little|intimate)\s+group\b/i],
  ['small_group', 'normalized', new RegExp(String.raw`\b(?:a\s+few|a\s+couple(?:\s+of)?|a\s+handful\s+of)\s+(?:of\s+)?(?:${PERSON}s|people|of\s+us)\b|\bfew\s+of\s+us\b`, 'i')],
  ['group', 'explicit', /\b(?:big|large|huge)\s+group\b/i],
  ['group', 'normalized', /\b(?:the\s+whole\s+(?:crew|gang|team|squad)|a\s+(?:big\s+)?bunch\s+of\s+(?:us|friends|people)|lots\s+of\s+people)\b/i],
];
// Counted forms: "with two friends" (others), "a group of 12" (people), "the 3 of us" (people).
const COUNT_RULES = [
  [new RegExp(String.raw`\bwith\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(?:other\s+)?${PERSON}s\b`, 'i'), scaleForOthers],
  [/\ba\s+group\s+of\s+(\d{1,2}|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b/i, scaleForPeople],
  [/\bthe\s+(\d{1,2}|three|four|five|six|seven|eight|nine|ten|twelve)\s+of\s+us\b/i, scaleForPeople],
];
const SOLO_RE = /\b(?:solo|by\s+myself|on\s+my\s+own|just\s+me|alone)\b(?!\s+(?:and|with|\+)\b)/gi;

const MEET_FALSE = [
  /\b(?:don'?t|do\s+not|rather\s+not|not\s+looking\s+to|not\s+trying\s+to)\s+(?:want\s+to\s+|wanna\s+)?meet\s+(?:new\s+|other\s+)?(?:people|strangers|anyone)\b/i,
  /\bno\s+strangers\b/i,
  /\b(?:just|only)\s+(?:my|our)\s+(?:friends|crew|group|people)\b/i,
  /\bpeople\s+I\s+(?:already\s+)?know\b/i,
];
const MEET_TRUE = [
  /\bmeet\s+(?:some\s+)?(?:new|other)\s+people\b/i,
  /\bmeet\s+people\b/i,
  /\bmake\s+(?:some\s+)?(?:new\s+)?friends\b/i,
  /\bpeople\s+I\s+don'?t\s+(?:already\s+)?know\b/i,
  /\bmeet\s+strangers\b/i,
  /\bmingle\b/i,
];

function firstUnnegated(t, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of t.matchAll(g)) if (!negated(t, m.index)) return m;
  return null;
}

function scaleFromText(t) {
  for (const [key, source, re] of SCALE_RULES) if (firstUnnegated(t, re)) return { value: key, source };
  for (const [re, fn] of COUNT_RULES) {
    const m = firstUnnegated(t, re);
    const v = m ? fn(toNum(m[1])) : null;
    if (v) return { value: v, source: 'normalized' };
  }
  if (firstUnnegated(t, SOLO_RE)) return { value: 'solo', source: 'explicit' };
  return { value: null, source: null };
}

function meetFromText(t) {
  if (MEET_FALSE.some((re) => re.test(t))) return { value: false, source: 'explicit' };
  // "meet new people" read as a want only when not itself negated ("not here to meet people").
  if (MEET_TRUE.some((re) => firstUnnegated(t, re))) return { value: true, source: 'explicit' };
  return { value: null, source: null };
}

// The contract: { social_context, meet_new_people, source: { social_context, meet_new_people } }.
export function socialSignalsFromText(text) {
  const t = typeof text === 'string' ? text : '';
  const scale = t.trim() ? scaleFromText(t) : { value: null, source: null };
  const meet = t.trim() ? meetFromText(t) : { value: null, source: null };
  return { social_context: scale.value, meet_new_people: meet.value, source: { social_context: scale.source, meet_new_people: meet.source } };
}

export function isValidSocialSignals(s) {
  return !!s && typeof s === 'object'
    && (s.social_context === null || SOCIAL_CONTEXTS.includes(s.social_context))
    && (s.meet_new_people === null || s.meet_new_people === true || s.meet_new_people === false);
}

// What an existing gathering's OWN declared fields say, read at ranking time (nothing stored). Conflicting scale facts (e.g. a
// capacity of 1 with a "Big group" feel) cancel out to unknown rather than picking one.
export function gatheringSocialFacts(c) {
  const contexts = new Set();
  if (c?.partyType === 'solo') contexts.add('solo');
  const scale = new Set();
  if (c?.capacity === 1) scale.add('solo');
  if (c?.capacity === 2) scale.add('one_on_one');
  const feel = c?.groupSizeFeel;
  if (Number.isInteger(feel) && feel >= 1 && feel <= 2) scale.add('small_group');
  if (Number.isInteger(feel) && feel >= 4 && feel <= 5) scale.add('group');
  if (c?.partyType === 'groups') scale.add('group');
  // A capacity of 1 or 2 with an intimate feel stays solo / one-on-one: the feel supports it rather than conflicting.
  if (scale.size === 2 && scale.has('small_group') && (scale.has('solo') || scale.has('one_on_one'))) scale.delete('small_group');
  if (scale.size === 1) contexts.add([...scale][0]);
  return { contexts, meetNewPeople: c?.partyType === 'new_people' ? true : null };
}

export const FIT_POINTS = 2;
export const MISMATCH_POINTS = -1;
const MISMATCH = { one_on_one: ['group'], small_group: ['group'], group: ['one_on_one', 'small_group'], solo: [] };
const REASON = { solo: '🧘 Solo-friendly', one_on_one: '👥 Just one other person', small_group: '👥 Small-group feel', group: '👥 Big-group feel' };
// party_type values the existing party-type match (priceAndPartyBonus) already credits when the ask's partyType is the same.
const PARTY_TYPE_OF = { solo: 'solo', group: 'groups' };

export function socialFit(c, signals, { partyType = null } = {}) {
  if (!c || c.type !== 'gathering' || !isValidSocialSignals(signals)) return { delta: 0, reason: null };
  const facts = gatheringSocialFacts(c);
  let delta = 0;
  let reason = null;
  const asked = signals.social_context;
  if (asked && facts.contexts.size) {
    if (facts.contexts.has(asked)) {
      // Credited once: if the only evidence is the party_type the existing party-type bonus already matched, add nothing more.
      const alreadyCredited = PARTY_TYPE_OF[asked] && partyType === PARTY_TYPE_OF[asked] && c.partyType === PARTY_TYPE_OF[asked];
      if (!alreadyCredited) { delta += FIT_POINTS; reason = REASON[asked]; }
    } else if ([...facts.contexts].some((k) => MISMATCH[asked].includes(k))) {
      delta += MISMATCH_POINTS;
    }
  }
  if (signals.meet_new_people === true && facts.meetNewPeople && partyType !== 'new_people') {
    delta += FIT_POINTS;
    reason = reason ?? '🙋 Good for meeting new people';
  } else if (signals.meet_new_people === false && facts.meetNewPeople) {
    delta += MISMATCH_POINTS;
  }
  return { delta, reason };
}

// Re-scores gathering candidates only; never adds or removes one. No signal = the same array.
export function applySocialToCandidates(candidates, signals, opts = {}) {
  if (!Array.isArray(candidates) || !isValidSocialSignals(signals) || (signals.social_context === null && signals.meet_new_people === null)) return candidates;
  return candidates.map((c) => {
    const { delta, reason } = socialFit(c, signals, opts);
    return delta ? { ...c, score: (c.score ?? 0) + delta, subtitle: c.subtitle ?? reason ?? c.subtitle } : c;
  });
}
