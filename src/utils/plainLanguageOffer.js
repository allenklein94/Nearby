// "See it in plain language" (owner item 59, 2026-09-25; owner decision: option 1, AI suggests, owner confirms,
// OFFER EDITOR ONLY). Pure rules for the suggestion the rewrite-offer-plain-language edge function returns --
// its `sanitize` and `claimProblem` mirror the ones below (the word lists are checked identical by a test).
// LOCKED (owner): the business remains the author. A suggestion is never applied automatically; it must be
// explicitly accepted. Ignoring it leaves the owner's original title/description exactly as typed. The
// suggestion's shape has no price/discount/date/time/redemption fields at all, and `claimProblem` refuses any
// wording that adds a number, $/%, a day/time, or a marketing claim the owner's own text did not already contain.

function text(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return t || null;
}

export function sanitizePlainLanguageSuggestion(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    title: text(s.title, 120),
    description: text(s.description, 300),
  };
}

export function hasPlainLanguageSuggestion(s) {
  return !!s?.description;
}

// Words a suggestion may use only if the owner's own text already did (checked as whole words, plural-insensitive).
// Claims: superlatives, guarantees, urgency, invented savings. Timing: days, times of day, relative days, months
// ("may"/"am"/"pm" are left out on purpose: ordinary words, and a clock time is already caught by the number rule).
export const PLAIN_LANGUAGE_CLAIM_WORDS = ['best', 'exclusive', 'exclusively', 'guarantee', 'guaranteed', 'hurry', 'free', 'unbeatable', 'lowest', 'cheapest', 'save', 'saving', 'savings', 'discount', 'discounted', 'half', 'percent', 'bonus', 'unlimited', 'instant', 'instantly'];
export const PLAIN_LANGUAGE_TIME_WORDS = ['today', 'tonight', 'tomorrow', 'weekend', 'weekday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'morning', 'afternoon', 'evening', 'midnight', 'noon', 'daily', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const PLAIN_LANGUAGE_CLAIM_PHRASES = ['limited time', 'last chance', 'act now', 'only today', 'number one', 'don\'t miss', 'while supplies last', 'first come', 'no catch'];

function words(s) {
  return (s || '').toLowerCase().match(/[a-z]+/g) || [];
}
function stem(w) {
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}
function numbers(s) {
  return (s || '').match(/\d+(?:[.,]\d+)?/g) || [];
}

// null when the suggestion only rewords what the owner said; otherwise a short reason code. Fails closed: a
// suggestion that adds a figure, a symbol, a time or a claim is never shown, and the owner's text stays.
export function claimProblem(suggestion, original = {}) {
  const s = sanitizePlainLanguageSuggestion(suggestion);
  if (!s.description) return 'empty';
  const src = `${original.title || ''} ${original.description || ''}`;
  const out = `${s.title || ''} ${s.description}`;
  const srcNums = new Set(numbers(src).map((n) => n.replace(',', '.')));
  if (numbers(out).some((n) => !srcNums.has(n.replace(',', '.')))) return 'number';
  for (const sym of ['$', '%', '#']) if (out.includes(sym) && !src.includes(sym)) return 'symbol';
  const srcWords = new Set(words(src).map(stem));
  const outWords = words(out).map(stem);
  const claim = new Set(PLAIN_LANGUAGE_CLAIM_WORDS.map(stem));
  const time = new Set(PLAIN_LANGUAGE_TIME_WORDS.map(stem));
  for (const w of outWords) {
    if (srcWords.has(w)) continue;
    if (claim.has(w)) return 'claim';
    if (time.has(w)) return 'time';
  }
  const srcLower = src.toLowerCase().replace(/\s+/g, ' ');
  const outLower = out.toLowerCase().replace(/\s+/g, ' ');
  if (PLAIN_LANGUAGE_CLAIM_PHRASES.some((p) => outLower.includes(p) && !srcLower.includes(p))) return 'claim';
  return null;
}

// Whether the suggestion actually differs from what the owner already wrote (nothing to show/accept otherwise).
export function plainLanguageDiffers(suggestion, current = {}) {
  const s = sanitizePlainLanguageSuggestion(suggestion);
  if (!s.description) return false;
  const norm = (v) => (typeof v === 'string' ? v.trim() : '');
  return norm(s.description) !== norm(current.description) || (s.title != null && norm(s.title) !== norm(current.title));
}

// What "Use this wording" writes: only the title/description, only from a suggestion that passed the guard, and a
// null title keeps the owner's own title. Everything else in the form (price, discount, times, redemption) is untouched
// because it is not part of the patch at all.
export function acceptPlainLanguage(suggestion, current = {}) {
  const s = sanitizePlainLanguageSuggestion(suggestion);
  if (!s.description || claimProblem(s, current)) return null;
  return { title: s.title ?? current.title ?? '', description: s.description };
}

// The context facts sent to the server -- read-only inputs the model uses to avoid contradicting the offer,
// never part of what it's allowed to return. Kept here so the client and the request body agree on the shape.
export function plainLanguageContext({ price, discountPct, offerType, proposedTime, availableFrom, availableUntil, validUntilLabel, redemption } = {}) {
  return {
    price: typeof price === 'number' ? price : null,
    discountPct: typeof discountPct === 'number' ? discountPct : null,
    offerType: offerType || null,
    proposedTime: proposedTime ? true : null,
    availableFrom: availableFrom ? true : null,
    availableUntil: availableUntil ? true : null,
    validUntilLabel: validUntilLabel || null,
    redemptionInstructions: redemption ? true : null,
  };
}
