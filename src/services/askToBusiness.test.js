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
    expect(s).toMatch(/const dateOptionLabel = \(d\) => \(d\.key === 'today' && saidTonight \? 'Tonight' : d\.label\);/);
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
