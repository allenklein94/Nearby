import { tr, hasOwnTranslation } from '../i18n/translate';
import { BASICS_FIELDS } from '../constants/basicsFields';
import { INTENTION_OPTIONS } from '../constants/intentionOptions';
import { optionSlug } from '../i18n/basicsVocab';
// Item 77: a Dating candidate is explained the same way every other recommendation is -- why, where, when -- from real
// fields only, never a bare "Suggested Match". WHY = the interests you both really have; with none, Browse says the one
// true thing (they fit the person's own dating preferences) and Crossed Paths lets the crossing itself be the reason.
// WHERE/WHEN = the real crossing ("nearby", never a distance, + how long ago), the shared gathering, or -- for Browse, which is only
// bounded to the person's ~7-mile area buckets and carries no distance -- "In your area". No availability, mileage or
// "available tonight" is stated unless BOTH people opted in to "Free tonight" (`mutualFreeTonight`, decided by the server).
// Exact distance is never stated here: it is shown only after a match (Matches screen).
//
// Browse reasons (owner, 2026-11-14): up to TWO, each an answer BOTH people really gave on their own profiles, in this
// order: shared interests > the same relationship intention > one same lifestyle answer (DATING_REASON_BASICS order).
// Never appearance (hair, eyes, height, tattoos, piercings), ethnicity, religion or anything that reveals it (diet,
// cultural values), substances, status (education, money, job, school), zodiac or free text; never a noncommittal
// answer ("Prefer not to say", "Not sure yet", "Somewhere in between", ...); only values from the field's own option
// list (legacy or free-text values never count). Never a percentage, score or "strong match" (items 37/38). Nothing
// shared = the existing "Fits your dating preferences" (Browse) or no reason (Crossed Paths, unchanged).
// Wording (owner, 2026-11-14): one natural sentence per allowed answer, saying exactly what both selected
// (`ui.crossedPaths.reason.<field>.<answer slug>`, `reason.intention.<value>`); an answer with no sentence is never a reason.

export const MAX_DATING_REASONS = 2;

// Ordered: life-direction answers first, then everyday lifestyle.
export const DATING_REASON_BASICS = Object.freeze([
  'family_plans', 'relationship_type', 'relocation_openness', 'weekend_style', 'social_energy', 'morning_person',
  'cooking_habits', 'workout', 'communication_style', 'love_style', 'independence_preference', 'family_closeness', 'pets',
]);

// Answers that say "no particular way" are never a reason, even when both gave them.
const NONCOMMITTAL = /^(prefer not to say|other|not sure|figuring out|depends on the day|somewhere in between|a mix of both|balanced|mix of cooking and ordering|sometimes)/i;
// 'unsure' ("Still figuring it out") is not something two people are looking for together.
const REASON_INTENTIONS = INTENTION_OPTIONS.map((o) => o.value).filter((v) => v !== 'unsure');

const asList = (v) => [].concat(v ?? []).filter(Boolean);
export const lifestyleReasonKey = (key, value) => `ui.crossedPaths.reason.${key}.${optionSlug(value)}`;
export const intentionReasonKey = (value) => `ui.crossedPaths.reason.intention.${value}`;

// The facts two profiles really share, computed from the rows themselves (never cached elsewhere).
export function sharedDatingFacts(mine, theirs) {
  const myInterests = asList(mine?.interests);
  const sharedInterests = asList(theirs?.interests).filter((i) => myInterests.includes(i));
  const myIntentions = asList(mine?.relationship_intention);
  const sharedIntentions = REASON_INTENTIONS.filter((v) => myIntentions.includes(v) && asList(theirs?.relationship_intention).includes(v));
  const sharedLifestyle = [];
  for (const key of DATING_REASON_BASICS) {
    const field = BASICS_FIELDS.find((f) => f.key === key);
    const a = mine?.basics?.[key];
    const b = theirs?.basics?.[key];
    if (!field?.options || typeof a !== 'string' || a !== b) continue;
    if (!field.options.includes(a) || NONCOMMITTAL.test(a) || !hasOwnTranslation('en', lifestyleReasonKey(key, a))) continue;
    sharedLifestyle.push({ key, value: a });
  }
  return { sharedInterests, sharedIntentions, sharedLifestyle };
}

export function datingCardFacts(item, { mode = 'crossedPaths', gatheringText = null, crossedPathsTime = null, mutualFreeTonight = false } = {}) {
  const shared = (item?.sharedInterests ?? []).filter(Boolean);
  const reasons = [];
  if (shared.length > 0) reasons.push({ kind: 'shared_interests', tags: shared });
  if (mode === 'browse') {
    const intentions = asList(item?.sharedIntentions).filter((v) => REASON_INTENTIONS.includes(v));
    if (intentions.length > 0) reasons.push({ kind: 'shared_intention', value: intentions[0] });
    const lifestyle = asList(item?.sharedLifestyle).find((l) => DATING_REASON_BASICS.includes(l?.key));
    if (lifestyle) reasons.push({ kind: 'shared_lifestyle', key: lifestyle.key, value: lifestyle.value });
    if (reasons.length === 0) reasons.push({ kind: 'preferences', text: tr('ui.crossedPaths.fitsDatingPreferences') });
  }
  const shown = reasons.slice(0, MAX_DATING_REASONS);

  let where;
  if (mode === 'browse') where = tr('ui.crossedPaths.inYourArea');
  else if (gatheringText) where = `🗓️ ${gatheringText}`;
  else where = crossedPathsTime ? tr('ui.crossedPaths.crossedNearbyWhen', { time: crossedPathsTime }) : tr('ui.crossedPaths.crossedNearby');
  return { reason: shown[0] ?? null, reasons: shown, where, availability: mutualFreeTonight === true ? tr('ui.crossedPaths.bothFreeTonight') : null };
}

// The one wording of a reason, in the person's language; `t` is the screen's translator.
export function datingReasonText(reason, t = tr) {
  if (!reason) return null;
  if (reason.kind === 'shared_interests') {
    const { tags } = reason;
    return `✨ ${t('discovery.youBothLike')} ${tags.slice(0, 3).join(', ')}${tags.length > 3 ? ` +${tags.length - 3} ${t('discovery.moreCount')}` : ''}`;
  }
  if (reason.kind === 'shared_intention') {
    const option = INTENTION_OPTIONS.find((o) => o.value === reason.value);
    return `${option?.icon ?? '✨'} ${t(intentionReasonKey(reason.value))}`;
  }
  if (reason.kind === 'shared_lifestyle') {
    const field = BASICS_FIELDS.find((f) => f.key === reason.key);
    return `${field?.icon ?? '✨'} ${t(lifestyleReasonKey(reason.key, reason.value))}`;
  }
  return `✨ ${reason.text}`;
}
