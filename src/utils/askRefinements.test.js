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

describe('Home wiring', () => {
  const home = read('../screens/HomeScreen.js');
  it('one search helper for the first ask and every refinement; the budget now reaches the resolver', () => {
    expect(home.match(/await resolveHomeAsk\(/g).length).toBe(2);
    expect(home).toMatch(/budgetMax: result\.budgetMax \?\? null/);
    expect(home.match(/await resolveIntent\(\{/g).length).toBe(1);
  });
  it('a refinement makes no AI call and no new search-log row, keeps the words, and is audited under the same ask', () => {
    const fn = home.slice(home.indexOf('async function handleIntentRefine'), home.indexOf('function handleIntentResultTap'));
    expect(fn).not.toMatch(/classifyCreateRequest|recordIntentSubmission/);
    expect(fn).toMatch(/typedText: prev\.typedText, submissionId: prev\.submissionId/);
    expect(fn).toMatch(/recordTypedAsk\('home'/);
  });
  it('conversational acknowledgement', () => {
    expect(home).toMatch(/<FoundLine text="Got it\. Here are a few ideas\." \/>/);
  });
});
