import { INTENT_ROUTES, INTENT_KEYS, ROUTE_SURFACES, detectIntentRoute, intentRecipeFor, navigateIntentRoute } from './intentRoutes';
import { CATEGORY_GROUPS, INTEREST_OPTIONS } from './gatheringCategories';
import { CONTEXT_TEMPLATES, experienceContextKey } from './experienceTemplates';
import { openEndedAskGroups } from '../utils/openEndedAsk';

const SAMPLES = {
  create_event: 'I want to host an event', join_event: 'join a meetup', find_event: 'find events near me',
  fix_something: 'fix my sink', hire_someone: 'hire a photographer', find_appointment: 'find an appointment', get_something_done: 'get something done',
  meet_new_people: 'meet new people', meet_friends: 'catch up with my friends', hang_out: 'hang out', group_activity: 'a group activity', make_plans: 'make plans',
  see_live_music: 'see live music', watch_movie: 'watch a movie', comedy: 'some comedy', nightlife: 'nightlife', go_out_tonight: 'go out',
  grab_coffee: 'grab coffee', find_dessert: 'find dessert', get_drinks: 'get drinks', try_somewhere_new: 'try somewhere new', eat: 'I am hungry',
  exercise: 'exercise', play_sports: 'play basketball', be_outdoors: 'be outdoors', learn_something: 'learn something', relax: 'relax',
};

describe('canonical intent routes', () => {
  it('covers exactly the supported intents, once each, and no Shopping', () => {
    expect(new Set(INTENT_KEYS).size).toBe(INTENT_KEYS.length);
    expect(INTENT_KEYS.sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(INTENT_ROUTES.some((i) => i.family === 'shopping')).toBe(false);
  });
  it('every intent routes to an existing surface with real groups, tags and recipes', () => {
    const groupKeys = CATEGORY_GROUPS.map((g) => g.key);
    for (const i of INTENT_ROUTES) {
      expect(Object.values(ROUTE_SURFACES)).toContain(i.route.surface);
      (i.route.groups ?? []).forEach((g) => expect(groupKeys).toContain(g));
      if (i.route.category) expect(INTEREST_OPTIONS).toContain(i.route.category);
      if (i.route.recipe) expect(CONTEXT_TEMPLATES[i.route.recipe]).toBeTruthy();
      expect(i.phrases.length).toBeGreaterThan(0);
    }
  });
  it('each supported intent is recognised from its own words and lands on its intended surface', () => {
    for (const [key, text] of Object.entries(SAMPLES)) {
      const hit = detectIntentRoute(text);
      expect(`${text} -> ${hit?.key}`).toBe(`${text} -> ${key}`);
    }
    expect(detectIntentRoute('fix my sink').route.surface).toBe('business_request');
    expect(detectIntentRoute('meet new people').route.surface).toBe('people');
    expect(detectIntentRoute('find events near me').route.surface).toBe('find_events');
    expect(detectIntentRoute('host an event').route.surface).toBe('create_gathering');
    expect(detectIntentRoute('hang out').route.recipe).toBe('friends_out');
    expect(detectIntentRoute('get drinks').route.groups).toEqual(['food_drink']);
  });
  it('specific intents beat general ones and unknown text routes nowhere', () => {
    expect(detectIntentRoute('host a coffee meetup').key).toBe('create_event');
    expect(detectIntentRoute('see live music tonight').key).toBe('see_live_music');
    expect(detectIntentRoute('buy a gift')).toBeNull();
    expect(detectIntentRoute('')).toBeNull();
    expect(detectIntentRoute(null)).toBeNull();
  });
  it('a recipe intent feeds the assembled night; a group intent limits an uncategorised ask', () => {
    expect(intentRecipeFor('hang out')).toBe('friends_out');
    expect(intentRecipeFor('get drinks')).toBeNull();
    expect(experienceContextKey({ dateWindow: 'tonight', intentRecipe: 'friends_out', partyType: 'date' })).toBe('friends_out');
    expect(experienceContextKey({ dateWindow: null, intentRecipe: 'friends_out' })).toBeNull();
    expect(openEndedAskGroups({ rawText: 'get drinks' })).toEqual(['food_drink']);
    expect(openEndedAskGroups({ rawText: 'get drinks', category: 'Wine' })).toBeNull();
    expect(openEndedAskGroups({ rawText: 'grab coffee' })).toBeNull(); // tagged: the extractor owns the category
  });
  it('navigation only handles the surfaces that differ from the default and never invents a destination', () => {
    const nav = { navigate: jest.fn() };
    expect(navigateIntentRoute(nav, detectIntentRoute('fix my sink'), 'fix my sink')).toBe(true);
    expect(nav.navigate).toHaveBeenLastCalledWith('AskBusiness', { prefillText: 'fix my sink' });
    expect(navigateIntentRoute(nav, detectIntentRoute('find events near me'), 'x')).toBe(true);
    expect(nav.navigate).toHaveBeenLastCalledWith('Discover', { initialMode: 'things', initialTypeTab: 'gatherings' });
    expect(navigateIntentRoute(nav, detectIntentRoute('meet new people'), 'x')).toBe(true);
    expect(nav.navigate).toHaveBeenLastCalledWith('Discover', { initialMode: 'people', initialPeopleSubMode: 'friends' });
    nav.navigate.mockClear();
    expect(navigateIntentRoute(nav, detectIntentRoute('host an event'), 'x')).toBe(false);
    expect(navigateIntentRoute(nav, detectIntentRoute('get drinks'), 'x')).toBe(false);
    expect(navigateIntentRoute(nav, null, 'x')).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});
