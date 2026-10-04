// Infer first, ask only what is missing (owner item 61, 2026-09-25). "Coffee tonight with some friends" should arrive in
// Create Gathering already knowing Category (Food & Drink), Subcategory (Coffee), Group (Friends), Time (Tonight) and
// Activity (Meet friends), so the host is asked only for what their words did not say (the exact time, the place).
//
// Deterministic ONLY (never AI, so it works with no Anthropic credit): each layer is read from the person's own words
// through that layer's existing source (item 60's ontology): subcategory via the synonym table (tagsForPhrase), category
// via canonicalGroupForTag, activity via activitiesFromText, group via the closed party-type vocabulary. Rules:
//  - Nothing is committed. Every inferred value is a prefill shown back on its own step, fully editable.
//  - Time is only ever one of the existing When preset chips (now / tonight / tomorrow), picked from the person's OWN
//    words, never from the AI's dateWindow; the When step is never skipped, so the host confirms or changes it.
//  - Activity is derived and shown, never stored (item 37). Energy, commitment, occasion and attributes are NOT asked
//    for at creation (the owner's "that's annoying" list); they stay inferred elsewhere or unset.
//  - A business-only tag (Dental...) is never inferred for a gathering (canonicalGroupForTag only knows consumer tags).
import { tagsForPhrase } from '../constants/categorySynonyms';
import { canonicalGroupForTag } from '../constants/categoryMapping';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { activitiesFromText, ACTIVITIES } from '../constants/activityLayer';
import { partnerPartyType } from '../constants/askFacets';

