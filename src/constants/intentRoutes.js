// Canonical intent -> route table (owner decision 2026-09-21). Categories answer "what is this?"; an intent answers "what is
// the person trying to accomplish?", and each one is sent to an EXISTING Nearby surface, decided here and nowhere else.
// Deterministic and rule-based: phrases are matched against the person's own words, the AI never picks or invents a
// destination, and a route can only name a surface from ROUTE_SURFACES and tags/groups/recipes that really exist (a test
// checks each one). Order matters: the first matching intent wins, so specific intents sit above general ones.
// Shopping is deliberately not here (no product supply model; see the creep guard).
export const ROUTE_SURFACES = {
  PEOPLE: 'people', // Discover people mode (connections-only rules there still apply)
  RECIPE: 'recipe', // the assembled multi-part outing (CONTEXT_TEMPLATES key)
  CATEGORY_GROUPS: 'category_groups', // bias/limit the ranked results to these category groups (optionally one leaf tag)
  CREATE_GATHERING: 'create_gathering',
  BUSINESS_REQUEST: 'business_request', // the shared request model (AskBusiness)
  FIND_EVENTS: 'find_events', // Discover's gatherings list
};

const groups = (...g) => ({ surface: ROUTE_SURFACES.CATEGORY_GROUPS, groups: g });
const tagged = (tag, ...g) => ({ surface: ROUTE_SURFACES.CATEGORY_GROUPS, groups: g, category: tag });
const recipe = (key) => ({ surface: ROUTE_SURFACES.RECIPE, recipe: key });
const request = () => ({ surface: ROUTE_SURFACES.BUSINESS_REQUEST });

