// Phase F ("global onboarding -> product wiring" master plan, CLAUDE.md,
// Sep 3 2026 -- locked build order) -- height is stored everywhere as a
// single real integer column (profiles.height_inches, dating_pref_min/
// max_height_inches), never a feet/inches pair. These are the one
// shared place that converts between that storage shape and the
// feet+inches picker UI both ProfileScreen.js and
// DatingPreferencesScreen.js render, so the two screens can never
// quietly drift onto two different conversions of the same number --
// matching the same "one shared function, reused everywhere, never
// duplicated" convention this codebase already uses for utils/
// timeContext.js, utils/planCompletion.js, etc.

// A real, generous, honest bound (4'0" to 7'0") -- not a fabricated
// "typical human height" range dressed up as a hard validation rule.
// Rejects only a value that could never be a real adult height (a
// picker mis-tap producing 0 or a garbage number), never second-guesses
// a real unusual-but-real value inside it. Matches the live
// profiles_height_inches_check / profiles_dating_pref_*_height_inches_check
// constraints exactly -- kept as the one shared source both the DB
// constraint and this client-side validation were derived from.
export const MIN_HEIGHT_INCHES = 48; // 4'0"
export const MAX_HEIGHT_INCHES = 84; // 7'0"

// Parses a real feet+inches pair typed into two separate text inputs
// into a single total-inches integer. Returns null for a genuinely
// blank pair (nothing entered -- an honest "not set" state, never a
// fabricated default) or for anything that doesn't parse to a real
// value inside the bound above -- callers are expected to treat null
// differently from "blank" vs. "invalid" themselves, since this
// function's only job is "give me a real number or tell me you can't."
export function feetInchesToTotalInches(feetStr, inchesStr) {
  const feet = parseInt(feetStr, 10);
  const inches = parseInt(inchesStr, 10);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return null;
  const total = feet * 12 + inches;
  if (total < MIN_HEIGHT_INCHES || total > MAX_HEIGHT_INCHES) return null;
  return total;
}

// True only when both fields are genuinely empty -- the "the user
// hasn't touched this at all" case, distinct from "typed something
// invalid," so a caller can tell the difference between "save null,
// nothing to see here" and "block save, ask them to fix it."
export function isBlankHeightPair(feetStr, inchesStr) {
  return !String(feetStr ?? '').trim() && !String(inchesStr ?? '').trim();
}

// The inverse of feetInchesToTotalInches -- given a real stored total
// (or null/undefined), returns the two raw strings a pair of text
// inputs should show. Never fabricates a default height for a null
// input -- both come back as empty strings, matching every other
// "optional, blank until the user sets it" field in this app.
export function totalInchesToFeetInches(totalInches) {
  if (totalInches === null || totalInches === undefined || Number.isNaN(totalInches)) {
    return { feet: '', inches: '' };
  }
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return { feet: String(feet), inches: String(inches) };
}

// A real, human-readable "5'10"" string for display -- returns null
// (not a placeholder string) for a null input, so a caller renders
// its own honest "not set" copy instead.
export function formatHeightInches(totalInches) {
  if (totalInches === null || totalInches === undefined) return null;
  const { feet, inches } = totalInchesToFeetInches(totalInches);
  return `${feet}'${inches}"`;
}
