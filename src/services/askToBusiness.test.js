// Item 110: "Ask a business" after a typed ask starts the request with what was already said (Home and Discover, one
// implementation). Deterministic resolver (the no-AI path); the AskBusiness screen by source guards (no device run).
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));

import { askBusinessFromAsk, askBusinessParamsFromAsk } from './askToBusiness';
import { recordIntentSelection } from './intentOutcomes';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { applyRefinement } from '../utils/askRefinements';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const ask = (t, sid = 'sub-1') => ({ classifyResult: toClassification(resolveAsk(t, null)), typedText: t, submissionId: sid });

describe('the request starts with what was said', () => {
  it('"Coffee for four tonight" -> Coffee, 4 people, Tonight', () => {
    expect(askBusinessParamsFromAsk(ask('Coffee for four tonight'))).toMatchObject({
      prefillText: 'Coffee for four tonight', prefillCategory: 'Coffee', prefillPartySize: 4, prefillDateWindow: 'tonight', prefillSubmissionId: 'sub-1',
    });
  });
  it('nothing unsaid is filled: no count, no day', () => {
    expect(askBusinessParamsFromAsk(ask('coffee'))).toMatchObject({ prefillCategory: 'Coffee', prefillPartySize: null, prefillDateWindow: null, prefillBudgetMax: null });
  });
  it('the ask as it stands: a chip picked after the search carries too', () => {
    const a = ask('dinner for six tomorrow');
    const params = askBusinessParamsFromAsk({ ...a, classifyResult: applyRefinement(a.classifyResult, 'under_25') });
    expect(params).toMatchObject({ prefillCategory: 'Restaurants', prefillPartySize: 6, prefillDateWindow: 'tomorrow', prefillBudgetMax: 25 });
  });
  it('opens the request form (nothing sent) and records the choice like before', () => {
    const navigation = { navigate: jest.fn() };
    askBusinessFromAsk(navigation, ask('Coffee for four tonight'));
    expect(navigation.navigate).toHaveBeenCalledWith('AskBusiness', expect.objectContaining({ prefillCategory: 'Coffee', prefillPartySize: 4 }));
    expect(recordIntentSelection).toHaveBeenCalledWith(expect.objectContaining({ resultType: 'created_new', category: 'Coffee', submissionId: 'sub-1' }));
    expect(read('./askToBusiness.js')).not.toMatch(/create_business_request|submitBusinessRequest/);
  });
});

