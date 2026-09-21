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
    fits: (b) => b.attributes.includes('dog_friendly'),
  },
  {
    key: 'small_gathering', label: 'a small gathering', icon: '🎉', display: 'Small gathering',
    ask: /\bsmall\s+(gathering|get[- ]together|party)\b/i,
    fits: (b) => b.occasions.some((o) => ['celebration', 'birthday', 'casual_hangout', 'family_gathering'].includes(o)) || b.partyTypes.includes('groups'),
  },
];

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

// The first asked activity this business fits, else null (drives one ranking nudge and one reason line).
export function activityFit(row, askedActivities) {
  const asked = asArray(askedActivities);
  if (asked.length === 0) return null;
  const mine = new Set(activitiesForBusiness(row));
  const hit = ACTIVITIES.find((a) => asked.includes(a.key) && mine.has(a.key));
  return hit ? { key: hit.key, reason: `Good for ${hit.label}` } : null;
}
