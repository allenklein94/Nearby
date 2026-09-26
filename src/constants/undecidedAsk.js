// "I don't know what I want" is a valid intent (owner item 90, 2026-09-26). Someone opens Nearby and thinks "what's good
// tonight?" -- Nearby must not force a category. Deterministic phrase rules on the person's own words, never AI. "What's good"
// counts only on its own or with time / place words ("what's good tonight", "what's good around here"), never "what's good for
// a headache" or "what's good at the Thai place".
const UNDECIDED = [
  /\b(?:i|we)?\s*(?:don'?t|do\s+not|dunno)\s+(?:really\s+)?know\s+what\s+(?:(?:i|we)\s+want|(?:(?:i|we)\s+)?(?:want\s+|should\s+)?(?:to\s+)?do)\b/i,
  /\bno\s+idea\s+what\s+(?:(?:i|we)\s+want|(?:(?:i|we)\s+)?(?:want\s+)?to\s+do)\b/i,
  /\bnot\s+sure\s+what\s+(?:(?:i|we)\s+want|(?:(?:i|we)\s+)?(?:want\s+)?to\s+do)\b/i,
  /\bi'?m\s+(?:so\s+)?(?:undecided|indecisive)\b/i,
  /^\s*(?:idk|i\s+dunno|dunno)\b/i,
];
const TIME_PLACE = '(?:\\s+(?:to\\s+do\\s+)?(?:tonight|today|tomorrow|this\\s+(?:weekend|evening|afternoon|morning)|right\\s+now|now|around(?:\\s+here)?|near(?:by|\\s+me|\\s+here)?|here|out\\s+there|in\\s+town|going\\s+on))*';
const WHATS_GOOD = new RegExp(`(?:^|[.,!?]\\s*|\\b(?:so|ok|okay|hey|um|hmm)\\s*,?\\s*)(?:what'?s|what\\s+is|anything)\\s+good${TIME_PLACE}\\s*[?.!]*\\s*$`, 'i');
const NEGATED = /\b(?:i\s+)?know\s+exactly\s+what\b/i;

export function undecidedAskFromText(text) {
  if (typeof text !== 'string' || !text.trim() || NEGATED.test(text)) return false;
  return UNDECIDED.some((re) => re.test(text)) || WHATS_GOOD.test(text.trim());
}

// The rest of the sentence, which can still carry real signals ("I don't know what I want, something under $30 tonight").
export function stripUndecidedPhrase(text) {
  if (typeof text !== 'string') return '';
  let t = text;
  for (const re of UNDECIDED) t = t.replace(new RegExp(re.source, 'gi'), ' ');
  t = t.replace(/(?:what'?s|what\s+is|anything)\s+good\b/gi, ' ');
  return t.replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}
