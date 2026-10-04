// Item 185 (owner, 2026-10-04, LOCKED): a Dating & Social category is the WHY of an outing, never its market. When the words
// name both a dating category and a concrete one, the concrete category is the result and the date stays a signal
// (party type date / occasion), so the search keeps its useful filter. Real deterministic resolver, plus the AI path.
import { resolveAsk, toClassification } from './askResolver';
import { tagsForPhrase } from '../constants/categorySynonyms';

const classify = (text, ai = null) => toClassification(resolveAsk(text, ai));

describe('a dating category never replaces a concrete one', () => {
  it('"first date coffee" = Coffee, with the first-date signal kept', () => {
    const c = classify('first date coffee');
    expect(c.category).toBe('Coffee');
    expect(c.occasion).toBe('first_date');
    expect(c.partyType).toBe('date');
    expect(tagsForPhrase('first date coffee')).toEqual(['Coffee']);
  });

  it('"coffee date" = Coffee, with the date signal kept', () => {
    const c = classify('coffee date');
    expect(c.category).toBe('Coffee');
    expect(c.partyType).toBe('date');
  });

  it.each([['first date brunch', 'Brunch'], ['date night dinner', 'Restaurants'], ['date night bowling', 'Bowling']])('"%s" keeps %s', (text, tag) => {
    const c = classify(text);
    expect(c.category).toBe(tag);
    expect(c.partyType).toBe('date');
  });

  it.each([['first date', 'First Date'], ['date night', 'Date Night'], ['speed dating', 'Speed Dating'], ['singles events', 'Singles Events']])('"%s" alone stays %s', (text, tag) => {
    expect(classify(text).category).toBe(tag);
  });

  it('an AI dating guess never overrides a concrete category in the words, but still applies when the words name none', () => {
    expect(classify('first date coffee', { category: 'First Date' }).category).toBe('Coffee');
    expect(classify('somewhere for a first date', { category: 'First Date' }).category).toBe('First Date');
  });
});
