// Surprise Me in the person's language (localization pass 3, 2026-09-28). The engine (services/surpriseMeLogic.js) decides
// everything and keeps its English wording (header, basis line, lane labels, Best Pick's plan parts); this module only words
// those SAME decisions from structured values through the one lookup (i18n/translate.js, translations.<lang>.surprise):
//   header       <- the stated time (result.dateWindow)
//   basis        <- result.basisParts (scope / interests / when / budget / price / party), each part localized, then joined
//   lane label   <- lane.key;   plan <- lane.planParts (the parts' English names -> surprise.planParts.<key>)
// English goes through the same templates and is byte-identical to the engine's own strings (tested).
// Category tags, category-group names, business titles and people's names are inserted as stored (no per-tag translations).
import { translate, DEFAULT_LANGUAGE } from './translate';
import { localMoney, localDate } from './format';
import { scopeLabel, THINGS_TO_DO_GROUPS } from '../services/surpriseMeLogic';
import { CUISINE_OPTIONS } from '../constants/businessAttributes';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';

export const surpriseText = (language, key, vars = null) => translate(language || DEFAULT_LANGUAGE, `surprise.${key}`, vars);

// A plan part's English name ("Something to Do") -> its key ("somethingToDo").
export const planPartKey = (label) => String(label).replace(/(?:^|\s+)(\w)/g, (m, c, i) => (i === 0 ? c.toLowerCase() : c.toUpperCase()));

function planPartText(label, language) {
  const text = translate(language, `surprise.planParts.${planPartKey(label)}`);
  return text.startsWith('surprise.') ? label : text; // an unknown part keeps its English name, never a key path
}

function scopeText(scope, language) {
  if (!scope || scope.level === 'broad') return null;
  if (scope.level === 'cuisine') {
    return CUISINE_OPTIONS.some((o) => o.key === scope.cuisine) ? translate(language, `vocab.cuisines.${scope.cuisine}`) : null;
  }
  if (scope.level === 'energy') {
    return (scope.energies ?? []).map((k) => translate(language, `surprise.energies.${k}`)).filter((t) => !t.startsWith('surprise.')).join(' + ') || null;
  }
  if (scope.level === 'groups') {
    const groups = scope.groups ?? [];
    if (groups.length === THINGS_TO_DO_GROUPS.length && groups.every((g) => THINGS_TO_DO_GROUPS.includes(g))) return surpriseText(language, 'basis.thingsToDo');
    return groups.map((k) => CATEGORY_GROUPS.find((g) => g.key === k)?.label).filter(Boolean).join(' + ') || null;
  }
  return scopeLabel(scope); // category tags, as stored
}

export function surpriseBasisText(parts, language = DEFAULT_LANGUAGE) {
  const words = (parts ?? []).map((p) => {
    if (p.kind === 'scope') return scopeText(p.scope, language);
    if (p.kind === 'interests') return surpriseText(language, 'basis.interests');
    if (p.kind === 'when') return surpriseText(language, `basis.when.${p.dateWindow}`);
    if (p.kind === 'budget') return surpriseText(language, 'basis.under', { price: localMoney(p.amount, language) });
    if (p.kind === 'price') return p.priceLevel === 'free' ? surpriseText(language, 'basis.free') : p.priceLevel;
    if (p.kind === 'party') return surpriseText(language, `basis.party.${p.partyType}`);
    return null;
  }).filter(Boolean);
  return words.length > 0 ? words.join(' · ') : null;
}

export function surpriseHeaderText(dateWindow, language = DEFAULT_LANGUAGE) {
  const known = ['now', 'today', 'tonight', 'tomorrow', 'weekend'].includes(dateWindow);
  return surpriseText(language, `headers.${known ? dateWindow : 'none'}`);
}

export function surpriseLaneHeading(lane, language = DEFAULT_LANGUAGE) {
  const label = surpriseText(language, `lanes.${lane.key}`);
  const plan = Array.isArray(lane.planParts) && lane.planParts.length > 0
    ? lane.planParts.map((p) => planPartText(p, language)).join(' + ')
    : lane.plan ?? null;
  return { label, heading: plan ? `${label} · ${plan}` : label };
}

// Everything the Surprise Me block shows, worded in `language`. Missing parts stay missing (null), exactly as in English.
export function surpriseView(result, language = DEFAULT_LANGUAGE) {
  if (!result) return null;
  const person = result.connectedPerson;
  const hint = result.calendarHint;
  const hintDate = hint?.startDate ? new Date(hint.startDate) : null;
  return {
    header: surpriseHeaderText(result.dateWindow, language),
    basis: Array.isArray(result.basisParts) ? surpriseBasisText(result.basisParts, language) : result.basis ?? null,
    lanes: (result.lanes ?? []).map((lane) => ({ ...lane, ...surpriseLaneHeading(lane, language) })),
    connectedLine: person
      ? (person.forTitle ? surpriseText(language, 'goWithTo', { name: person.name, title: person.forTitle }) : surpriseText(language, 'goWith', { name: person.name }))
      : null,
    calendarLine: hint
      ? surpriseText(language, 'calendarHint', {
        title: hint.title,
        date: (language === DEFAULT_LANGUAGE || !hintDate || Number.isNaN(hintDate.getTime())) ? hint.dateLabel : localDate(hintDate, language),
      })
      : null,
  };
}
