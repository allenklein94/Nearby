// Category tags live in ONE place: public.category_tag_groups (migration 20270160). The tags in gatheringCategories.js are
// only the built-in baseline; a tag an admin adds later arrives here and is merged IN PLACE into the same arrays every
// picker, ranking helper and mapping already reads (CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS), so a
// new tag is searchable/matchable everywhere with no per-feature list. Groups (majors) are never created here.
import { CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS } from './gatheringCategories';

export function registerCategoryTag(tag, groupKey, businessOnly = false) {
  if (typeof tag !== 'string' || !tag) return false;
  const group = CATEGORY_GROUPS.find((g) => g.key === groupKey);
  if (!group) return false;
  if (CATEGORY_GROUPS.some((g) => g.tags.includes(tag) || (g.businessOnlyTags ?? []).includes(tag))) return false;
  if (businessOnly) {
    // Business-only (migration 20270180): kept OUT of every consumer list on purpose.
    (group.businessOnlyTags ??= []).push(tag);
    return true;
  }
  group.tags.push(tag);
  INTEREST_OPTIONS.push(tag);
  if (tag !== 'Dating') PERSONAL_INTEREST_OPTIONS.push(tag);
  return true;
}

// rows: [{ tag, group_key }] from category_tag_groups. Returns how many were new to this device.
export function applyRemoteCategoryTags(rows) {
  let added = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (registerCategoryTag(r?.tag, r?.group_key, r?.business_only === true)) added += 1;
  }
  return added;
}

// Taxonomy changes (migration 20270232: stable IDs + versioned history). The server's snapshot is the authority for
// renames, moves and retirements; the built-in baseline above only ever ADDS. Applied in place, like new tags:
//   - a former name leaves every picker list, and LEGACY_TAG_NAMES maps it to the current name (old drafts, old rows);
//   - a moved tag leaves its old group and joins the new one;
//   - a retired tag leaves every picker list (nobody can newly choose it) but still resolves: to its replacement when
//     it was merged, else to itself, so stored data keeps its meaning.
// Nothing is removed on a MISSING signal (a partial or failed read never shrinks the list).
export const TAG_KEYS = new Map(); // tag name -> its permanent key (category_tag_groups.key, item 97), from the synced taxonomy
export const LEGACY_TAG_NAMES = new Map(); // lower(former name, or name merged away) -> the name it points to now
export const RETIRED_TAGS = new Set();

function removeEverywhere(tag) {
  for (const g of CATEGORY_GROUPS) {
    const i = g.tags.indexOf(tag);
    if (i >= 0) g.tags.splice(i, 1);
    const j = (g.businessOnlyTags ?? []).indexOf(tag);
    if (j >= 0) g.businessOnlyTags.splice(j, 1);
  }
  for (const list of [INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS]) {
    const k = list.indexOf(tag);
    if (k >= 0) list.splice(k, 1);
  }
}

function currentPlacement(tag) {
  for (const g of CATEGORY_GROUPS) {
    if (g.tags.includes(tag)) return { group: g.key, businessOnly: false };
    if ((g.businessOnlyTags ?? []).includes(tag)) return { group: g.key, businessOnly: true };
  }
  return null;
}

// snapshot = get_category_taxonomy(): { version, tags: [{ id, tag, group_key, business_only, retired, replaced_by }],
// former_names: [{ name, current_tag, retired }] }. Returns the number of changes applied to this device.
export function applyTaxonomySnapshot(snapshot) {
  const tags = Array.isArray(snapshot?.tags) ? snapshot.tags : [];
  const former = Array.isArray(snapshot?.former_names) ? snapshot.former_names : [];
  let changes = 0;
  for (const f of former) {
    if (typeof f?.name !== 'string' || !f.name) continue;
    if (typeof f.current_tag === 'string' && f.current_tag) LEGACY_TAG_NAMES.set(f.name.toLowerCase(), f.current_tag);
    if (currentPlacement(f.name) && !tags.some((t) => t?.tag === f.name)) { removeEverywhere(f.name); changes += 1; }
  }
  for (const t of tags) {
    if (typeof t?.tag !== 'string' || !t.tag) continue;
    if (typeof t.key === 'string' && t.key) TAG_KEYS.set(t.tag, t.key);
    if (t.retired) {
      RETIRED_TAGS.add(t.tag);
      if (t.replaced_by) LEGACY_TAG_NAMES.set(t.tag.toLowerCase(), t.replaced_by);
      if (currentPlacement(t.tag)) { removeEverywhere(t.tag); changes += 1; }
      continue;
    }
    RETIRED_TAGS.delete(t.tag);
    const place = currentPlacement(t.tag);
    const businessOnly = t.business_only === true;
    if (place && (place.group !== t.group_key || place.businessOnly !== businessOnly)) {
      if (!CATEGORY_GROUPS.some((g) => g.key === t.group_key)) continue; // never invent a group
      removeEverywhere(t.tag);
      changes += 1;
    }
    if (registerCategoryTag(t.tag, t.group_key, businessOnly) && !place) changes += 1;
  }
  return changes;
}

// The name to use NOW for any stored or typed tag name: follows renames and merges (bounded); unknown names pass
// through. A retired tag with no replacement resolves to itself (stored data keeps its meaning; pickers no longer offer it).
export function currentTagName(name) {
  if (typeof name !== 'string' || !name) return name;
  let cur = name;
  for (let i = 0; i < 10; i += 1) {
    if (currentPlacement(cur) && !RETIRED_TAGS.has(cur)) return cur;
    const next = LEGACY_TAG_NAMES.get(cur.toLowerCase());
    if (typeof next !== 'string' || !next || next === cur) return cur;
    cur = next;
  }
  return cur;
}
