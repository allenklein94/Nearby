// Item 88 privacy rule (owner, LOCKED 2026-09-26): a dietary or accessibility need the person types exists only for the CURRENT
// search or request. It is never saved to their profile, never a preference, never an onboarding signal. The search logs
// (intent_submissions / intent_outcomes, telemetry only) therefore store the ask with those phrases removed. The patterns are the
// SAME ones matching reads (dietaryOptions.DIETARY_ASKS, askFacets.ACCESSIBILITY_ASKS), never a second list.
import { DIETARY_ASKS } from '../constants/dietaryOptions';
import { ACCESSIBILITY_ASKS } from '../constants/askFacets';

const PATTERNS = [...DIETARY_ASKS, ...ACCESSIBILITY_ASKS].map(([, re]) => new RegExp(re.source, 'gi'));

// Removes every stated dietary / accessibility need from the text; the rest of the ask is kept. null stays null.
export function redactSensitiveNeeds(text) {
  if (typeof text !== 'string') return text ?? null;
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, ' ');
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}
