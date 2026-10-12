// Owner item 86 (2026-10-12): a pure people ask opens People mode (Dating/Friends from the words, else the person's own default;
// tonight only when the resolver read "tonight"). Played on the real deterministic resolver (production while AI is down).
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../services/supabase', () => ({ supabase: {} }));

import { resolveAsk, toClassification } from './askResolver';
import { peopleAsk, peopleAskSubMode, peopleModeParams, peopleAskUnderstood, PEOPLE_PURPOSE_TAGS } from './peopleAsk';
import { understoodPieces } from './askUnderstood';
import { intentResultDestination, PEOPLE_FRIENDS } from './recommendationContext';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ask = (text) => peopleAsk(toClassification(resolveAsk(text, null)), text);

describe('which asks are pure people asks', () => {
  it.each([
    'I want to meet someone tonight',
    'I want to meet someone',
    'meet someone now',
    'I want to meet new people',
    'help me make new friends nearby',
    'meet someone for a date tonight',
  ])('"%s" is a people ask', (text) => {
    expect(ask(text)).not.toBeNull();
  });

  it.each([
    'meet people who like tennis', // an activity: keeps its results + the meet-people row
    'looking to find friends who like hiking',
    'meet new people at a bar tonight',
    'dinner tonight for two', // no person-shaped phrase
    'something fun tonight',
    'go on a date tonight', // a date plan, not "meet": the phrase check is unchanged
    '',
  ])('"%s" is not', (text) => {
    expect(ask(text)).toBeNull();
  });

  it('a community or business-partner ask never becomes People mode', () => {
    expect(peopleAsk({ intent: 'community', category: null }, 'meet new people')).toBeNull();
    expect(peopleAsk({ intent: 'business_partner', category: null }, 'meet new people')).toBeNull();
  });

  it('a category that only restates the people purpose is not an activity; any other category or group is', () => {
    expect(Object.keys(PEOPLE_PURPOSE_TAGS)).toEqual(['Make New Friends', 'Dating']);
    expect(peopleAsk({ intent: 'gathering', category: 'Make New Friends' }, 'make new friends')).not.toBeNull();
    expect(peopleAsk({ intent: 'gathering', category: 'Tennis' }, 'meet people')).toBeNull();
    expect(peopleAsk({ intent: 'unclear', category: null, narrowGroup: 'sports' }, 'meet people')).toBeNull();
  });
});

describe('Dating or Friends', () => {
  it('Friends from friend words, Dating from date words', () => {
    expect(ask('help me make new friends nearby').subMode).toBe('friends');
    expect(ask('I want to find new friends tonight').subMode).toBe('friends');
    expect(ask('meet someone for a date tonight').subMode).toBe('dating');
    expect(peopleAskSubMode('I want to meet someone for date night', null)).toBe('dating');
    expect(ask('I want to meet someone for date night')).toBeNull(); // Date Night is a plan the resolver read: results stay
  });

  it('neither stated = null, so Discover keeps the person\'s existing default (as the Home card)', () => {
    expect(ask('I want to meet someone tonight').subMode).toBeNull();
    expect(ask('I want to meet new people').subMode).toBeNull();
    expect(peopleModeParams({ subMode: null, tonight: false })).toEqual({ initialMode: 'people' });
  });

  it('both stated = null (never guess)', () => {
    expect(peopleAskSubMode('meet new friends or maybe a date', null)).toBeNull();
  });
});

describe('tonight context', () => {
  it('"tonight" carries the existing meet-tonight context (banner + tonight-first order)', () => {
    const p = ask('I want to meet someone tonight');
    expect(p).toEqual({ subMode: null, tonight: true });
    expect(peopleModeParams(p)).toEqual({ initialMode: 'people', context: 'meet_tonight' });
  });

  it('"now" and no time open People plainly: no second time reading, no banner', () => {
    expect(ask('meet someone now')).toEqual({ subMode: null, tonight: false });
    expect(ask('I want to meet someone')).toEqual({ subMode: null, tonight: false });
    expect(peopleModeParams(ask('meet someone now'))).toEqual({ initialMode: 'people' });
  });

  it('the params are the same ones the Home "meet someone tonight" card sends', () => {
    expect(read('utils/meetTonight.js')).toMatch(/params: \{ initialMode: 'people', initialPeopleSubMode: subMode, context: 'meet_tonight' \}/);
    expect(peopleModeParams({ subMode: 'friends', tonight: true })).toEqual({ initialMode: 'people', initialPeopleSubMode: 'friends', context: 'meet_tonight' });
  });
});

