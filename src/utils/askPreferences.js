// Must-have vs nice-to-have (owner item 103, 2026-09-27). "Somewhere outside tonight, preferably with live music": what follows a
// hedge word ("preferably", "ideally", "if possible", "bonus if", "would be nice") is a PREFERENCE, never a filter, so a hedged
// category ranks its matches up instead of removing everything else. Everything the person states plainly stays as it was
// (a category filters, a time window filters). Deterministic, the person's own words only; "maybe" is deliberately not a hedge
// for the CATEGORY ("I don't know, maybe coffee" is an ordinary ask). For the environment it is (item 105, constants/askFacets.js).
import { tagsForPhrase } from '../constants/categorySynonyms';

const HEDGE = /\b(?:preferably|preferrably|ideally|if\s+possible|optionally|bonus\s+(?:if|for)|even\s+better\s+if|(?:it\s+)?would\s+be\s+nice|nice\s+to\s+have|nice\s+if|if\s+there(?:'s|\s+is)\s+any)\b/i;

// { before, after }: the text before the first hedge, and the hedged tail up to the end of that sentence (text after a
// following sentence break is plain again). No hedge = null.
export function splitHedge(text) {
  if (typeof text !== 'string') return null;
  const m = HEDGE.exec(text);
  if (!m) return null;
  const tail = text.slice(m.index + m[0].length);
  const end = tail.search(/[.;!?]/);
  return {
    before: text.slice(0, m.index),
    after: end === -1 ? tail : tail.slice(0, end),
    rest: end === -1 ? '' : tail.slice(end + 1),
  };
}

// The ask's category is a preference when its words appear ONLY inside the hedged tail.
export function isPreferredCategory(text, category) {
  if (!category) return false;
  const h = splitHedge(text);
  if (!h) return false;
  const plain = `${h.before} ${h.rest}`;
  return tagsForPhrase(h.after).includes(category) && !tagsForPhrase(plain).includes(category);
}

export const PREFERRED_CATEGORY_POINTS = 2;
