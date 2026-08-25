// "Business Story" plan (CLAUDE.md, Aug 25 2026), Phase 6 -- the honest
// version of the vision doc's "AI creates your first 4 for you" flow
// (points 150-151). This is deliberately NOT an LLM call and does not
// fabricate anything -- every suggestion is derived, one-for-one, from
// an attribute the owner has *already confirmed themselves* on their own
// profile (Phase 1's "Why People Choose Us" picker). A business with
// zero confirmed attributes gets zero suggestions -- an honest empty
// state, never a generic fallback.
//
// Same "pure function, no I/O, fully testable" shape as
// gatheringIndoorOutdoor.js / intentPatterns.js elsewhere in this app.

// One real, deterministic rule per attribute -- title/description/
// partyType are what that specific attribute honestly implies about who
// the experience is for. priceLevel is deliberately never set here --
// there is no real signal anywhere on this schema for what a business
// actually charges, so every suggestion leaves it unset for the owner to
// fill in themselves, matching this codebase's "never guess a number"
// convention.
const EXPERIENCE_RULES_BY_ATTRIBUTE = {
  date_friendly: {
    title: 'A Date Here',
    description: 'A relaxed spot for two.',
    icon: '❤️',
    partyType: 'date',
    // Priority order for capping suggestions -- date-friendly is the
    // single strongest "why people choose us" signal this vocabulary has.
    priority: 1,
  },
  group_friendly: {
    title: 'Friends Get-Together',
    description: 'Room for a group to hang out.',
    icon: '👥',
    partyType: 'groups',
    priority: 2,
  },
  outdoor_seating: {
    title: 'Outdoor Hangout',
    description: 'Fresh air and outdoor seating.',
    icon: '🌤️',
    partyType: null,
    priority: 3,
  },
  live_music: {
    title: 'Live Music Night',
    description: 'Come for the music.',
    icon: '🎵',
    partyType: 'groups',
    priority: 4,
  },
  kid_friendly: {
    title: 'Family Outing',
    description: 'A welcoming spot for kids too.',
    icon: '🧒',
    partyType: 'friends',
    priority: 5,
  },
  upscale: {
    title: 'A Special Occasion',
    description: 'A polished spot for something special.',
    icon: '🎩',
    partyType: null,
    priority: 6,
  },
  casual: {
    title: 'Casual Hangout',
    description: 'Easygoing, no pressure.',
    icon: '👕',
    partyType: 'friends',
    priority: 7,
  },
  quiet: {
    title: 'A Quiet Escape',
    description: 'A calmer, quieter atmosphere.',
    icon: '🤫',
    partyType: 'solo',
    priority: 8,
  },
};

const MAX_SUGGESTIONS = 4;

// Cuisine-flavoring: only for the two rules where naming the real
// cuisine genuinely reads better ("Italian Date Night" vs. the generic
// "A Date Here") -- and only when the business is genuinely food_drink
// with a real cuisine set. Never applied to attributes where a cuisine
// prefix would read oddly (e.g. "Italian Live Music Night").
const CUISINE_FLAVORED_ATTRIBUTES = new Set(['date_friendly', 'group_friendly']);

function cuisineFlavoredTitle(baseTitle, attribute, category, cuisineLabelText) {
  if (category !== 'food_drink' || !cuisineLabelText || !CUISINE_FLAVORED_ATTRIBUTES.has(attribute)) {
    return baseTitle;
  }
  if (attribute === 'date_friendly') return `${cuisineLabelText} Date Night`;
  if (attribute === 'group_friendly') return `${cuisineLabelText} Get-Together`;
  return baseTitle;
}

// { category, attributes, cuisine, cuisineLabel } -- cuisineLabel is the
// already-resolved display label (e.g. "Italian"), not the raw stored
// key, so this function never needs to know about the cuisine vocabulary
// itself.
export function deriveSignatureExperienceSuggestions({ category, attributes = [], cuisine, cuisineLabel } = {}) {
  const real = (attributes ?? []).filter((a) => EXPERIENCE_RULES_BY_ATTRIBUTE[a]);
  if (real.length === 0) return [];

  return real
    .map((attribute) => {
      const rule = EXPERIENCE_RULES_BY_ATTRIBUTE[attribute];
      return {
        attribute,
        title: cuisineFlavoredTitle(rule.title, attribute, category, cuisine ? cuisineLabel : null),
        description: rule.description,
        icon: rule.icon,
        attributes: [attribute],
        priceLevel: null,
        partyType: rule.partyType,
        priority: rule.priority,
      };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ priority, ...suggestion }) => suggestion);
}