describe('wiring (one helper, no second screen)', () => {
  it('the meet-people row opens People -> Friends in place from Home and Discover (tabs); stack screens keep the presentation', () => {
    expect(peopleModeParams({ subMode: 'friends' })).toEqual(PEOPLE_FRIENDS);
    expect(read('screens/HomeScreen.js')).toMatch(/item\.type === 'friend_discovery'\) \{\n\s*navigation\.navigate\('Discover', peopleModeParams\(\{ subMode: 'friends' \}\)\);\n\s*return;/);
    // the shared destination (Celebrate and other stack screens) stays the FriendDiscovery presentation of People -> Friends
    expect(intentResultDestination({ type: 'friend_discovery' })).toEqual({ kind: 'navigate', screen: 'FriendDiscovery', params: undefined });
  });

  it('Home and Discover both decide through peopleAsk, and no search runs for a people ask', () => {
    const resolver = read('services/intentResolver.js');
    expect(resolver).toMatch(/const people = peopleAsk\(classifyResult, typedText\);\n  if \(people\) \{[\s\S]*?return \{ outcome: 'people', people,/);
    expect(resolver.indexOf("outcome: 'people'")).toBeLessThan(resolver.indexOf('await resolveClassifiedAsk(classifyResult, typedText)'));
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/else if \(peopleAsk\(result, typedText\)\) \{[\s\S]*?navigation\.navigate\('Discover', peopleModeParams\(\{ \.\.\.peopleAsk\(result, typedText\), understood: peopleAskUnderstood\(result, typedText\) \}\)\);/);
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/result\.outcome === 'people'\) \{\n\s*setIntentSearch\(null\);\n\s*enterPeopleFromAsk\(result\.people, peopleAskUnderstood\(result\.classifyResult, typedText\)\);/);
    expect(discover).toMatch(/item\.type === 'friend_discovery'\) \{\n\s*enterPeopleFromAsk\(\{ subMode: 'friends', tonight: false \}\);/);
  });

  it('Discover switches in place without persisting the mode or counting a sub-mode use, and Back returns to the ask', () => {
    const discover = read('screens/DiscoverHubScreen.js');
    const fn = discover.slice(discover.indexOf('function enterPeopleFromAsk'), discover.indexOf('function enterPeopleFromAsk') + 600);
    expect(fn).not.toMatch(/AsyncStorage|recordPeopleSubModeUse|selectPeopleSubMode|navigation\./);
    expect(discover).toMatch(/meetTonightContext = route\.params\?\.context === 'meet_tonight' \|\| peopleFromAsk\?\.tonight === true/);
    expect(discover).toMatch(/if \(!peopleFromAsk\?\.inPlace \|\| mode !== 'people'\) return undefined;\n\s*const sub = BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\n\s*setMode\('things'\);/);
  });
});

// Owner item 86 follow-up (2026-10-12): People opened by an ask shows item 45's understood chips of what the ask said, only
// what the words gave; a generic ask shows nothing (no fabricated cue, no empty banner).
describe('what Nearby understood, above People', () => {
  const understoodFor = (text) => peopleAskUnderstood(toClassification(resolveAsk(text, null)), text);
  const piecesFor = (text) => { const u = understoodFor(text); return u ? understoodPieces(u.classifyResult, u.typedText) : []; };

  it('a people ask with understood pieces carries them (the same pieces the search showed)', () => {
    expect(piecesFor('I want to meet someone tonight')).toEqual([{ key: 'when', window: 'tonight' }]);
    expect(piecesFor('meet someone outside tonight')).toEqual([{ key: 'when', window: 'tonight' }, { key: 'where', environment: 'outdoor' }]);
    expect(piecesFor('meet someone now')).toEqual([{ key: 'when', window: 'now' }]); // "Now" as said; still no tonight banner
    for (const t of ['I want to meet someone tonight', 'meet someone outside tonight', 'help me make new friends nearby']) {
      const c = toClassification(resolveAsk(t, null));
      expect(piecesFor(t)).toEqual(understoodPieces(c, t));
    }
  });

  it('"Tonight" never appears unless the ask said it', () => {
    expect(piecesFor('I want to meet new people')).toEqual([{ key: 'who', party: 'new_people' }]);
    expect(piecesFor('I want to meet new people').some((p) => p.key === 'when')).toBe(false);
  });

  it('a generic people ask has no chips: nothing travels and nothing renders', () => {
    expect(understoodFor('I want to meet someone')).toBeNull();
    const params = peopleModeParams({ ...ask('I want to meet someone'), understood: understoodFor('I want to meet someone') });
    expect(params).toEqual({ initialMode: 'people' });
  });

  it('only the fields the chip rule reads travel with the navigation (no raw classification, no ids)', () => {
    const u = understoodFor('I want to meet someone tonight');
    expect(Object.keys(u.classifyResult).sort()).toEqual(['category', 'dateWindow', 'intent', 'narrowGroup', 'partyType', 'structured']);
    expect(u.classifyResult.structured).toEqual({ facets: { environment: null } }); // the resolver's environment reading only
    expect(peopleModeParams({ ...ask('I want to meet someone tonight'), understood: u }))
      .toEqual({ initialMode: 'people', context: 'meet_tonight', understood: u });
  });

  it('Discover renders the existing AskUnderstoodChips above People only for an ask; mode inference and eligibility untouched', () => {
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/\{peopleFromAsk\?\.understood \? \(\n\s*<AskUnderstoodChips classifyResult=\{peopleFromAsk\.understood\.classifyResult\} typedText=\{peopleFromAsk\.understood\.typedText\} \/>\n\s*\) : null\}\n\s*\{meetBanner && \(/);
    // Home's ask arrives as a param and is NOT in place: tab Back is unchanged; a Discover-typed ask is in place (Back -> Things)
    expect(discover).toMatch(/setPeopleFromAsk\(p\.understood \? \{ tonight: false, understood: p\.understood, inPlace: false \} : null\);/);
    expect(discover).toMatch(/setPeopleFromAsk\(\{ tonight: people\?\.tonight === true, understood, inPlace: true \}\);/);
    // leaving People (the Things toggle) drops the chips with the rest of the ask's People context
    expect(discover).toMatch(/setMode\(key\);\n\s*if \(key !== 'people'\) setPeopleFromAsk\(null\);/);
  });
});
