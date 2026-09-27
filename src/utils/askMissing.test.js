// Ask only what is needed to move forward (owner item 106).
import fs from 'fs';
import path from 'path';
import { askMissingField } from './askMissing';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('the request form asks only what a business cannot act without', () => {
  const base = { text: 'Book something for 12 people', category: 'Foodie', partySize: '12' };

  it('"Book something for 12 people" with no day -> asks "What day?"', () => {
    expect(askMissingField({ ...base, dateWindow: null })).toMatchObject({ key: 'day', title: 'What day?' });
  });

  it('a day from the words, a picked day or a deliberate "I\'m flexible" moves forward', () => {
    for (const dateWindow of ['today', 'tomorrow', 'weekend', 'pick_date', 'flexible']) {
      expect(askMissingField({ ...base, dateWindow })).toBeNull();
    }
  });

  it('never asks time, budget, vibe, indoor/outdoor or radius', () => {
    const asked = askMissingField({ ...base, dateWindow: 'today' });
    expect(asked).toBeNull();
    const src = read('./askMissing.js');
    const fn = src.slice(src.indexOf('export function'));
    expect(fn).not.toMatch(/budget|vibe|outdoor|indoor|radius|startTime|attributes/i);
  });

  it('one question at a time, in form order; the day is not asked where it is already known', () => {
    expect(askMissingField({ text: '', category: null })).toMatchObject({ key: 'text' });
    expect(askMissingField({ text: 'x', category: null })).toMatchObject({ key: 'category' });
    expect(askMissingField({ ...base, gatheringId: 'g', dateWindow: null })).toBeNull();
    expect(askMissingField({ ...base, matchedAvailability: { availabilityId: 'a' }, dateWindow: null })).toBeNull();
    expect(askMissingField({ ...base, partySize: '', dateWindow: 'today' })).toMatchObject({ key: 'party' });
    expect(askMissingField({ ...base, matchId: 'm', partySize: '', dateWindow: 'today' })).toBeNull();
  });

  it('the form no longer defaults the day to "flexible"; it starts unanswered unless the words gave one', () => {
    const screen = read('../screens/AskBusinessScreen.js');
    expect(screen).toMatch(/useState\(normalizedPrefillDateWindow \|\| null\)/);
    expect(screen).toMatch(/return askMissingField\(\{/);
    expect(screen).not.toMatch(/setDateWindow\(d\.dateWindow \?\? 'flexible'\)/);
  });

  it('typed searches ask nothing: Home and Discover go straight from the words to results', () => {
    for (const f of ['../screens/HomeScreen.js', '../screens/DiscoverHubScreen.js']) {
      expect(read(f)).not.toMatch(/askMissingField|What day\?/);
    }
  });
});
