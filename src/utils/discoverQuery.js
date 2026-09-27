// Discover's search box: ONE classification of what was typed, read by every Discover search path (owner, 2026-09-27).
// Surprise Me ("surprise me ...") and the undecided ask ("I don't know what I want", "what's good tonight") are FIRST-CLASS
// intents: they go straight to the canonical Surprise Me engine (services/surpriseMe.js, the same one Home uses) and are never an
// ordinary search -- no keyword search for the phrase (literalTerm is null), no ordinary classify/resolve, no search-log entry.
// Anything else is an ordinary search: the as-you-type keyword lists use `literalTerm`, the submitted search runs runIntentSearch.
import { pickForMeKind } from '../services/surpriseMeLogic';

export const DISCOVER_QUERY_MIN = 2; // the keyword lists' own threshold

// { kind: 'pick_for_me', pick: 'surprise' | 'undecided', text, literalTerm: null }
// { kind: 'search', text, literalTerm }                      an ordinary search
// { kind: 'none', text, literalTerm: null }                  too short to search
export function discoverQuery(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const pick = pickForMeKind(text);
  if (pick) return { kind: 'pick_for_me', pick, text, literalTerm: null };
  if (text.length < DISCOVER_QUERY_MIN) return { kind: 'none', text, literalTerm: null };
  return { kind: 'search', text, literalTerm: text };
}
