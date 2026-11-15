// Business Profile summary (owner, 2026-11-14): each section header shows only what is SAVED; nothing set = "Not set".
import { profileSummaryLine, profileSummaryPieces, SUMMARY_MAX_PIECES } from './profileSummary';
import { mergeKeywordReading } from './businessSetupPlan';
import { PROFILE_GROUPS, DEFAULT_PROFILE_GROUP, profileGroupFor } from './profileGroups';

const fmt = { upToPeople: (n) => `Up to ${n} people`, notSet: 'Not set', categoryLabel: (k) => `C:${k}`, subcategoryLabel: (k) => `S:${k}` };

describe('profileSummaryLine', () => {
  test('nothing saved = the caller\'s "Not set", never a guess or default', () => {
    for (const key of ['basics', 'accommodate', 'who', 'grow']) expect(profileSummaryLine(key, {}, fmt)).toBe('Not set');
    expect(profileSummaryLine('basics', null, fmt)).toBe('Not set');
  });
  test('basics = category, subcategory, address', () => {
    expect(profileSummaryLine('basics', { category: 'food_drink', subcategory: 'Coffee', address: ' 1 Main St ' }, fmt)).toBe('C:food_drink · S:Coffee · 1 Main St');
  });
  test('accommodate reads the ROUTING group size (max_group_size), never the auto-reply range', () => {
    expect(profileSummaryLine('accommodate', { max_group_size: 12 }, fmt)).toBe('Up to 12 people');
    expect(profileSummaryLine('accommodate', { party_size_max: 100, party_size_min: 1 }, fmt)).toBe('Not set');
    expect(profileSummaryLine('accommodate', { max_group_size: 0 }, fmt)).toBe('Not set');
  });
  test('grow (want more) is separate from what the business can accommodate', () => {
    const p = { priority_occasions: ['birthday'], offered_occasions: [] };
    expect(profileSummaryLine('accommodate', p, fmt)).toBe('Not set');
    expect(profileSummaryLine('grow', p, fmt)).not.toBe('Not set');
  });
  test('long lists show at most SUMMARY_MAX_PIECES then +N', () => {
    const p = { category: 'a', subcategory: 'b', address: 'c' };
    expect(profileSummaryPieces('basics', p, fmt)).toHaveLength(3);
    const many = { max_group_size: 4, offered_occasions: ['birthday', 'anniversary', 'date_night', 'graduation'] };
    const line = profileSummaryLine('accommodate', many, fmt);
    expect(line.split(' · ')).toHaveLength(SUMMARY_MAX_PIECES + 1);
    expect(line).toMatch(/\+2$/);
  });
  test('settings (advanced) has no summary line', () => {
    expect(profileSummaryLine('settings', { category: 'x' }, fmt)).toBeNull();
  });
});

describe('Tell Nearby + Teach Nearby merged', () => {
  test('keyword attributes join the AI reading without duplicates', () => {
    expect(mergeKeywordReading({ category: 'x', attributes: ['quiet'] }, ['quiet', 'wifi'])).toEqual({ category: 'x', attributes: ['quiet', 'wifi'] });
  });
  test('AI unavailable: the keyword reading alone still gives something to confirm', () => {
    expect(mergeKeywordReading(null, ['wifi'])).toEqual({ attributes: ['wifi'] });
  });
  test('neither understood anything = null (existing error path)', () => {
    expect(mergeKeywordReading(null, [])).toBeNull();
    expect(mergeKeywordReading(null, undefined)).toBeNull();
  });
  test('no Teach group; all sections start closed; a link may still open one', () => {
    expect(PROFILE_GROUPS).not.toContain('teach');
    expect(DEFAULT_PROFILE_GROUP).toBeNull();
    expect(profileGroupFor('who')).toBe('who');
    expect(profileGroupFor('teach')).toBeNull();
  });
});
