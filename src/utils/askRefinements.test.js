// Refine without restarting (owner item 107).
import fs from 'fs';
import path from 'path';
import { refinementChips, applyRefinement, canRefine, UNDER_BUDGET } from './askRefinements';
import { emptyCopy } from '../constants/emptyStates';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const labels = (c) => refinementChips(c).map((x) => x.label);
const selected = (c) => refinementChips(c).filter((x) => x.selected).map((x) => x.key);

describe('refinement chips', () => {
  it('"Something fun tonight": With friends / Date night / Solo / Under $25, none selected', () => {
    const c = { intent: 'gathering', dateWindow: 'tonight' };
    expect(labels(c)).toEqual(['With friends', 'Date night', 'Solo', 'Under $25']);
    expect(selected(c)).toEqual([]);
  });

  it('"Date night" only promises an evening the ask named; otherwise just "Date"', () => {
    expect(labels({ dateWindow: 'tomorrow' })[1]).toBe('Date');
    expect(labels({})[1]).toBe('Date');
  });

  it('chips reflect what was understood', () => {
    expect(selected({ partyType: 'friends', budgetMax: 20 })).toEqual(['friends', 'under_25']);
    expect(selected({ budgetMax: 60 })).toEqual([]);
  });

  it('who-for is one choice; tapping the selected one clears it; budget is independent', () => {
    let c = { intent: 'gathering', category: 'Coffee' };
    c = applyRefinement(c, 'friends');
    expect(c.partyType).toBe('friends');
    c = applyRefinement(c, 'date');
    expect(c.partyType).toBe('date');
    expect(c.partySize).toBeUndefined(); // no size invented: the resolver already counts a date as two
    c = applyRefinement(c, 'under_25');
    expect(c).toMatchObject({ partyType: 'date', budgetMax: UNDER_BUDGET.budgetMax, priceLevel: '$', category: 'Coffee' });
    c = applyRefinement(c, 'date');
    expect(c.partyType).toBeNull();
    c = applyRefinement(c, 'under_25');
    expect(c).toMatchObject({ budgetMax: null, priceLevel: null });
  });

  it('never touches a stated party size, category, time or anything else', () => {
    const c = { partySize: 6, category: 'Live Music', dateWindow: 'tonight', attributes: ['quiet'] };
    const r = applyRefinement(c, 'friends');
    expect(r).toMatchObject({ partySize: 6, category: 'Live Music', dateWindow: 'tonight', attributes: ['quiet'] });
    expect(c.partyType).toBeUndefined(); // input not mutated
  });

  it('not offered on a community lookup or a business proposal', () => {
    expect(canRefine({ intent: 'community' })).toBe(false);
    expect(canRefine({ intent: 'business_partner' })).toBe(false);
    expect(canRefine({ intent: 'gathering' })).toBe(true);
    expect(canRefine(null)).toBe(false);
  });

  it('an empty refinement explains itself and offers the way back', () => {
    expect(emptyCopy('refine_none').title).toBe('Nothing nearby fits that yet');
  });
});

describe('one implementation on both surfaces', () => {
  const home = read('../screens/HomeScreen.js');
  const discover = read('../screens/DiscoverHubScreen.js');
  it('both render the same chip component and refine through the same service; neither builds its own chips', () => {
    for (const [screen, surface] of [[home, 'home'], [discover, 'discover']]) {
      expect(screen).toMatch(/<AskRefinementChips\n\s+classifyResult=\{intent\w+\.classifyResult\}\n\s+onRefine=\{handleIntentRefine\}/);
      expect(screen).toMatch(new RegExp(`refineTypedAsk\\('${surface}', prev, key\\)`));
      expect(screen).not.toMatch(/refinementChips\(|applyRefinement\(|resolveIntent\(\{/);
    }
  });
  it('the first search on both goes through the one canonical resolve', () => {
    expect(home).toMatch(/await resolveClassifiedAsk\(result, typedText\)/);
    expect(read('../services/intentResolver.js')).toMatch(/await resolveClassifiedAsk\(classifyResult, typedText\)/);
    expect(read('../services/askRefine.js')).toMatch(/await resolveClassifiedAsk\(refined, prev\.typedText\)/);
  });
  it('Discover keeps the block (and the selected chip) when a refinement is empty', () => {
    expect(discover).toMatch(/\(intentSearch\?\.outcome === 'results' \|\| intentSearch\?\.refined\)/);
  });
  it('conversational acknowledgement on Home', () => {
    expect(home).toMatch(/<FoundLine text="Got it\. Here are a few ideas\." \/>/);
  });
  it('typed-ask only: the chips are not a persistent Discover filter', () => {
    const d = discover.slice(discover.indexOf('async function handleIntentRefine'), discover.indexOf('async function handleDiscoverSurprise'));
    expect(d).not.toMatch(/setTypeFilter|setOpenNowOnly|AsyncStorage|setCategory/);
  });
});
