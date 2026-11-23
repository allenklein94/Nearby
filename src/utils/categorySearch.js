// Owner, 2026-11-15: search inside the business category pickers (Profile "Also classify as", sign-up "Also Classify As",
// Temporary Boost, Post availability's category, the AI automation rule's category). ~256 flat tags were a wall of chips.
// Filtering ONLY hides chips: it never changes the taxonomy, the saved values or the picker's own selection rules
// (`toggleSecondaryCategory`'s limit of 5 still decides a tap). Selected options always stay visible, so a search never
// hides what the owner already picked and it can still be unticked.

// Lower-case, accents removed, "&" / punctuation as spaces, so "cafe" finds "Café" and "food drink" finds "Food & Drink".
export function normalizeForSearch(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// An option matches when every typed word starts a word of its label (in the owner's language) or of its stored key.
export function categoryMatches(query, texts) {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.map(normalizeForSearch).filter(Boolean);
  return words.every((w) => haystack.some((h) => h.split(' ').some((part) => part.startsWith(w))));
}

// options: the picker's own list, in its own order. labelFor: what the chip shows. keyFor: the saved value.
// selected: saved value(s) currently picked (array or a single value or null).
export function filterCategoryOptions(options, query, { labelFor = (o) => o, keyFor = (o) => o, selected = [] } = {}) {
  const list = Array.isArray(options) ? options : [];
  if (normalizeForSearch(query) === '') return list;
  const picked = new Set(Array.isArray(selected) ? selected : selected == null ? [] : [selected]);
  return list.filter((o) => picked.has(keyFor(o)) || categoryMatches(query, [String(labelFor(o) ?? ''), String(keyFor(o) ?? '')]));
}

// True when a search is typed and nothing besides already-selected options matched (the "No categories match" line).
export function noCategoryMatch(options, query, opts = {}) {
  if (normalizeForSearch(query) === '') return false;
  const picked = new Set(Array.isArray(opts.selected) ? opts.selected : opts.selected == null ? [] : [opts.selected]);
  const keyFor = opts.keyFor ?? ((o) => o);
  return filterCategoryOptions(options, query, opts).every((o) => picked.has(keyFor(o)));
}
