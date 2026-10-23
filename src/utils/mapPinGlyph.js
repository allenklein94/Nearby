// Owner idea "346" (2026-10-23, approved): a map pin's TYPE never rests on colour alone. Each pin keeps its colour and also
// carries a glyph Nearby already uses for that type, so a colour-blind viewer can tell them apart without tapping:
//   gathering  -> its category icon (gatheringCategoryStyles.js)
//   live now   -> the same category icon + the 🔴 badge from "🔴 LIVE NOW" (isMapLiveNow decides, unchanged)
//   perk       -> 🎁 (the perk callout's own glyph)
//   business   -> 🏪 (the business mark: profile placeholder, Businesses preferences)
// Pure; no new strings. Colours, placement, taps and screen-reader labels stay where they were (GatheringsMapView.js).
export const LIVE_BADGE_GLYPH = '🔴';
export const PERK_PIN_GLYPH = '🎁';
export const BUSINESS_PIN_GLYPH = '🏪';
const FALLBACK_GATHERING_GLYPH = '📍';

// -> { glyph, badge } ; badge is the live mark or null.
export function mapPinGlyph({ kind, live = false, categoryIcon = null } = {}) {
  if (kind === 'perk') return { glyph: PERK_PIN_GLYPH, badge: null };
  if (kind === 'business') return { glyph: BUSINESS_PIN_GLYPH, badge: null };
  return { glyph: categoryIcon || FALLBACK_GATHERING_GLYPH, badge: live ? LIVE_BADGE_GLYPH : null };
}

// Pin geometry (px). The tip is the anchor (bottom-centre, like a standard pin); the head's centre sits PIN_HEAD_LIFT above
// it so item 44's pin -> sheet frame still starts from the head (guarded in mapPinGlyph.test.js).
export const PIN_HEAD = 26;
export const PIN_TAIL = 5;
export const PIN_GLYPH_SIZE = 15;
export const PIN_BADGE = 12;
