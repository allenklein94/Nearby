// One grouping rule for every long category/interest picker (owner, 2026-11-21: "256 interests in one list is overwhelming").
// Display only: the taxonomy (CATEGORY_GROUPS, flat group -> tag) and every saved value stay exactly as they were. A picker
// passes the options it already offered (same order, same filter, e.g. PERSONAL_INTEREST_OPTIONS without Dating); this only
// sorts them under their existing group. Read by components/TagGroupPicker.js.
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';

// Case- and accent-insensitive, so "cafe" finds "Café" and "Mexico" finds "México".
export function foldForSearch(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Options under their group, in CATEGORY_GROUPS order; within a group, the options' own order. An option in no group
// (none today) lands in a trailing 'other' bucket so nothing offered is ever dropped. With a query, only tags whose shown
// label or key matches stay, and empty groups go.
export function buildTagGroups(options, { query = '', labelFor = (tag) => tag, groups = CATEGORY_GROUPS } = {}) {
  const offered = Array.isArray(options) ? options : [];
  const q = foldForSearch(query);
  const matches = (tag) => !q || foldForSearch(labelFor(tag)).includes(q) || foldForSearch(tag).includes(q);
  const placed = new Set();
  const out = [];
  for (const g of groups) {
    const inGroup = new Set(g.tags);
    const tags = offered.filter((tag) => inGroup.has(tag) && !placed.has(tag));
    tags.forEach((tag) => placed.add(tag));
    const shown = tags.filter(matches);
    if (shown.length) out.push({ key: g.key, label: g.label, icon: g.icon ?? null, tags: shown });
  }
  const rest = offered.filter((tag) => !placed.has(tag) && matches(tag));
  if (rest.length) out.push({ key: 'other', label: null, icon: null, tags: rest });
  return out;
}

export function selectedInGroup(group, selected) {
  const set = new Set(selected ?? []);
  return group.tags.filter((tag) => set.has(tag)).length;
}

// Groups open when the picker first shows: the ones holding a selection.
export function initiallyExpandedGroups(options, selected) {
  const set = new Set(selected ?? []);
  return buildTagGroups(options).filter((g) => g.tags.some((tag) => set.has(tag))).map((g) => g.key);
}

// A tag can be added unless a cap is reached; removing is always allowed. Single mode replaces.
export function canAddTag(selected, tag, { max = null, single = false } = {}) {
  const list = selected ?? [];
  if (list.includes(tag) || single) return true;
  return max == null || list.length < max;
}
