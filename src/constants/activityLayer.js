// Three questions, three layers (owner item 37, 2026-09-21) -- one business can satisfy many intents, so matching must not
// compare a person's intent to a business's category name:
//   1. BUSINESS CLASSIFICATION  "What are you?"                  category / subcategory / secondary tags (the taxonomy)
//   2. ACTIVITY                 "What can someone do here?"      THIS file: derived from what the business itself declared
//   3. INTENT                   "Why might someone want this?"   the person's own words (the ask), read by the same table
// The activity layer stores NOTHING new: an activity "fits" a business only through signals the business already declared
// (its own tags, attributes, offered occasions, party types), so a coffee shop that never said it is laptop-friendly does not
// claim "Work remotely". An ask names an activity only through a deterministic phrase rule on the person's own words (never
// AI). Ranking + one honest reason line; never a filter (a business that does not fit is not removed).
export const ACTIVITIES = [
  {
    key: 'grab_coffee', label: 'grabbing a coffee', icon: '☕', display: 'Grab coffee',
    ask: /\b(grab|get|have|want)\s+(a\s+|some\s+)?(coffee|latte|espresso|cappuccino)\b|\bcoffee\s+(run|break)\b/i,
    fits: (b) => b.tags.some((t) => ['Coffee', 'Bakeries'].includes(t)),
  },
  {
    key: 'work_remotely', label: 'working remotely', icon: '💻', display: 'Work remotely',
    ask: /\bwork(ing)?\s+(remotely|from\s+(a\s+)?(cafe|café|coffee|coffee\s+shop|home)|on\s+my\s+laptop)\b|\bremote\s+work\b|\bstudy\s+spot\b|\bplace\s+to\s+work\b/i,
    fits: (b) => b.tags.includes('Coworking') || (b.tags.some((t) => ['Coffee', 'Bakeries'].includes(t)) && b.attributes.some((a) => ['laptop_friendly', 'quiet'].includes(a))),
  },
  {
    key: 'first_date', label: 'a first date', icon: '💕', display: 'First date',
    ask: /\bfirst\s+date\b/i,
    fits: (b) => b.occasions.includes('first_date') || (b.attributes.includes('date_friendly') && b.attributes.includes('quiet')),
  },
  {
    key: 'meet_a_friend', label: 'meeting a friend', icon: '👥', display: 'Meet friends',
    ask: /\b(meet|meeting|see)\s+(up\s+with\s+)?(a\s+|my\s+)?(friends?|buddy|buddies|pals?)\b|\bcatch(ing)?\s+up\b/i,
    fits: (b) => b.tags.some((t) => ['Coffee', 'Brunch', 'Bars & Lounges', 'Restaurants', 'Dessert & Ice Cream', 'Bakeries'].includes(t)),
  },
  {
    key: 'quick_bite', label: 'a quick bite', icon: '🥪', display: 'Grab a quick bite',
    ask: /\bquick\s+(bite|lunch|snack|meal)\b|\bgrab\s+a\s+bite\b/i,
    fits: (b) => b.tags.some((t) => ['Fast Casual', 'Food Trucks', 'Bakeries', 'Takeout & Delivery'].includes(t)),
  },
  {
    key: 'breakfast', label: 'breakfast', icon: '🥐', display: 'Get breakfast',
    ask: /\b(breakfast|brunch)\b/i,
    fits: (b) => b.tags.some((t) => ['Breakfast', 'Brunch', 'Bakeries'].includes(t)),
  },
  {
    key: 'group_hangout', label: 'a group hangout', icon: '🎈', display: 'Hang out as a group',
    ask: /\b(group|crew|team)\s+(hangout|outing|get[- ]together|night)\b|\bhang\s*out\s+with\s+(a\s+)?group\b/i,
    fits: (b) => b.attributes.includes('group_friendly') || b.partyTypes.includes('groups'),
  },
  {
    key: 'casual_date', label: 'a casual date', icon: '❤️', display: 'Casual date',
    ask: /\bcasual\s+date\b/i,
    fits: (b) => b.attributes.includes('date_friendly') || b.occasions.some((o) => ['date_night', 'first_date'].includes(o)),
  },
  {
    key: 'bring_dog', label: 'bringing your dog', icon: '🐕', display: 'Bring your dog',
    ask: /\bdog[- ]friendly\b|\b(bring|with)\s+(my|the|our)\s+dog\b/i,
    fits: (b) => b.attributes.includes('dog_friendly') || b.attributes.includes('pet_friendly'),
  },
  {
    key: 'small_gathering', label: 'a small gathering', icon: '🎉', display: 'Small gathering',
    ask: /\bsmall\s+(gathering|get[- ]together|party)\b/i,
    fits: (b) => b.occasions.some((o) => ['celebration', 'birthday', 'casual_hangout', 'family_gathering'].includes(o)) || b.partyTypes.includes('groups'),
  },
];