// Group from the person's own words. First match wins, most specific first; no match = null (not asked for here).
const GROUP_RULES = [
  ['date', null], // partnerPartyType (girlfriend, wife, partner...) handled below
  ['family', /\b(my\s+)?(kids?|children|family|son|daughter|toddlers?|parents|mom|dad)\b/i],
  ['coworkers', /\b(co-?workers?|colleagues?|work\s+friends|the\s+team|my\s+team|the\s+office)\b/i],
  ['new_people', /\b(meet|meeting)\s+(new\s+)?people\b|\bnew\s+people\b|\bmake\s+new\s+friends\b|\bpeople\s+I\s+don'?t\s+know\b/i],
  ['groups', /\b(big|large)\s+group\b/i],
  ['friends', /\b(friends?|buddies|buddy|pals?|the\s+crew|my\s+crew|the\s+guys|the\s+girls)\b/i],
  ['solo', /\b(by\s+myself|alone|solo|just\s+me)\b/i],
];

export function groupFromText(text) {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  if (partnerPartyType(t)) return 'date';
  if (/\b(a\s+)?date\b/i.test(t) && !/\b(up\s+to|to)\s+date\b/i.test(t)) return 'date';
  for (const [key, re] of GROUP_RULES) if (re && re.test(t)) return key;
  return null;
}

// One of the existing WHEN_PRESETS keys, from the person's own words only. "today"/"this weekend" have no preset of their
// own, so they stay unanswered (the host picks on the When step).
export function whenPresetFromText(text) {
  const t = String(text ?? '');
  if (/\b(right\s+now|now)\b/i.test(t)) return 'now';
  if (/\b(tonight|this\s+evening|tonite)\b/i.test(t)) return 'tonight';
  if (/\btomorrow\b/i.test(t)) return 'tomorrow';
  return null;
}

// "4 people" -> 4; "3 friends" / "me and 3 friends" -> 4 (the friends plus the host). Only a stated number, never a guess.
// Spelled-out counts ("four people", "table for six") read the same as digits. "one" is left out on purpose ("for one more drink").
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const COUNT_WORD_RE = new RegExp(`\\b(${Object.keys(COUNT_WORDS).join('|')})\\b`, 'gi');

export function partySizeFromText(text) {
  const t = String(text ?? '').replace(COUNT_WORD_RE, (w) => String(COUNT_WORDS[w.toLowerCase()]));
  const people = t.match(/\b(\d{1,3})\s+(people|of\s+us|persons)\b/i);
  if (people) return Number(people[1]);
  const friends = t.match(/\b(\d{1,2})\s+(friends|buddies|coworkers|colleagues)\b/i);
  if (friends) return Number(friends[1]) + 1;
  // Item 80: "a 20-person birthday", "party of 12", "table for 8", "12 guests", "birthday dinner for 12" (a bare "for N" only when
  // N is not a time, duration, price or distance: "for 2 hours", "for 5 PM", "for $30", "for 10 minutes" are not party sizes).
  const other = t.match(/\b(\d{1,3})[- ]?(?:person|people)\b/i)
    ?? t.match(/\b(?:party|group|table)\s+(?:of|for)\s+(\d{1,3})\b/i)
    ?? t.match(/\b(\d{1,3})\s+(?:guests|adults|attendees)\b/i)
    ?? t.match(/(?<!\$)\bfor\s+(\d{1,3})\b(?!\s*(?:[:.]\d|a\.?m\b|p\.?m\b|o'?clock|hours?|hrs?|h\b|minutes?|mins?|days?|nights?|weeks?|months?|years?|dollars?|bucks|%|percent|miles?|mi\b|km\b|th\b|st\b|nd\b|rd\b|-?\s*(?:person|people)\b))/i);
  if (other) return Number(other[1]);
  return null;
}

// The title is the person's OWN words with the timing taken out (timing lives on the When step), so nothing is invented:
// "Coffee tonight with some friends" -> "Coffee with some friends". Editable on the What step like any prefill.
const TIME_PHRASES = /\b(right\s+now|now|tonight|tonite|this\s+evening|tomorrow|today|this\s+weekend|this\s+afternoon|this\s+morning)\b/gi;
// Item 109: a first-person lead-in is how the person ASKED, not the plan's name: "I want to play pickleball tonight" ->
// "Pickleball" ("I'd like to go bowling" -> "Bowling"). Only a lead-in at the very start, then at most one plain verb.
const LEAD_IN = /^\s*(?:(?:i\s+(?:really\s+)?(?:want|wanna|would\s+like|'d\s+like|feel\s+like|am\s+looking|'m\s+looking)|i'd\s+like|let'?s|looking)\s*(?:to\s+)?(?:(?:go|play|do|grab|get|have)\s+(?:some\s+|a\s+)?)?)/i;
export function titleFromText(text) {
  const t = String(text ?? '').replace(LEAD_IN, '').replace(TIME_PHRASES, ' ').replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.!?-]+$/g, '').trim();
  if (!t) return null;
  return (t[0].toUpperCase() + t.slice(1)).slice(0, 60);
}

export function inferGatheringFromText(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const tag = tagsForPhrase(t).find((x) => canonicalGroupForTag(x)) ?? null;
  const groupKey = tag ? canonicalGroupForTag(tag) : null;
  const partyType = groupFromText(t);
  const whenPreset = whenPresetFromText(t);
  const activities = activitiesFromText(t);
  const partySize = partySizeFromText(t);
  const title = tag ? titleFromText(t) : null;
  return {
    tag,
    categoryKey: groupKey,
    categoryLabel: CATEGORY_GROUPS.find((g) => g.key === groupKey)?.label ?? null,
    partyType,
    whenPreset,
    activities,
    partySize,
    title,
  };
}

// What the Create screen shows as "From what you said" (item 187): the person's PLAN, never the business-directory taxonomy.
// Activity / Purpose / Time / People, each only when really captured, and nothing else:
//   Activity = the canonical tag the gathering will store (`interest_tag`); its group (Food & Drink) is never shown here.
//   Purpose  = the existing "What kind of plan is this?" value (`party_type`), from the person's own words or a chip.
//   Time     = the When preset the words named (words-only, never the AI's dateWindow).
//   People   = a number the person actually stated (suggested into capacity); never inferred from a date, birthday or family.
// No group/category row and no derived "To do" row (activities are derived, never stored). `key` is the stored value the
// screen localizes; `label`/`value` stay English for logs and tests.
const PARTY_LABELS = { solo: 'Just you', friends: 'Friends', groups: 'A big group', date: 'A date', family: 'Family', coworkers: 'Coworkers', new_people: 'New people' };
const WHEN_LABELS = { now: 'Now', tonight: 'Tonight', tomorrow: 'Tomorrow' };

export function inferredSummary(inf) {
  if (!inf) return [];
  const rows = [];
  if (inf.tag) rows.push({ layer: 'activity', label: 'Activity', value: inf.tag, key: inf.tag });
  if (inf.partyType && PARTY_LABELS[inf.partyType]) rows.push({ layer: 'purpose', label: 'Purpose', value: PARTY_LABELS[inf.partyType], key: inf.partyType });
  if (inf.whenPreset && WHEN_LABELS[inf.whenPreset]) rows.push({ layer: 'time', label: 'Time', value: WHEN_LABELS[inf.whenPreset], key: inf.whenPreset });
  if (Number.isInteger(inf.partySize) && inf.partySize > 0) rows.push({ layer: 'people', label: 'People', value: String(inf.partySize), key: inf.partySize });
  return rows;
}

// The merged/structured result and the no-AI classification now live in utils/askResolver.js (resolveAsk), shared by every
// entry point; this file keeps the per-layer word rules it reads.

// Item 109: does this ask say the person is doing it WITH people they would invite? Only then does Create ask "Who do you want
// to invite?" (right after When). From what they said or chose only: a who-it's-with party type (friends, date, family,
// coworkers, a big group), or the words naming people ("with Sam and Alex"). The names are never matched to friends: the step
// only opens the friend list, and nobody is preselected. Solo, meet-new-people and no who at all = no step.
const INVITE_PARTY_TYPES = new Set(['friends', 'date', 'family', 'coworkers', 'groups']);
const NOT_A_NAME = /^(?:I|My|Some|A|An|The|Friends?|Family|Kids?|Coworkers?|People|Someone|Anyone|Everyone|Others?|Me|Us|Them)$/;
export function namesPeopleFromText(text) {
  const m = String(text ?? '').match(/\bwith\s+([A-Z][a-z]+)\b/);
  return !!m && !NOT_A_NAME.test(m[1]);
}
export function inviteStepApplies(partyType, text) {
  return INVITE_PARTY_TYPES.has(partyType) || namesPeopleFromText(text);
}
