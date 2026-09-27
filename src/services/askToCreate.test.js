// Item 109: a typed ask carries into Create (Home -> Discover -> Create). The words' what/when/who prefill Create, a Who chip
// picked after the search wins, "Create it yourself" always lands on Create, and Discover creates from the ask it already
// understood (no second AI read). No AI here: the deterministic resolver (the path used without Anthropic credit).
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('./supabase', () => ({ supabase: {} }));

import { routeClassifiedIntentToCreation } from './createAssistant';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { applyRefinement } from '../utils/askRefinements';
import { titleFromText } from '../utils/gatheringInference';

const nav = () => ({ navigate: jest.fn() });
const ask = (t) => toClassification(resolveAsk(t, null));

describe('the ask prefills Create', () => {
  it('"I want to play pickleball tonight" -> Pickleball, Tonight, titled Pickleball', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, ask('I want to play pickleball tonight'), 'I want to play pickleball tonight', { explicitCreate: true });
    const [screen, params] = n.navigate.mock.calls[0];
    expect(screen).toBe('CreateGathering');
    expect(params).toMatchObject({ quickStartCategory: 'Pickleball', quickStartWhenPreset: 'tonight', quickStartTitle: 'Pickleball', inferredFromText: true });
    expect(params.inferredSummary.map((x) => x.value)).toEqual(expect.arrayContaining(['Pickleball', 'Tonight']));
  });

  it('a Who chip picked after the search carries in (and taking it off removes it)', () => {
    const text = 'pickleball tonight with friends';
    const first = ask(text);
    const solo = applyRefinement(first, 'solo');
    let n = nav();
    routeClassifiedIntentToCreation(n, solo, text, { explicitCreate: true });
    expect(n.navigate.mock.calls[0][1].quickStartPartyType).toBe('solo');
    const off = applyRefinement(first, 'friends'); // the words said friends; the chip turned it off
    n = nav();
    routeClassifiedIntentToCreation(n, off, text, { explicitCreate: true });
    expect(n.navigate.mock.calls[0][1].quickStartPartyType).toBeNull();
    expect(n.navigate.mock.calls[0][1].inferredSummary.find((x) => x.layer === 'group')).toBeUndefined();
  });

  it('time is still only what the words said (never invented)', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, ask('I want to play pickleball'), 'I want to play pickleball', { explicitCreate: true });
    expect(n.navigate.mock.calls[0][1]).not.toHaveProperty('quickStartWhenPreset');
  });
});

describe('"Create it yourself" always lands on Create', () => {
  it.each(['find events near me tonight', 'meet new people at trivia tonight', 'book a table for 4 tonight'])('%s: explicit create is not redirected; the plain route still is', (t) => {
    const routed = nav();
    routeClassifiedIntentToCreation(routed, ask(t), t);
    const explicit = nav();
    routeClassifiedIntentToCreation(explicit, ask(t), t, { explicitCreate: true });
    expect(explicit.navigate.mock.calls[0][0]).toBe('CreateGathering');
    expect(routed.navigate.mock.calls[0][0]).not.toBe('CreateGathering'); // proves the redirect exists without the flag
  });
  it('a named community or business proposal keeps its own screen', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, { intent: 'business_partner', businessName: 'Coastal Coffee' }, 'partner with Coastal Coffee', { explicitCreate: true });
    expect(n.navigate.mock.calls[0][0]).toBe('RequestBusinessPartner');
  });
});

describe('titles drop the lead-in, nothing else', () => {
  it.each([
    ['I want to play pickleball tonight', 'Pickleball'],
    ["I'd like to go bowling tomorrow", 'Bowling'],
    ["Let's grab coffee tonight", 'Coffee'],
    ['I wanna go hiking this weekend', 'Hiking'],
    ['Coffee tonight with some friends', 'Coffee with some friends'],
    ['Play pickleball tonight', 'Play pickleball'],
  ])('%s -> %s', (t, title) => expect(titleFromText(t)).toBe(title));
});

describe('wiring', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  it('Home and Discover create explicitly, and Discover reuses its understood ask', () => {
    const home = read('../screens/HomeScreen.js');
    expect(home.match(/\{ explicitCreate: true \}\)\}/g)).toHaveLength(2);
    const d = read('../screens/DiscoverHubScreen.js');
    expect(d).toMatch(/routeClassifiedIntentToCreation\(navigation, intentSearch\.classifyResult, .*\{ explicitCreate: true \}\)/);
    expect(d).toMatch(/None of these\? Create it yourself/);
    const fn = d.slice(d.indexOf('function createFromAsk'), d.indexOf('async function handleCreateItFromSearch'));
    expect(fn).not.toMatch(/classifyCreateRequest/);
  });
});