import { BUSINESS_ATTRIBUTE_OPTIONS, OCCASION_OPTIONS, OFFERED_OCCASION_KEYS, ACCOMMODATE_PARTY_TYPE_OPTIONS } from './businessAttributes';

const asArray = (v) => (Array.isArray(v) ? v : []);

// The business's own declared signals, in one shape (a search row or a profile row both work).
export function businessSignals(row) {
  const tags = new Set([row?.subcategory, row?.category, ...asArray(row?.categories)].filter(Boolean));
  return { tags: [...tags], attributes: asArray(row?.attributes), occasions: asArray(row?.offered_occasions), partyTypes: asArray(row?.accommodates_party_types) };
}

// What a business can honestly be used for, from what it declared.
export function activitiesForBusiness(row) {
  const b = businessSignals(row);
  return ACTIVITIES.filter((a) => a.fits(b)).map((a) => a.key);
}

// What the person's own words ask to do. Empty when the words name none (most asks).
export function activitiesFromText(text) {
  const t = String(text ?? '');
  if (!t.trim()) return [];
  return ACTIVITIES.filter((a) => a.ask.test(t)).map((a) => a.key);
}

// "What you can do here" for a business profile: the fitting activities as icon + wording, in the order above. Empty when the
// business has declared nothing that supports one (the section then does not render).
export function thingsToDoHere(row) {
  const mine = new Set(activitiesForBusiness(row));
  return ACTIVITIES.filter((a) => mine.has(a.key)).map((a) => ({ key: a.key, icon: a.icon, label: a.display }));
}

// Owner-side preview: activities this business does NOT qualify for yet but would by declaring ONE more thing that already
// exists in the vocabulary (an attribute, a party type or an offered occasion). Derived by asking the same `fits` rule with the
// candidate added, so it can never drift from matching and can never offer an activity the business cannot really support.
// Tag-only activities (Grab coffee) have no such hint: only the business's real category qualifies it. Nothing is stored and
// nothing here lets an owner claim an activity directly.
const HINT_PREFER = { work_remotely: 'laptop_friendly', casual_date: 'date_friendly', group_hangout: 'group_friendly', bring_dog: 'dog_friendly', small_gathering: 'groups' };

export function activityHints(row) {
  if (!row) return [];
  const b = businessSignals(row);
  const candidates = [
    ...BUSINESS_ATTRIBUTE_OPTIONS.map((o) => ({ kind: 'attribute', key: o.key, label: o.label, next: { ...b, attributes: [...b.attributes, o.key] } })),
    ...ACCOMMODATE_PARTY_TYPE_OPTIONS.map((o) => ({ kind: 'partyType', key: o.key, label: o.label, next: { ...b, partyTypes: [...b.partyTypes, o.key] } })),
    ...OCCASION_OPTIONS.filter((o) => OFFERED_OCCASION_KEYS.includes(o.key)).map((o) => ({ kind: 'occasion', key: o.key, label: o.label, next: { ...b, occasions: [...b.occasions, o.key] } })),
  ];
  const hints = [];
  for (const a of ACTIVITIES) {
    if (a.fits(b)) continue;
    const flips = candidates.filter((c) => a.fits(c.next));
    if (flips.length === 0) continue;
    const add = flips.find((c) => c.key === HINT_PREFER[a.key]) ?? flips[0];
    hints.push({ key: a.key, icon: a.icon, display: a.display, add: { kind: add.kind, key: add.key, label: add.label } });
  }
  return hints;
}