export const INTENT_ROUTES = [
  // Event (first: "create/host" must beat the social phrases inside the same sentence)
  { key: 'create_event', family: 'event', phrases: [/\b(create|host|organi[sz]e|start|plan|throw)\s+(an?\s+)?(\w+\s+){0,2}(event|gathering|meetup|meet-up)\b/i], route: { surface: ROUTE_SURFACES.CREATE_GATHERING } },
  { key: 'join_event', family: 'event', phrases: [/\bjoin\s+(an?\s+|the\s+)?(event|gathering|meetup|meet-up)\b/i], route: { surface: ROUTE_SURFACES.FIND_EVENTS } },
  { key: 'find_event', family: 'event', phrases: [/\b(find|see|browse|what'?s)\s+(an?\s+|any\s+)?(events?|gatherings?|meetups?|happening)\b/i, /\bevents?\s+(near|nearby|around)\b/i], route: { surface: ROUTE_SURFACES.FIND_EVENTS } },

  // Service (business request flow; never routed into clinical/health categories)
  { key: 'fix_something', family: 'service', phrases: [/\b(fix|repair)\b/i, /\b(plumber|electrician|handyman|hvac)\b/i], route: request() },
  { key: 'hire_someone', family: 'service', phrases: [/\b(hire|book)\s+(a\s+|an\s+|someone|somebody)/i, /\bneed\s+(a|an)\s+(cleaner|painter|mover|photographer|dj|caterer)\b/i], route: request() },
  { key: 'find_appointment', family: 'service', phrases: [/\b(find|get|book|make)\s+(me\s+)?(an?\s+)?appointment\b/i], route: request() },
  { key: 'get_something_done', family: 'service', phrases: [/\bget\s+(something|this|it|things)\s+done\b/i, /\bneed\s+(some\s+)?help\s+with\b/i], route: request() },

  // Social
  { key: 'meet_new_people', family: 'social', phrases: [/\bmeet\s+(new\s+|other\s+)?(people|someone|folks|friends)\b/i, /\bmake\s+(new\s+)?friends\b/i, /\bfind\s+(new\s+)?friends\b/i, /\bmeet\s+people\s+who\b/i], route: { surface: ROUTE_SURFACES.PEOPLE, subMode: 'friends' } },
  { key: 'meet_friends', family: 'social', phrases: [/\b(catch\s+up|meet\s+up|get\s+together)\s+with\s+(my\s+|some\s+)?friends\b/i, /\bsee\s+my\s+friends\b/i], route: recipe('friends_out') },
  { key: 'hang_out', family: 'social', phrases: [/\bhang\s?out\b/i, /\bchill\s+with\b/i], route: recipe('friends_out') },
  { key: 'group_activity', family: 'social', phrases: [/\bgroup\s+(activity|outing|thing)\b/i, /\bsomething\s+(for|with)\s+(a\s+|the\s+)?group\b/i], route: groups('activities_recreation', 'entertainment_nightlife', 'outdoors_nature') },
  { key: 'make_plans', family: 'social', phrases: [/\bmake\s+(some\s+)?plans\b/i, /\bplan\s+something\b/i], route: { surface: ROUTE_SURFACES.CREATE_GATHERING } },

  // Entertainment (specific tags before the general "go out")
  { key: 'see_live_music', family: 'entertainment', phrases: [/\blive\s+music\b/i, /\b(concert|gig)s?\b/i], route: tagged('Live Music', 'entertainment_nightlife') },
  { key: 'watch_movie', family: 'entertainment', phrases: [/\b(watch|see|catch)\s+(a\s+)?(movie|film)\b/i, /\bmovie\s+night\b/i], route: tagged('Movies', 'entertainment_nightlife') },
  { key: 'comedy', family: 'entertainment', phrases: [/\bcomedy\b/i, /\bstand-?up\b/i], route: tagged('Comedy', 'entertainment_nightlife') },
  { key: 'nightlife', family: 'entertainment', phrases: [/\bnightlife\b/i, /\bclub(bing)?\b/i], route: tagged('Nightlife', 'entertainment_nightlife') },
  { key: 'go_out_tonight', family: 'entertainment', phrases: [/\bgo\s+out\b/i, /\bout\s+tonight\b/i], route: groups('entertainment_nightlife', 'food_drink') },

  // Food
  { key: 'grab_coffee', family: 'food', phrases: [/\b(grab|get|have)\s+(a\s+)?coffee\b/i, /\bcoffee\b/i], route: tagged('Coffee', 'food_drink') },
  { key: 'find_dessert', family: 'food', phrases: [/\bdessert\b/i, /\bice\s+cream\b/i, /\bsweet\s+treat\b/i], route: tagged('Dessert & Ice Cream', 'food_drink') },
  { key: 'get_drinks', family: 'food', phrases: [/\b(get|grab|have)\s+(a\s+|some\s+)?drinks?\b/i, /\bhappy\s+hour\b/i], route: groups('food_drink') },
  { key: 'try_somewhere_new', family: 'food', phrases: [/\btry\s+(somewhere|someplace|something)\s+new\b/i], route: groups('food_drink') },
  { key: 'eat', family: 'food', phrases: [/\b(eat|dinner|lunch|brunch|hungry|food)\b/i], route: groups('food_drink') },

  // Activity
  { key: 'exercise', family: 'activity', phrases: [/\b(exercise|work\s?out|workout)\b/i], route: groups('activities_recreation') },
  { key: 'play_sports', family: 'activity', phrases: [/\bplay\s+(some\s+)?(sports?|basketball|soccer|volleyball|pickleball|tennis)\b/i], route: groups('activities_recreation') },
  { key: 'be_outdoors', family: 'activity', phrases: [/\b(be\s+outdoors|outside|outdoors|go\s+for\s+a\s+(hike|walk))\b/i], route: groups('outdoors_nature') },
  { key: 'learn_something', family: 'activity', phrases: [/\blearn\s+(something|how)\b/i, /\btake\s+a\s+class\b/i], route: groups('education_classes', 'arts_culture_learning') },
  { key: 'relax', family: 'activity', phrases: [/\b(relax|unwind|de-?stress)\b/i], route: groups('wellness_beauty', 'outdoors_nature') },
];

export const INTENT_KEYS = INTENT_ROUTES.map((i) => i.key);

// The first intent whose phrase appears in the person's own words, or null. Never consults the AI.
export function detectIntentRoute(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const hit = INTENT_ROUTES.find((i) => i.phrases.some((re) => re.test(rawText)));
  return hit ? { key: hit.key, family: hit.family, route: hit.route } : null;
}

// The recipe key a recognised intent names, else null.
export function intentRecipeFor(rawText) {
  const r = detectIntentRoute(rawText);
  return r?.route.surface === ROUTE_SURFACES.RECIPE ? r.route.recipe : null;
}

// Where a recognised intent sends the person when they are STARTING something (the create flow). Only the surfaces that
// differ from the default "create a gathering" are handled; the caller keeps its own behaviour for anything else.
// Returns true when it navigated.
export function navigateIntentRoute(navigation, routed, typedText) {
  if (!routed) return false;
  const { surface, subMode } = routed.route;
  if (surface === ROUTE_SURFACES.BUSINESS_REQUEST) {
    navigation.navigate('AskBusiness', { prefillText: typedText });
    return true;
  }
  if (surface === ROUTE_SURFACES.FIND_EVENTS) {
    navigation.navigate('Discover', { initialMode: 'things', initialTypeTab: 'gatherings' });
    return true;
  }
  if (surface === ROUTE_SURFACES.PEOPLE) {
    navigation.navigate('Discover', { initialMode: 'people', initialPeopleSubMode: subMode ?? 'friends' });
    return true;
  }
  return false;
}
