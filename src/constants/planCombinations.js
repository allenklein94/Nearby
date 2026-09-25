// Plan combinations (owner item 64, 2026-09-25): some intents naturally contain several activities. This is the ONE table
// naming them, the parts each combines, and the EXISTING template that assembles it (an occasion template or a context
// recipe in experienceTemplates.js). It owns no categories: each part's real leaf tags live on the template's components.
// Recognition is deterministic, from the person's own words and already-resolved facts (never AI):
//   1. a named outing ("night out", "beach day", "client lunch": the plan rows in intentRoutes.js),
//   2. the occasion (birthday, date night, family gathering, business meal),
//   3. the existing context rules (a couple in a planning window = date night, kids = family day, friends = day out),
//   4. the parts the person listed ("dinner, drinks and a show" = night out).
// A combination only ASSEMBLES when the existing rules allow it (a context recipe still needs a planning window the person
// gave; a part with no real supply is dropped). Recognising one never invents a time.
import { EXPERIENCE_TEMPLATES, CONTEXT_TEMPLATES, experienceContextKey } from './experienceTemplates';
import { intentRecipeFor } from './intentRoutes';
import { planParts } from '../utils/planAsk';

export const PLAN_COMBINATIONS = [
  { key: 'date_night', label: 'Date Night', parts: ['food', 'entertainment'], occasion: 'date_night', recipe: 'date_night' },
  { key: 'family_day', label: 'Family Day', parts: ['activity', 'food'], occasion: 'family_gathering', recipe: 'family_day' },
  { key: 'night_out', label: 'Night Out', parts: ['food', 'drinks', 'entertainment'], recipe: 'night_out' },
  { key: 'weekend', label: 'Weekend', parts: ['activity', 'food', 'shopping'], recipe: 'weekend_out' },
  { key: 'beach_day', label: 'Beach Day', parts: ['outdoors', 'food', 'activity'], recipe: 'beach_day' },
  { key: 'birthday', label: 'Birthday', parts: ['food', 'entertainment', 'activity'], occasion: 'birthday' },
  { key: 'business_meeting', label: 'Business Meeting', parts: ['food', 'professional'], occasion: 'business_meal', recipe: 'business_meeting' },
  { key: 'day_out', label: 'Day Out', parts: ['activity', 'food', 'drinks'], recipe: 'friends_out' },
];

// The template a combination assembles with: its occasion's template when that exists, else its context recipe.
export function combinationTemplate(combo) {
  if (!combo) return null;
  if (combo.occasion && EXPERIENCE_TEMPLATES[combo.occasion]) return { kind: 'occasion', key: combo.occasion, template: EXPERIENCE_TEMPLATES[combo.occasion] };
  if (combo.recipe && CONTEXT_TEMPLATES[combo.recipe]) return { kind: 'context', key: combo.recipe, template: CONTEXT_TEMPLATES[combo.recipe] };
  return null;
}

const byRecipe = (r) => PLAN_COMBINATIONS.find((c) => c.recipe === r) ?? null;
const EVENING = /\b(tonight|tonite|this\s+evening|evening|night)\b/i;

export function recognizeCombination({ text = '', occasion = null, partyType = null, dateWindow = null, attributes = [] } = {}) {
  const named = intentRecipeFor(text);
  if (named && byRecipe(named)) return byRecipe(named);
  if (occasion) {
    const hit = PLAN_COMBINATIONS.find((c) => c.occasion === occasion);
    if (hit) return hit;
  }
  const ctx = experienceContextKey({ partyType, dateWindow, attributes });
  if (ctx && byRecipe(ctx)) return byRecipe(ctx);
  const parts = planParts(text).map((p) => p.key);
  if (parts.length >= 2) {
    if (parts.includes('drinks') && (dateWindow === 'tonight' || EVENING.test(text))) return byRecipe('night_out');
    return byRecipe(dateWindow === 'tonight' || EVENING.test(text) ? 'date_night' : 'friends_out');
  }
  return null;
}