describe('screens', () => {
  it('"tonight" is today\'s date, and the chip and summary say Tonight', () => {
    const s = read('../screens/AskBusinessScreen.js');
    expect(s).toMatch(/rawPrefillDateWindow === 'tonight' \|\| rawPrefillDateWindow === 'now' \? 'today'/); // what is sent: unchanged
    expect(s).toMatch(/const dateOptionLabel = \(d\) => \(d\.key === 'today' && saidTonight \? dateOptionText\('tonight', 'Tonight', language\) : dateOptionText\(d\.key, d\.label, language\)\);/);
    expect(s).toMatch(/\{dateOptionLabel\(d\)\}<\/Text>/);
  });
  it('Home and Discover share the one implementation', () => {
    const home = read('../screens/HomeScreen.js');
    const go = home.slice(home.indexOf('function goAskBusiness('), home.indexOf('function handleAskBusiness()'));
    expect(go).toMatch(/askBusinessFromAsk\(navigation, ask\)/);
    expect(go).not.toMatch(/navigate\('AskBusiness'/);
    const discover = read('../screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/askBusinessFromAsk\(navigation, \{ classifyResult: intentSearch\.classifyResult,/);
  });
});

// Owner item 84 (2026-10-12): the request shows what the ask gave ("From what you said", item 82's card) and marks every
// still-missing required field where it sits before Send, through the same rule Send uses.
describe('item 84: request from an ask -- what was carried, and what is still missing', () => {
  const { askMissingField, askMissingFields } = require('../utils/askMissing');
  const { fromWhatYouSaidRows } = require('../utils/fromWhatYouSaid');
  const rows = (params) => fromWhatYouSaidRows({ inferredSummary: params.carriedSummary }).map((r) => `${r.layer}:${r.key}`);
  // the form exactly as AskBusinessScreen starts it from these params (askForm), before the person touches anything
  const formFrom = (p) => ({ text: p.prefillText, category: p.prefillCategory, gatheringId: null, matchId: null, partySize: p.prefillPartySize ? String(p.prefillPartySize) : '', dateWindow: p.prefillDateWindow === 'tonight' || p.prefillDateWindow === 'now' ? 'today' : (p.prefillDateWindow || null), matchedAvailability: null });

  it('"Coffee tonight": carried Coffee + Tonight (no People: no number said); only How many people? is missing', () => {
    const p = askBusinessParamsFromAsk(ask('Coffee tonight'));
    expect(p.prefillFromAsk).toBe(true);
    expect(rows(p)).toEqual(['activity:Coffee', 'time:tonight']);
    expect(askMissingFields(formFrom(p)).map((m) => m.key)).toEqual(['party']);
  });

  it('"Coffee for four tonight": People 4 carried because the words said it; nothing missing', () => {
    const p = askBusinessParamsFromAsk(ask('Coffee for four tonight'));
    expect(rows(p)).toEqual(['activity:Coffee', 'time:tonight', 'people:4']);
    expect(askMissingFields(formFrom(p))).toEqual([]);
  });

  it('several missing at once: "something fun" -> category, day and party all marked, in render order', () => {
    const p = askBusinessParamsFromAsk(ask('something fun'));
    expect(rows(p)).toEqual([]);
    expect(askMissingFields(formFrom(p)).map((m) => m.key)).toEqual(['category', 'day', 'party']);
  });

  it('partly completed: the marks follow the form live, and Send always names the first of the same list', () => {
    const base = formFrom(askBusinessParamsFromAsk(ask('something fun')));
    const forms = [
      base,
      { ...base, category: 'Bowling' },
      { ...base, category: 'Bowling', dateWindow: 'flexible' },
      { ...base, category: 'Bowling', dateWindow: 'flexible', partySize: '3' },
      { ...base, text: '  ', category: 'Bowling', dateWindow: 'flexible', partySize: '3' },
      { ...base, gatheringId: 'g' },
      { ...base, matchId: 'm', category: 'Bowling' },
      { ...base, matchedAvailability: { availabilityId: 'a' }, category: 'Bowling' },
    ];
    const expected = [['category', 'day', 'party'], ['day', 'party'], ['party'], [], ['text'], ['category'], ['day'], ['party']];
    forms.forEach((f, i) => {
      const keys = askMissingFields(f).map((m) => m.key);
      expect(keys).toEqual(expected[i]);
      expect(askMissingField(f)?.key ?? null).toBe(keys[0] ?? null);
    });
  });

  it('never a default or inference as a stated fact: a date\'s assumed 2 is not People; an Under $25 chip is not a row', () => {
    const date = ask('date night tonight');
    const ai = { ...date.classifyResult, partySize: 2, structured: { ...date.classifyResult.structured, group: { ...date.classifyResult.structured.group, partySize: 2 }, sources: { partySize: 'ai' } } };
    expect(rows(askBusinessParamsFromAsk({ ...date, classifyResult: ai }))).not.toContain('people:2');
    const a = ask('dinner for six tomorrow');
    const p = askBusinessParamsFromAsk({ ...a, classifyResult: applyRefinement(applyRefinement(a.classifyResult, 'under_25'), 'friends') });
    expect(rows(p)).toEqual(['activity:Restaurants', 'time:tomorrow', 'people:6']); // no budget, no who-it's-with row
    expect(rows(askBusinessParamsFromAsk(ask('dinner whenever, no rush')))).toContain('time:flexible');
  });

  it('the screen: one card (item 82\'s), Hide, marks only on the four required fields, Send unchanged as the backstop', () => {
    const screen = read('../screens/AskBusinessScreen.js');
    expect((screen.match(/<FromWhatYouSaidCard/g) || []).length).toBe(1);
    expect(screen).toContain("const fromAsk = route.params?.prefillFromAsk === true;");
    expect(screen).toContain('onHide={() => setCarriedDismissed(true)}');
    expect(screen).toContain('settle={!carriedSettled}');
    expect(screen).toContain('const askForm = { text: askText, category, gatheringId, matchId, partySize, dateWindow, matchedAvailability };');
    expect(screen).toContain('return askMissingField(askForm);');
    expect(screen).toContain("const missingKeys = fromAsk ? askMissingFields(askForm).map((m) => m.key) : [];");
    expect([...screen.matchAll(/missingMark\('(\w+)'\)/g)].map((m) => m[1])).toEqual(['text', 'category', 'day', 'party']);
    // each mark sits right under its own field's label
    expect(screen).toMatch(/t\('ui\.askBusiness\.whatDoYouWant'\)\}<\/Text>\s*\{missingMark\('text'\)\}/);
    expect(screen).toMatch(/t\('ui\.askBusiness\.category'\)\}<\/Text>\s*\{missingMark\('category'\)\}/);
    expect(screen).toMatch(/t\('ui\.askBusiness\.when'\)\}<\/Text>\s*\{missingMark\('day'\)\}/);
    expect(screen).toMatch(/t\('ui\.askBusiness\.partySize'\)\}<\/Text>\s*\{missingMark\('party'\)\}/);
    // the existing wording only (no new strings), and Send's alert stays
    expect(screen).toContain("t(`ui.askBusiness.missing.${key}.title`)");
    expect(screen).toContain("Alert.alert(t(`ui.askBusiness.missing.${missing.key}.title`), t(`ui.askBusiness.missing.${missing.key}.body`));");
    // opening never waits: the shared navigate is synchronous, no morph
    const svc = read('./askToBusiness.js');
    expect(svc).not.toMatch(/await|setTimeout|SharedElement|Animated/);
  });
});
