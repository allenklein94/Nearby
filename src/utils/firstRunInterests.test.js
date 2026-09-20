import { firstRunInterestLine } from './firstRunInterests';

const rec = (tag) => ({ data: { interest_tag: tag } });
describe('firstRunInterestLine', () => {
  test('null with no declared interests', () => {
    expect(firstRunInterestLine([], [rec('Coffee')])).toBeNull();
    expect(firstRunInterestLine(undefined, [])).toBeNull();
  });
  test('names the real picks and what matched', () => {
    const r = firstRunInterestLine(['Coffee', 'Fitness', 'Music'], [rec('Coffee')]);
    expect(r.covered).toEqual(['Coffee']);
    expect(r.text).toMatch(/into Coffee, Fitness and Music/);
    expect(r.text).toMatch(/nothing upcoming nearby for Fitness and Music/);
  });
  test('never claims a match when none exists', () => {
    const r = firstRunInterestLine(['Coffee'], [rec('Yoga')]);
    expect(r.covered).toEqual([]);
    expect(r.text).toMatch(/Nothing upcoming nearby matches yet/);
  });
  test('ignores unknown labels', () => {
    expect(firstRunInterestLine(['zzz'], [])).toBeNull();
  });
});
