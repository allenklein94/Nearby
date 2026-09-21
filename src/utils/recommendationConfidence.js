// Owner item 61: how strongly a recommendation speaks matches how much real evidence is behind it. Confidence is
// never a number and never invented: it is derived only from which kinds of real reasons the card carries.
//
//   strong evidence = a declared interest ("Because you like X"), a connected friend hosting/going, or an active ask
//   high    two or more independent kinds of reason, at least one of them strong ("Because you like Coffee" + a friend)
//   medium  exactly one strong reason, or activity-only interest plus another kind
//   low     nothing strong: only popularity, timing, activity or facts (distance, weather...)
// A card with no real reason gets no confidence and no headline (nothing is said).
import { reasonKind, REASON_KINDS } from '../constants/signalPriority';

export const CONFIDENCE_HEADLINE = {
  high: 'A strong match for you',
  medium: 'You might like this',
  low: 'Worth discovering',
};

// Activity-only and hobby-related interests are personalized but not STRONG evidence (a declared interest is).
const isActivityOnly = (text) => /^(Based on your recent activity: |Related to your interest in )/.test(text ?? '');

// signals: [{ kind?, text }]; intent: the active Ask-Nearby search matched this object.
export function recommendationConfidence(signals = [], { intent = false } = {}) {
  const list = (signals ?? []).filter((s) => s && s.text);
  if (list.length === 0 && !intent) return null;
  const kinds = new Set();
  let strong = intent;
  for (const s of list) {
    const k = reasonKind(s);
    if (k) kinds.add(k);
    if (k === REASON_KINDS.SOCIAL || (k === REASON_KINDS.PERSONALIZED && !isActivityOnly(s.text))) strong = true;
  }
  if (intent) kinds.add('intent');
  const independent = kinds.size;
  if (strong && independent >= 2) return 'high';
  if (strong) return 'medium';
  if (kinds.has(REASON_KINDS.PERSONALIZED) && independent >= 2) return 'medium';
  return 'low';
}

export function confidenceHeadline(signals, opts) {
  const c = recommendationConfidence(signals, opts);
  return c ? CONFIDENCE_HEADLINE[c] : null;
}