// Onboarding checklist "What can customers do here?" (owner item 53). The checklist is a convenient way to DECLARE what the business
// already has a place for, never a second store: an activity is checked only when its own `fits` rule passes on what the business has
// declared, and ticking one adds exactly the attribute(s) or secondary tag that make it fit (the same search activityHints uses).
// An activity the business TYPE already covers (Grab coffee for a coffee shop) shows checked and locked. One that could only come from
// a party type or an offered occasion (not writable on the application) is not offered, so nothing here can claim what it cannot save.
const ATTR_KEYS = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
const sig = (row, attributes, categories) => businessSignals({ ...row, attributes, categories });

// { attributes: [...], categories: [...] } that, added to the row, make the activity fit; null when no such addition exists.
function additionsThatMakeFit(activity, row, tagOptions) {
  const attrs = asArray(row?.attributes);
  const cats = asArray(row?.categories);
  const fitsWith = (addAttrs, addCats) => activity.fits(sig(row, [...attrs, ...addAttrs], [...cats, ...addCats]));
  const singles = ATTR_KEYS.filter((k) => !attrs.includes(k) && fitsWith([k], []));
  if (singles.length > 0) return { attributes: [singles.find((k) => k === HINT_PREFER[activity.key]) ?? singles[0]], categories: [] };
  const tags = asArray(tagOptions).filter((t) => t && !cats.includes(t) && t !== row?.subcategory && t !== row?.category);
  const tag = tags.find((t) => fitsWith([], [t]));
  if (tag) return { attributes: [], categories: [tag] };
  for (const x of ATTR_KEYS) {
    if (attrs.includes(x)) continue;
    for (const y of ATTR_KEYS) {
      if (y <= x || attrs.includes(y)) continue;
      if (fitsWith([x, y], [])) return { attributes: [x, y], categories: [] };
    }
  }
  return null;
}

// `tagOptions` = the leaf tags of the chosen major (the same list the "Anything else you are?" row offers).
export function activityChoices(row, tagOptions = []) {
  const b = businessSignals(row);
  const typeOnly = { ...b, attributes: [], tags: [row?.subcategory, row?.category].filter(Boolean) };
  return ACTIVITIES.map((a) => {
    const checked = a.fits(b);
    return { key: a.key, icon: a.icon, display: a.display, checked, locked: checked && a.fits(typeOnly), add: checked ? null : additionsThatMakeFit(a, row, tagOptions) };
  }).filter((c) => c.checked || c.add);
}

// The { attributes, categories } after ticking / unticking one activity. Unticking removes only what was carrying it; a locked
// (type-covered) activity cannot be unticked and returns the row's lists unchanged.
export function toggleActivity(row, activityKey, tagOptions = []) {
  const attrs = asArray(row?.attributes);
  const cats = asArray(row?.categories);
  const unchanged = { attributes: attrs, categories: cats };
  const a = ACTIVITIES.find((x) => x.key === activityKey);
  if (!a) return unchanged;
  const fits = (A, C) => a.fits(sig(row, A, C));
  if (!fits(attrs, cats)) {
    const add = additionsThatMakeFit(a, row, tagOptions);
    return add ? { attributes: [...attrs, ...add.attributes], categories: [...cats, ...add.categories] } : unchanged;
  }
  if (a.fits({ ...businessSignals(row), attributes: [], tags: [row?.subcategory, row?.category].filter(Boolean) })) return unchanged;
  const needA = attrs.filter((k) => !fits(attrs.filter((x) => x !== k), cats));
  const needC = cats.filter((t) => !fits(attrs, cats.filter((x) => x !== t)));
  if (needA.length + needC.length > 0) return { attributes: attrs.filter((k) => !needA.includes(k)), categories: cats.filter((t) => !needC.includes(t)) };
  // several declared things each carry it: remove all the ones that would carry it alone
  const sufA = attrs.filter((k) => fits([k], []));
  const sufC = cats.filter((t) => fits([], [t]));
  return { attributes: attrs.filter((k) => !sufA.includes(k)), categories: cats.filter((t) => !sufC.includes(t)) };
}

// The first asked activity this business fits, else null (drives one ranking nudge and one reason line).
export function activityFit(row, askedActivities) {
  const asked = asArray(askedActivities);
  if (asked.length === 0) return null;
  const mine = new Set(activitiesForBusiness(row));
  const hit = ACTIVITIES.find((a) => asked.includes(a.key) && mine.has(a.key));
  return hit ? { key: hit.key, reason: `Good for ${hit.label}` } : null;
}
