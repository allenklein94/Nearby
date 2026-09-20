import { recommendationConfidence as conf, confidenceHeadline } from './recommendationConfidence';

const s = (text, kind) => ({ text, kind });
describe('recommendationConfidence (item 61)', () => {
  it('no reasons -> no confidence, no headline', () => {
    expect(conf([])).toBeNull();
    expect(confidenceHeadline([])).toBeNull();
  });
  it('declared interest + a friend = high', () => {
    expect(conf([s('Because you like Coffee'), s('Sam is going')])).toBe('high');
    expect(confidenceHeadline([s('Because you like Coffee'), s('Sam is going')])).toBe('A strong match for you');
  });
  it('one strong reason = medium', () => {
    expect(conf([s('Because you like Coffee')])).toBe('medium');
    expect(conf([s('Sam is hosting this')])).toBe('medium');
    expect(conf([s('Trending nearby')], { intent: true })).toBe('high');
  });
  it('popularity, timing or facts alone = low', () => {
    expect(conf([s('Trending nearby · 12 going')])).toBe('low');
    expect(conf([s('Starting soon')])).toBe('low');
    expect(conf([s('1.2 mi away')])).toBe('low');
    expect(confidenceHeadline([s('Trending nearby')])).toBe('Worth discovering');
  });
  it('popular + timing without anything personal is still low', () => {
    expect(conf([s('Trending nearby'), s('Starting soon')])).toBe('low');
  });
  it('activity-only interest is never strong on its own', () => {
    expect(conf([s('Based on your recent activity: Coffee')])).toBe('low');
    expect(conf([s('Based on your recent activity: Coffee'), s('Starting soon')])).toBe('medium');
  });
});
